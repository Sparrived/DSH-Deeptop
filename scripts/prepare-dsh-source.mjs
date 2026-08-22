import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "vendor", "dsh");
const publicBase = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";
const publicTag = "dsh-v0.1.1-rc.2";
const patchedCommit = "9270fce86d6a068e00b1cae955273220ceffa1a5";
const upstream = "https://github.com/deepseek-ai/deepseek-harness.git";

// The vendored runtime ships two local commits on top of the public RC2 tag.
// Each entry reproduces one of them deterministically from its patch file:
// identical tree, parents, message, and author/committer identity reproduce
// the exact commit id pinned by src-tauri/src/main.rs.
const patches = [
  {
    file: "dsh-fork-migration.patch",
    commit: "c71b89977a95c3de951f9360225851e1f479e129",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-08-20T10:47:25+0800",
    committerDate: "2026-08-22T10:56:03+08:00",
    message: [
      "feat(session): 支持显式 preset 迁移副本",
      "",
      "改动：为 session.fork 增加 agentPreset 迁移模式，完整复制源历史并在新会话记录替代 preset；补充 RPC 文档、Agent Note 和成功/拒绝测试。",
      "",
      "原因：删除会话原 Agent Preset 后，用户需要在明确知情的前提下恢复会话，且原会话必须保持不变。",
      "",
      "验证：npm exec -- tsc -b tsconfig.host.json --pretty false；npm exec -- vitest run packages/host/apiproxy/tests/api-proxy-fork.spec.ts packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts packages/host/apiproxy/tests/rpc-schemas.spec.ts",
      "",
    ].join("\n"),
  },
  {
    file: "dsh-reasoning-tokens.patch",
    commit: "9270fce86d6a068e00b1cae955273220ceffa1a5",
    authorName: "deeptop",
    authorEmail: "deeptop@local",
    authorDate: "2026-08-21T22:09:38+0800",
    committerDate: "2026-08-22T10:56:15+08:00",
    message: [
      "fix(llm-pi-ai): usage 透出 provider 上报的思考 tokens",
      "",
      "pi-ai 仅在 provider 上报 completion_tokens_details.reasoning_tokens 时提供思考拆分；",
      "mapUsage 丢弃了该字段，导致即使 wire 上有思考数（think 内容早已通过",
      "reasoning-delta 流出），harness usage 也始终没有 reasoningTokens。现将该字段",
      "映射进 harness TokenUsage，作为输出的子集，与 llm-deepseek 适配器对齐。",
      "",
      "验证：llm-pi-ai vitest 237/237 通过（含更新的 mapUsage 用例），",
      "tsc -b 与 tsdown bundle 已重建。",
      "",
    ].join("\n"),
  },
];

function git(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    const stderr = error.stderr?.toString().trim();
    throw new Error("git " + args.join(" ") + " failed: " + (stderr || error.message));
  }
}

function sourceGit(args, options = {}) {
  return git(["-C", sourceRoot, ...args], options);
}

if (!fs.existsSync(path.join(sourceRoot, ".git"))) {
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(sourceRoot), { recursive: true });
  execFileSync("git", ["clone", "--no-checkout", upstream, sourceRoot], {
    cwd: root,
    stdio: "inherit",
  });
}

// The patches are generated against LF worktree files. Git for Windows may
// inherit core.autocrlf=true, which changes the public RC2 checkout before
// git apply. Pin the temporary source checkout to LF on every platform.
sourceGit(["config", "core.autocrlf", "false"]);
sourceGit(["config", "core.eol", "lf"]);

const current = sourceGit(["rev-parse", "HEAD"]);
if (current === patchedCommit) {
  if (sourceGit(["status", "--porcelain"])) throw new Error("vendor/dsh 已在补丁提交但工作区不干净");
  console.log("✅ DSH 源码已准备：" + patchedCommit);
  process.exit(0);
}

sourceGit(["fetch", "--depth=1", "origin", "tag", publicTag]);
sourceGit(["checkout", "--detach", publicBase]);
if (sourceGit(["status", "--porcelain"])) throw new Error("公开 RC2 基线工作区不干净");

for (const patch of patches) {
  // The repository patch itself can be checked out as CRLF by Git for Windows.
  // Normalize only the temporary patch input; preserve its intentional trailing
  // whitespace and keep the reviewed patch file untouched.
  const normalizedPatchPath = path.join(root, `.dsh-${patch.file}-${process.pid}.patch`);
  fs.writeFileSync(
    normalizedPatchPath,
    fs.readFileSync(path.join(root, "scripts", patch.file), "utf8").replace(/\r\n/gu, "\n"),
  );
  try {
    execFileSync("git", ["-C", sourceRoot, "apply", "--check", normalizedPatchPath], { cwd: root, stdio: "inherit" });
    execFileSync("git", ["-C", sourceRoot, "apply", normalizedPatchPath], { cwd: root, stdio: "inherit" });
  } finally {
    fs.rmSync(normalizedPatchPath, { force: true });
  }
  sourceGit(["add", "--all"]);
  const tree = sourceGit(["write-tree"]);
  const parent = sourceGit(["rev-parse", "HEAD"]);
  const commit = git(["-C", sourceRoot, "commit-tree", tree, "-p", parent], {
    input: patch.message,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: patch.authorName,
      GIT_AUTHOR_EMAIL: patch.authorEmail,
      GIT_AUTHOR_DATE: patch.authorDate,
      GIT_COMMITTER_NAME: "Sparrived",
      GIT_COMMITTER_EMAIL: "sparrived@outlook.com",
      GIT_COMMITTER_DATE: patch.committerDate,
    },
  });
  if (commit !== patch.commit) {
    throw new Error(`重建 DSH 补丁提交不匹配（${patch.file}）：期望 ${patch.commit}，实际 ${commit}`);
  }
  sourceGit(["reset", "--hard", commit]);
}
if (sourceGit(["status", "--porcelain"])) throw new Error("DSH 补丁应用后工作区不干净");
console.log("✅ 已从公开 RC2 基线重建 DSH 补丁链：" + patchedCommit);
