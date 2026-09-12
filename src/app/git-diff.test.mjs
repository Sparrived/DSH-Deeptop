import assert from "node:assert/strict";
import test from "node:test";
import { buildHunkPatch, gitDiffLineKinds, parseGitDiff } from "./git-diff.ts";

/** 两处修改的普通文件差异（含文件头与两段 hunk）。 */
const TWO_HUNKS = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export { a, b, c };",
  "@@ -20,3 +21,3 @@ function tail() {",
  "   return 0;",
  "-  // old comment",
  "+  // new comment",
  " }",
].join("\n") + "\n";

test("parses hunks with their ranges and bodies", () => {
  const file = parseGitDiff(TWO_HUNKS);
  assert.equal(file.header.length, 4);
  assert.equal(file.header[0], "diff --git a/src/app.ts b/src/app.ts");
  assert.equal(file.hunks.length, 2);

  const [first, second] = file.hunks;
  assert.deepEqual(
    [first.oldStart, first.oldCount, first.newStart, first.newCount],
    [1, 4, 1, 5],
  );
  assert.equal(first.header, "@@ -1,4 +1,5 @@");
  assert.equal(first.line, 5);
  assert.deepEqual(first.lines, [
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    "+const c = 4;",
    " export { a, b, c };",
  ]);
  assert.deepEqual([second.oldStart, second.newStart], [20, 21]);
  assert.equal(second.lines.at(-1), " }");
  assert.deepEqual(file.trailing, []);
});

test("builds a patch with only the selected hunks", () => {
  const file = parseGitDiff(TWO_HUNKS);
  const firstOnly = buildHunkPatch(file, [file.hunks[0].line]);
  assert.equal(
    firstOnly,
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,4 +1,5 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      "+const c = 4;",
      " export { a, b, c };",
      "",
    ].join("\n"),
  );
  // 只含第二块时不会带上第一块的正文
  const secondOnly = buildHunkPatch(file, [file.hunks[1].line]);
  assert.equal(secondOnly.includes("const c = 4;"), false);
  assert.equal(secondOnly.includes("// new comment"), true);
  // 两块一起等于原样
  assert.equal(buildHunkPatch(file, file.hunks.map((hunk) => hunk.line)), TWO_HUNKS);
  // 没有选中任何块时返回空串：调用方据此拒绝请求
  assert.equal(buildHunkPatch(file, []), "");
  assert.equal(buildHunkPatch(file, [999]), "");
});

test("keeps single-line hunk ranges when the count is omitted", () => {
  const file = parseGitDiff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3 +3 @@\n-x\n+y\n");
  assert.equal(file.hunks.length, 1);
  assert.deepEqual(
    [file.hunks[0].oldCount, file.hunks[0].newCount],
    [1, 1],
  );
  assert.equal(buildHunkPatch(file, [file.hunks[0].line]).includes("@@ -3 +3 @@"), true);
});

test("survives diffs without hunks and keeps binary notices", () => {
  const binary = parseGitDiff("diff --git a/logo.png b/logo.png\nindex 1111111..2222222 100644\nBinary files a/logo.png and b/logo.png differ\n");
  assert.equal(binary.hunks.length, 0);
  assert.equal(binary.header.length, 3);
  assert.equal(buildHunkPatch(binary, [1]), "");
  assert.deepEqual(parseGitDiff("").hunks, []);
});

test("keeps no-newline markers inside the hunk they belong to", () => {
  const file = parseGitDiff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n");
  assert.deepEqual(file.hunks[0].lines, ["-old", "\\ No newline at end of file", "+new"]);
  assert.equal(buildHunkPatch(file, [4]).includes("\\ No newline"), true);
});

test("classifies diff lines the same way the viewer does", () => {
  const kinds = gitDiffLineKinds("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n context\n");
  // 与 `text.split("\n").map(diffLineKind)` 一致：结尾换行会产生一个空行（context）
  assert.deepEqual(kinds, ["meta", "meta", "meta", "hunk", "remove", "add", "context", "context"]);
});
