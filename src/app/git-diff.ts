// Git 统一差异的解析与补丁构造（纯函数，供 hunk 级暂存使用）。
//
// 思路与 VS Code 一致：不调用交互式 `git add -p`，而是把用户选中的 hunk
// 重新拼成一份只含文件头 + 这些 hunk 的补丁，交给 `git apply --cached`
// （取消暂存则加 `--reverse`）。因此解析必须无损保留原始行文本。

export type GitDiffHunk = {
  /** 原始的 `@@ … @@` 行。 */
  header: string;
  /** 该行在 diff 文本里的行号（1-based），用于 React key 与定位。 */
  line: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** hunk 正文（含 `+`/`-`/` `/`\` 前缀），不含 header 行。 */
  lines: string[];
};

export type GitDiffFile = {
  /** 文件头（`diff --git` / `index` / `---` / `+++` / 模式变更等），不含 hunk。 */
  header: string[];
  hunks: GitDiffHunk[];
  /** 不构成 hunk 的其余行（例如二进制文件提示）。 */
  trailing: string[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

/** 解析一份单文件统一差异；无法识别的内容原样留在 header/trailing 里。 */
export function parseGitDiff(text: string): GitDiffFile {
  const lines = text.split("\n");
  const header: string[] = [];
  const hunks: GitDiffHunk[] = [];
  const trailing: string[] = [];
  let current: GitDiffHunk | null = null;

  lines.forEach((line, index) => {
    const match = HUNK_HEADER.exec(line);
    if (match) {
      if (current) hunks.push(current);
      current = {
        header: line,
        line: index + 1,
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      return;
    }
    if (current) {
      current.lines.push(line);
      return;
    }
    if (hunks.length === 0) header.push(line);
    else trailing.push(line);
  });
  if (current) hunks.push(current);

  // 去掉分割产生的尾部空串（diff 文本通常以换行结尾）
  if (header.length > 0 && header[header.length - 1] === "") header.pop();
  if (hunks.length > 0) {
    const last = hunks[hunks.length - 1];
    if (last.lines.length > 0 && last.lines[last.lines.length - 1] === "") last.lines.pop();
  }
  if (trailing.length > 0 && trailing[trailing.length - 1] === "") trailing.pop();

  return { header, hunks, trailing };
}

/**
 * 把选中的 hunk 拼成可交给 `git apply` 的补丁：文件头原样保留，
 * 只带上被选中的 hunk，因此一次只暂存用户点的那几块。
 * 没有可用 hunk 或没有选中任何 hunk 时返回空串。
 */
export function buildHunkPatch(file: GitDiffFile, hunkLines: readonly number[]): string {
  const selected = new Set(hunkLines);
  const picked = file.hunks.filter((hunk) => selected.has(hunk.line));
  if (picked.length === 0) return "";
  const body = picked.flatMap((hunk) => [hunk.header, ...hunk.lines]);
  return [...file.header, ...body].join("\n") + "\n";
}

/**
 * 逐行分类，供渲染使用：hunk 头单独一类，其余沿用 git-model 的分类。
 * 返回与输入行等长的数组。
 */
export function gitDiffLineKinds(text: string): Array<"meta" | "hunk" | "add" | "remove" | "context"> {
  const lines = text.split("\n");
  const result: Array<"meta" | "hunk" | "add" | "remove" | "context"> = [];
  for (const line of lines) {
    if (HUNK_HEADER.test(line)) result.push("hunk");
    else if (line.startsWith("+++") || line.startsWith("---")) result.push("meta");
    else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("new file mode")
      || line.startsWith("deleted file mode") || line.startsWith("similarity index")
      || line.startsWith("rename ") || line.startsWith("Binary files") || line.startsWith("Cannot display")
      || line.startsWith("\\ No newline") || line === "--") result.push("meta");
    else if (line.startsWith("+")) result.push("add");
    else if (line.startsWith("-")) result.push("remove");
    else result.push("context");
  }
  return result;
}
