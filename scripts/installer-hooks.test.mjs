import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const hookPath = path.join(root, "src-tauri", config.bundle.windows.nsis.installerHooks);
const hook = readFileSync(hookPath, "utf8");

test("NSIS 安装钩子在安装结束前准备内嵌 DSH 运行时", () => {
  assert.match(hook, /--prepare-bundled-runtime/);
  assert.match(hook, /nsExec::ExecToLog \/TIMEOUT=900000/);
  assert.match(hook, /Pop \$0/);
  assert.match(hook, /\$0 != \"0\"/);
  assert.match(hook, /Abort/);
});
