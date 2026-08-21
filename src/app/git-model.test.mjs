import assert from "node:assert/strict";
import test from "node:test";
import {
  canStageFile,
  canUnstageFile,
  diffLineKind,
  formatRelativeTime,
  gitFileLabel,
  gitFileMark,
  gitFileState,
  groupGitBranches,
  groupGitFiles,
} from "./git-model.ts";

function file(status, path = "a.ts", code = status === "staged" ? "M " : " M") {
  return {
    path,
    status,
    code,
    indexStatus: code[0],
    worktreeStatus: code[1],
    isRenamed: false,
  };
}

test("classifies each raw git status into a single group", () => {
  assert.equal(gitFileState(file("untracked", "untracked.txt", "??")), "untracked");
  assert.equal(gitFileState(file("conflicted", "conflict.ts", "UU")), "conflicted");
  assert.equal(gitFileState(file("staged")), "staged");
  assert.equal(gitFileState(file("staged-changed", "both.ts", "MM")), "staged");
  assert.equal(gitFileState(file("changed")), "unstaged");
});

test("groups files while preserving input order", () => {
  const a = file("staged", "a.ts", "M ");
  const b = file("untracked", "b.ts", "??");
  const c = file("changed", "c.ts", " M");
  const d = file("conflicted", "d.ts", "UU");
  const grouped = groupGitFiles([b, a, c, d, a]);
  assert.deepEqual(grouped.staged.map((item) => item.path), ["a.ts", "a.ts"]);
  assert.deepEqual(grouped.unstaged.map((item) => item.path), ["c.ts"]);
  assert.deepEqual(grouped.untracked.map((item) => item.path), ["b.ts"]);
  assert.deepEqual(grouped.conflicted.map((item) => item.path), ["d.ts"]);
});

test("stage actions only apply to unstaged/untracked/conflicted", () => {
  assert.equal(canStageFile(file("changed")), true);
  assert.equal(canStageFile(file("untracked", "u.ts", "??")), true);
  assert.equal(canStageFile(file("conflicted", "c.ts", "UU")), true);
  assert.equal(canStageFile(file("staged")), false);
  assert.equal(canStageFile(file("staged-changed", "b.ts", "MM")), false);

  assert.equal(canUnstageFile(file("staged")), true);
  assert.equal(canUnstageFile(file("staged-changed", "b.ts", "MM")), true);
  assert.equal(canUnstageFile(file("changed")), false);
  assert.equal(canUnstageFile(file("untracked", "u.ts", "??")), false);
});

test("renders git marks and labels", () => {
  assert.equal(gitFileMark(file("untracked", "u", "??")), "?");
  assert.equal(gitFileMark(file("conflicted", "c", "UU")), "!");
  assert.equal(gitFileMark(file("staged", "a", "A ")), "A");
  assert.equal(gitFileMark(file("changed", "d", " D")), "D");
  assert.equal(gitFileMark(file("changed")), "M");
  assert.equal(gitFileMark({ ...file("changed"), isRenamed: true, code: "R  " }), "R");

  assert.equal(gitFileLabel(file("untracked", "u", "??")), "未跟踪");
  assert.equal(gitFileLabel(file("conflicted", "c", "UU")), "冲突");
  assert.equal(gitFileLabel(file("staged", "a", "A ")), "已添加");
  assert.equal(gitFileLabel(file("changed", "d", " D")), "已删除");
  assert.equal(gitFileLabel(file("staged")), "已暂存");
  assert.equal(gitFileLabel(file("staged-changed", "b", "MM")), "暂存 + 修改");
  assert.equal(gitFileLabel({ ...file("changed"), isRenamed: true, code: "R  " }), "已重命名");
});

test("classifies unified diff lines", () => {
  assert.equal(diffLineKind("diff --git a/x.ts b/x.ts"), "meta");
  assert.equal(diffLineKind("index 123..456 100644"), "meta");
  assert.equal(diffLineKind("--- a/x.ts"), "meta");
  assert.equal(diffLineKind("+++ b/x.ts"), "meta");
  assert.equal(diffLineKind("new file mode 100644"), "meta");
  assert.equal(diffLineKind("\\ No newline at end of file"), "meta");
  assert.equal(diffLineKind("@@ -1,3 +1,4 @@"), "hunk");
  assert.equal(diffLineKind("+console.log(1)"), "add");
  assert.equal(diffLineKind("-const x = 1"), "remove");
  assert.equal(diffLineKind(" const x = 1"), "context");
  assert.equal(diffLineKind(""), "context");
});

test("formats relative time in Chinese", () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRelativeTime(now / 1000, now), "刚刚");
  assert.equal(formatRelativeTime(now / 1000 - 59, now), "刚刚");
  assert.equal(formatRelativeTime(now / 1000 - 60, now), "1 分钟前");
  assert.equal(formatRelativeTime(now / 1000 - 3599, now), "59 分钟前");
  assert.equal(formatRelativeTime(now / 1000 - 3600, now), "1 小时前");
  assert.equal(formatRelativeTime(now / 1000 - 86_400, now), "昨天");
  assert.equal(formatRelativeTime(now / 1000 - 86_400 * 5, now), "5 天前");
  assert.match(formatRelativeTime(now / 1000 - 86_400 * 400, now), /^2022-\d{2}-\d{2}$/);
  assert.equal(formatRelativeTime(0, now), "");
});

test("splits branches into local and remote groups", () => {
  const branch = (name, isRemote, isCurrent = false) => ({
    name, isCurrent, isRemote, upstream: null, shortOid: "abc123",
  });
  const local = branch("main", false, true);
  const feature = branch("feature", false);
  const remote = branch("origin/main", true);
  const grouped = groupGitBranches([remote, local, feature]);
  assert.deepEqual(grouped.local, [local, feature]);
  assert.deepEqual(grouped.remote, [remote]);
});
