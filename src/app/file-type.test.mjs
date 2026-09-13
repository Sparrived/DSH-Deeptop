import assert from "node:assert/strict";
import test from "node:test";
import { classifyFileType, fileExtension, fileTypeLabel } from "./file-type.ts";

test("extracts the final suffix without changing its case", () => {
  assert.equal(fileExtension("src/app/model.ts"), "ts");
  assert.equal(fileExtension("C:\\work\\README.MD"), "MD");
  assert.equal(fileExtension("Makefile"), "");
  assert.equal(fileExtension("archive."), "");
  assert.equal(fileExtension(".gitignore"), "gitignore");
});

test("classifies by extension, case-insensitively and across separators", () => {
  assert.equal(classifyFileType("src/components/App.tsx"), "code");
  assert.equal(classifyFileType("C:\\work\\LOGO.PNG"), "image");
  assert.equal(classifyFileType("notes/readme.md"), "markdown");
  assert.equal(classifyFileType("report.pdf"), "pdf");
  assert.equal(classifyFileType("deck.pptx"), "ppt");
  assert.equal(classifyFileType("clip.mkv"), "video");
  assert.equal(classifyFileType("sheet.xlsx"), "excel");
  assert.equal(classifyFileType("memo.docx"), "word");
  assert.equal(classifyFileType("index.html"), "html");
});

test("applies filename rules before extension rules and falls back to other", () => {
  assert.equal(classifyFileType("docs/CHANGELOG"), "markdown");
  assert.equal(classifyFileType("CONTRIBUTING"), "markdown");
  assert.equal(classifyFileType("LICENSE"), "other");
  assert.equal(classifyFileType(""), "other");
  assert.equal(classifyFileType("dir/"), "other");
});

test("labels come from the classification, not the raw extension", () => {
  assert.equal(fileTypeLabel("a/b/main.ts"), "CODE");
  assert.equal(fileTypeLabel("a/b/photo.webp"), "IMG");
  assert.equal(fileTypeLabel("a/b/LICENSE"), "FILE");
  assert.notEqual(fileTypeLabel("a/b/main.ts"), "TS");
});
