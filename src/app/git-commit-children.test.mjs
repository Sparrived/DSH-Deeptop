import assert from "node:assert/strict";
import test from "node:test";
import {
  GIT_COMMIT_CHILD_ACTIONS,
  GIT_COMMIT_CHILD_PADDING,
  GIT_COMMIT_CHILD_ROW_HEIGHT,
  gitCommitChildrenHeight,
} from "./git-model.ts";

test("computes the height of the inline commit file block", () => {
  assert.equal(gitCommitChildrenHeight(0, false), GIT_COMMIT_CHILD_PADDING);
  assert.equal(gitCommitChildrenHeight(0, true), GIT_COMMIT_CHILD_PADDING + GIT_COMMIT_CHILD_ACTIONS);
  assert.equal(
    gitCommitChildrenHeight(3, true),
    GIT_COMMIT_CHILD_PADDING + 3 * GIT_COMMIT_CHILD_ROW_HEIGHT + GIT_COMMIT_CHILD_ACTIONS,
  );
  // 负数按 0 处理：加载中/失败时不至于算出负高度
  assert.equal(gitCommitChildrenHeight(-2, false), GIT_COMMIT_CHILD_PADDING);
});
