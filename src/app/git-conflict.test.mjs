import assert from "node:assert/strict";
import test from "node:test";
import {
  conflictResolutionContent,
  conflictSideAvailability,
  countConflictMarkers,
  initialConflictDraft,
} from "./git-conflict.ts";

const conflict = (extra = {}) => ({
  path: "src/app.ts",
  worktree: null,
  base: "base\n",
  ours: "ours\n",
  theirs: "theirs\n",
  ...extra,
});

test("reports which sides have content", () => {
  assert.deepEqual(conflictSideAvailability(conflict()), { base: true, ours: true, theirs: true });
  // delete/modify 这类冲突会缺某一侧的 stage
  assert.deepEqual(
    conflictSideAvailability(conflict({ ours: null })),
    { base: true, ours: false, theirs: true },
  );
  assert.deepEqual(
    conflictSideAvailability(conflict({ base: null })),
    { base: false, ours: true, theirs: true },
  );
});

test("composes the resolution for each direction", () => {
  assert.equal(conflictResolutionContent("ours", conflict()), "ours\n");
  assert.equal(conflictResolutionContent("theirs", conflict()), "theirs\n");
  // 两侧拼接：当前在前、传入在后，并且保证分隔换行
  assert.equal(conflictResolutionContent("both", conflict()), "ours\ntheirs\n");
  assert.equal(
    conflictResolutionContent("both", conflict({ ours: "ours-without-newline" })),
    "ours-without-newline\ntheirs\n",
  );
  // 缺一侧时「两者都保留」退化为保留存在的那一侧
  assert.equal(conflictResolutionContent("both", conflict({ ours: null })), "theirs\n");
  assert.equal(conflictResolutionContent("both", conflict({ theirs: null })), "ours\n");
  assert.equal(conflictResolutionContent("ours", conflict({ ours: null })), "");
});

test("counts the unresolved conflict markers still in the draft", () => {
  const draft = [
    "line before",
    "<<<<<<< HEAD",
    "ours",
    "=======",
    "theirs",
    ">>>>>>> feature",
    "middle",
    "<<<<<<< HEAD",
    "ours again",
    "=======",
    "theirs again",
    ">>>>>>> feature",
  ].join("\n");
  assert.equal(countConflictMarkers(draft), 2);
  assert.equal(countConflictMarkers("no markers here"), 0);
  assert.equal(countConflictMarkers(null), 0);
  // `=======` 与 `>>>>>>>` 单独出现不算一处冲突
  assert.equal(countConflictMarkers("=======\n>>>>>>> feature"), 0);
});

test("starts the draft from the worktree content", () => {
  assert.equal(initialConflictDraft({ worktree: "partial\n" }), "partial\n");
  // 文件在工作区不存在（例如被对方删除）时草稿为空，用户在界面上选择采用哪一侧
  assert.equal(initialConflictDraft({ worktree: null }), "");
});
