import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { codeBlockLines } from "./code-block.ts";

const stylesheet = readFileSync(
  fileURLToPath(new URL("../styles/09-workbench-messages.css", import.meta.url)),
  "utf8",
);

test("joins back to the exact source so copy cannot gain or lose characters", () => {
  const source = 'const a = 1\nconsole.log("b")\nreturn a';
  assert.deepEqual(codeBlockLines(source), ['const a = 1', 'console.log("b")', "return a"]);
  assert.equal(codeBlockLines(source).join("\n"), source);
});

test("treats one trailing newline as the block terminator, not an empty line", () => {
  assert.deepEqual(codeBlockLines("one line\n"), ["one line"]);
  assert.deepEqual(codeBlockLines("first\nsecond\n"), ["first", "second"]);
  // A deliberately blank last line is content and must survive.
  assert.deepEqual(codeBlockLines("first\n\n"), ["first", ""]);
  assert.deepEqual(codeBlockLines(""), [""]);
});

test("numbers the gutter from CSS so digits never reach the clipboard", () => {
  // The regression this guards: rendering line numbers as DOM text would put
  // them into the copied code. The gutter must stay generated content.
  const gutter = /\.markdown-code-block\.numbered \.md-code-line::before\s*\{[^}]*\}/s.exec(stylesheet)?.[0];
  assert.ok(gutter, "the numbered gutter rule is missing from the stylesheet");
  assert.match(gutter, /content:\s*counter\(source-line\)/);
  assert.match(gutter, /user-select:\s*none/);
  assert.match(stylesheet, /\.markdown-code-block\.numbered pre code\s*\{\s*counter-reset:\s*source-line/);
});
