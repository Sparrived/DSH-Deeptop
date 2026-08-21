import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "vendor", "dsh");
const patchPath = path.join(root, "scripts", "dsh-rc8-fork.patch");
const publicBase = "141eb6fef83422698aef7a981029e843e816153";
const publicTag = "dsh-v0.1.0-rc.8";
const patchedCommit = "a95eedc6034c323ece64536609174645c235f124";
const upstream = "https://github.com/deepseek-ai/deepseek-harness.git";
const commitMessage = [
  "feat(session): 支持显式 preset 迁移副本",
  "",
  "改动：为 session.fork 增加 agentPreset 迁移模式，完整复制源历史并在新会话记录替代 preset；补充 RPC 文档、Agent Note 和成功/拒绝测试。",
  "",
  "原因：删除会话原 Agent Preset 后，用户需要在明确知情的前提下恢复会话，且原会话必须保持不变。",
  "",
  "验证：npm exec -- tsc -b tsconfig.host.json --pretty false；npm exec -- vitest run packages/host/apiproxy/tests/api-proxy-fork.spec.ts packages/host/apiproxy/tests/api-proxy-agent-preset.spec.ts packages/host/apiproxy/tests/rpc-schemas.spec.ts",
  "",
].join("\n");

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

// The patch is generated against LF worktree files. Git for Windows may inherit
// core.autocrlf=true, which changes the public RC8 checkout before git apply.
// Pin the temporary source checkout to LF on every platform.
sourceGit(["config", "core.autocrlf", "false"]);
sourceGit(["config", "core.eol", "lf"]);

const current = sourceGit(["rev-parse", "HEAD"]);
if (current === patchedCommit) {
  if (sourceGit(["status", "--porcelain"])) throw new Error("vendor/dsh 已在 fork 提交但工作区不干净");
  console.log("✅ DSH 源码已准备：" + patchedCommit);
  process.exit(0);
}

sourceGit(["fetch", "--depth=1", "origin", "tag", publicTag]);
sourceGit(["checkout", "--detach", publicBase]);
if (sourceGit(["status", "--porcelain"])) throw new Error("公开 RC8 基线工作区不干净");

// The repository patch itself can be checked out as CRLF by Git for Windows.
// Normalize only the temporary patch input; preserve its intentional trailing
// whitespace and keep the reviewed patch file untouched.
const normalizedPatchPath = path.join(root, `.dsh-rc8-fork-${process.pid}.patch`);
fs.writeFileSync(normalizedPatchPath, fs.readFileSync(patchPath, "utf8").replace(/\r\n/gu, "\n"));
try {
  execFileSync("git", ["-C", sourceRoot, "apply", "--check", normalizedPatchPath], { cwd: root, stdio: "inherit" });
  execFileSync("git", ["-C", sourceRoot, "apply", normalizedPatchPath], { cwd: root, stdio: "inherit" });
} finally {
  fs.rmSync(normalizedPatchPath, { force: true });
}
sourceGit(["add", "--all"]);
const tree = sourceGit(["write-tree"]);
const commit = git(["-C", sourceRoot, "commit-tree", tree, "-p", publicBase], {
  input: commitMessage,
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: "Sparrived",
    GIT_AUTHOR_EMAIL: "sparrived@outlook.com",
    GIT_AUTHOR_DATE: "2026-08-20T10:47:25+0800",
    GIT_COMMITTER_NAME: "Sparrived",
    GIT_COMMITTER_EMAIL: "sparrived@outlook.com",
    GIT_COMMITTER_DATE: "2026-08-20T15:51:55+0800",
  },
});
if (commit !== patchedCommit) {
  throw new Error("重建 DSH fork 提交不匹配：期望 " + patchedCommit + "，实际 " + commit);
}
sourceGit(["reset", "--hard", patchedCommit]);
if (sourceGit(["status", "--porcelain"])) throw new Error("DSH fork 应用后工作区不干净");
console.log("✅ 已从公开 RC8 重建 DSH fork：" + patchedCommit);
