import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "vendor", "dsh");
const publicBase = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";
const publicTag = "dsh-v0.1.1-rc.2";
const patchedCommit = "8d43a2c98da919ca01d0283320214cc29505d9ac";
const upstream = "https://github.com/deepseek-ai/deepseek-harness.git";

// The vendored runtime ships three local commits on top of the public RC2 tag.
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
  {
    file: "dsh-pwsh-reprobe.patch",
    commit: "7f4408325ff7dece0b98a13185dd3576d0605f60",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-01T14:32:52+08:00",
    committerDate: "2026-09-01T14:32:52+08:00",
    message: [
      "fix(pwsh): 重新探测 Store 可执行文件",
      "",
      "解析 Store app execution alias 的当前包目标，跳过已确认悬空的别名，并在每次命令启动前重新探测自动路径。",
      "保留显式 pwshPath 与 ACL 阻止目标检查时的 alias 支持，更新中英文 README 和决策记录。",
      "验证：pwsh-local 与 pwsh-sandbox 专项测试 54 通过、5 平台跳过；包类型检查、lint、文档配对及链接检查通过。",
      "",
    ].join("\n"),
  },
  {
    file: "dsh-storage-json-retry.patch",
    commit: "8d43a2c98da919ca01d0283320214cc29505d9ac",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-04T15:03:25+08:00",
    committerDate: "2026-09-04T15:03:25+08:00",
    message: [
      "fix(storage-json): Windows 原子替换遇短暂锁定时有界重试",
      "",
      "改动：writeAtomic 最终 rename 失败仅在 Windows 且错误码为 EACCES/EBUSY/EPERM",
      "时重试同一个已关闭并同步的临时文件，每次递增 50 ms，最多十次；目标是已有",
      "目录时立即抛出，其余错误与超限保留最后错误。失败路径仍清理临时文件并回滚",
      "内存状态。补充双语 Agent Note 与 README 说明。",
      "",
      "原因：Defender/索引器等短暂持有 workspace.json 时，Windows 拒绝替换并使",
      "工作区排序等写入失败；重试吸收瞬时锁，永久权限问题仍快速失败。",
      "",
      "验证：storage-json 专项测试 24 通过（新增 5 个 atomic 用例）；storage-domain",
      "23 通过；workspace.spec 除两个 Windows symlink 环境限制外全部通过；tsc 与",
      "oxlint 通过。",
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

const rustSource = fs.readFileSync(path.join(root, "src-tauri", "src", "main.rs"), "utf8");
const rustCommit = rustSource.match(
  /const BUNDLED_DSH_SOURCE_COMMIT:\s*&str\s*=\s*"([0-9a-f]{40})"/,
)?.[1];
const gitlinkCommit = git(["ls-files", "--stage", "vendor/dsh"]).split(/\s+/u)[1];
const finalPatchCommit = patches.at(-1)?.commit;
if (
  rustCommit !== patchedCommit ||
  gitlinkCommit !== patchedCommit ||
  finalPatchCommit !== patchedCommit
) {
  throw new Error(
    "DSH 固定提交不一致：" +
      `源码准备 ${patchedCommit}，Rust ${rustCommit ?? "<missing>"}，` +
      `gitlink ${gitlinkCommit ?? "<missing>"}，补丁链 ${finalPatchCommit ?? "<missing>"}`,
  );
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
