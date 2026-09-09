import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "vendor", "dsh");
const publicBase = "82a5fd61a7cf5c293cec4bdff68f455398d685e9";
const publicTag = "dsh-v0.1.3-alpha.2";
const patchedCommit = "046e750ed585363f949a9115179ccbc68d6881b3";
const upstream = "https://github.com/deepseek-ai/deepseek-harness.git";

// The vendored runtime ships six local commits on top of alpha.2.
// Each entry reproduces one of them deterministically from its patch file:
// identical tree, parents, message, and author/committer identity reproduce
// the exact commit id pinned by src-tauri/src/main.rs.
const patches = [
  {
    file: "dsh-fork-migration.patch",
    commit: "77792d460c56bc29121bac3f44a50872811925dc",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-05T01:07:47+08:00",
    committerDate: "2026-09-08T16:05:12+08:00",
    message: [
      "feat(session): 支持显式 preset 迁移副本",
      "",
      "改动：为 session.fork 增加 agentPreset 迁移模式，完整复制源历史、在新 preset 下组合子会话，并记录 agent-preset/selected 事件；无 roster 部署与未知 preset 拒绝迁移。移植 rc.2 补丁到 0.1.2-rc.1 的 session-controller。",
      "",
      "原因：删除会话原 Agent Preset 后，用户需要在明确知情的前提下恢复会话，且原会话必须保持不变。",
      "",
      "验证：commands-create-fork.host.spec.ts 16 通过；session-controller 全套 430 通过；tsc -b host face 干净。",
      "",
    ].join("\n"),
  },
  {
    file: "dsh-reasoning-tokens.patch",
    commit: "6a3a3611582c3d3ff7f3bcd4298811ec0848d033",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-05T01:08:04+08:00",
    committerDate: "2026-09-08T16:05:26+08:00",
    message: [
      "fix(llm-pi-ai): usage 透出 provider 上报的思考 tokens",
      "",
      "pi-ai 仅在 provider 上报 reasoning 时提供思考拆分；mapUsage 丢弃了该字段，",
      "导致即使 wire 上有思考数（think 内容早已通过 reasoning-delta 流出），harness",
      "usage 也始终没有 reasoningTokens。现将该字段映射进 harness TokenUsage，作为",
      "输出的子集，与 llm-deepseek 适配器对齐。移植 rc.2 补丁到 0.1.2-rc.1。",
      "",
      "验证：convert.spec.ts 74 通过。",
      "",
    ].join("\n"),
  },
  {
    file: "dsh-pwsh-reprobe.patch",
    commit: "c2520a916e76a0150022b4b3ec61db13551cae02",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-05T01:08:22+08:00",
    committerDate: "2026-09-08T16:07:52+08:00",
    message: [
      "fix(pwsh): 每次 spawn 前重新探测 Store 可执行文件",
      "",
      "解析 Store app execution alias 的当前包目标，跳过已确认悬空的别名，并在每次命令启动前重新探测自动路径。",
      "保留显式 pwshPath 与 ACL 阻止目标检查时的 alias 支持。移植 rc.2 补丁到 0.1.2-rc.1。",
      "验证：executor.spec.ts 40 通过、3 平台跳过（含本机 Store alias 实测解析）。",
      "",
    ].join("\n"),
  },
  {
    file: "dsh-storage-json-retry.patch",
    commit: "2213bd1cd6441665ac04d045b2c1b9a776503d71",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-05T01:08:38+08:00",
    committerDate: "2026-09-08T16:07:53+08:00",
    message: [
      "fix(storage-json): Windows 原子替换遇短暂锁定时有界重试",
      "",
      "改动：writeAtomic 最终 rename 失败仅在 Windows 且错误码为 EACCES/EBUSY/EPERM",
      "时重试同一个已关闭并同步的临时文件，每次递增 50 ms，最多十次；目标是已有",
      "目录时立即抛出，其余错误与超限保留最后错误。失败路径仍清理临时文件并回滚",
      "内存状态。移植 rc.2 补丁到 0.1.2-rc.1，补充独立 atomic.spec.ts。",
      "",
      "原因：Defender/索引器等短暂持有 workspace.json 时，Windows 拒绝替换并使",
      "工作区排序等写入失败；重试吸收瞬时锁，永久权限问题仍快速失败。",
      "",
      "验证：storage-json 36 通过（新增 5 个 atomic 用例）。",
      "",
    ].join("\n"),
  },
  {
    file: "dsh-unavailable-attachment-request-projection.patch",
    commit: "a2dbb93560dcdbdaefe9f085cc38d483ecb102bf",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-07T17:42:24+08:00",
    committerDate: "2026-09-08T16:11:08+08:00",
    message: [
      "fix(llm): 兼容缺失历史附件",
      "",
      "仅将 ATTACHMENT_NOT_FOUND 的历史图片投影为本次请求的恢复文本，保留会话日志和其他附件错误。\\n\\n补充 pi-ai、DeepSeek 与共享内容投影回归测试，并记录双语维护说明。\\n\\n验证：vitest 191 项通过；npm run build:lib:host 通过；文档配对与 Agent Note 格式检查通过。",
      "",
    ].join("\n"),
  },
  {
    file: "dsh-session-persistence-lazy-fs-ext.patch",
    commit: "046e750ed585363f949a9115179ccbc68d6881b3",
    authorName: "Sparrived",
    authorEmail: "sparrived@outlook.com",
    authorDate: "2026-09-08T16:12:24+08:00",
    committerDate: "2026-09-08T16:12:24+08:00",
    message: [
      "fix(session-persistence): Windows 延迟加载 POSIX 锁模块",
      "",
      "改动：JSONL session persistence 仅在 POSIX 获取写锁时动态加载 fs-ext；Windows 继续使用既有的 koffi 命名信号量路径。",
      "",
      "原因：桌面运行时的受控部署不会执行原生依赖 install 脚本，而 Windows 启动不需要 POSIX flock；在模块求值时加载 fs-ext 会使桌面 Host 无法启动。",
      "",
      "验证：session-persistence-jsonl lease.spec.ts 10 通过、9 项 Windows 跳过；tsc -b packages/session/session-persistence-jsonl/tsconfig.json 通过。",
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
// inherit core.autocrlf=true, which changes the public alpha checkout before
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
if (sourceGit(["status", "--porcelain"])) throw new Error("公开 alpha 基线工作区不干净");

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
console.log("✅ 已从公开 alpha 基线重建 DSH 补丁链：" + patchedCommit);
