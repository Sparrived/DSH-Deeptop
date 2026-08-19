import assert from "node:assert/strict";
import test from "node:test";
import { entityHost, pathLabel, recognizeMessageEntities, splitMessageEntities } from "./message-entities.ts";

test("recognizes Windows, Unix and relative file paths", () => {
  const entities = recognizeMessageEntities("打开 C:\\repo\\src\\App.tsx、/workspace/README.md 和 ./src/main.rs。");
  assert.deepEqual(entities.map(({ kind, value }) => ({ kind, value })), [
    { kind: "file", value: "C:\\repo\\src\\App.tsx" },
    { kind: "file", value: "/workspace/README.md" },
    { kind: "file", value: "./src/main.rs" },
  ]);
});

test("recognizes connections and trims sentence punctuation", () => {
  const entities = recognizeMessageEntities("参考 https://example.com/docs?q=1#intro，再看 http://localhost:3000/path.");
  assert.deepEqual(entities.map(({ kind, value }) => ({ kind, value })), [
    { kind: "connection", value: "https://example.com/docs?q=1#intro" },
    { kind: "connection", value: "http://localhost:3000/path" },
  ]);
  assert.equal(entityHost("https://example.com/docs?q=1"), "example.com");
});

test("does not turn ordinary slash text or unsafe schemes into cards", () => {
  assert.deepEqual(recognizeMessageEntities("版本 1/2，执行 javascript:alert(1) 或 data:text/plain,hi"), []);
  assert.deepEqual(recognizeMessageEntities("项目/图层后才能添加字段，避免丢失编辑。"), []);
  assert.deepEqual(recognizeMessageEntities("模型输出 /图层后才能添加字段。"), []);
});

test("keeps absolute Unix paths with multiple segments as entities", () => {
  assert.deepEqual(recognizeMessageEntities("检查 /workspace/project 后再继续。"), [
    { kind: "file", value: "/workspace/project", start: 3, end: 21 },
  ]);
});

test("does not mark Chinese prose after a slash as a file link", () => {
  const text = "检测到 `YSSZ_NEW.gdb` 当前被 ArcGIS Pro 占用，独占方案锁无法获取，锁文件显示占用进程为 ArcGISPro.exe (PID 15604)。需要用户关闭正在打开该 GDB 的 ArcGIS Pro 项目/图层后才能添加字段，避免强制结束进程造成未保存编辑丢失。";
  assert.deepEqual(splitMessageEntities(text), [{ kind: "text", value: text }]);
});

test("splits text without changing entity values", () => {
  assert.deepEqual(splitMessageEntities("查看 ./src/App.tsx，然后访问 https://example.com"), [
    { kind: "text", value: "查看 " },
    { kind: "file", value: "./src/App.tsx" },
    { kind: "text", value: "，然后访问 " },
    { kind: "connection", value: "https://example.com" },
  ]);
});

test("labels paths by file name and directory", () => {
  assert.deepEqual(pathLabel("C:\\repo\\src\\App.tsx"), { name: "App.tsx", directory: "C:\\repo\\src" });
  assert.deepEqual(pathLabel("README.md"), { name: "README.md", directory: "路径" });
});
