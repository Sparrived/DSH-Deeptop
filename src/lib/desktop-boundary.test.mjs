import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 前端只允许 `src/lib/desktop.ts` 直接依赖 Tauri。
 *
 * 这条边界决定了换掉外壳的成本：只要 Tauri 的 import 全部收口在一个文件里，
 * 替换 IPC/窗口实现就是改一个文件；一旦散落回组件里，成本立刻变成全仓搜索。
 * 因此这里用测试锁住，而不是靠约定。
 */
const DESKTOP_TRANSPORT = fileURLToPath(new URL("./desktop.ts", import.meta.url));
const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 收集 src/ 下的 ts/tsx 源码，跳过 desktop.ts 自身。 */
function collectSourceFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectSourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry) && path !== DESKTOP_TRANSPORT) {
      found.push(path);
    }
  }
  return found;
}

test("only desktop.ts imports the Tauri API directly", () => {
  const offenders = [];
  for (const path of collectSourceFiles(SOURCE_ROOT)) {
    const source = readFileSync(path, "utf8");
    if (/from\s+["']@tauri-apps\//.test(source)) {
      offenders.push(path.slice(SOURCE_ROOT.length).replaceAll("\\", "/"));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `import Tauri only through lib/desktop.ts; offenders: ${offenders.join(", ")}`,
  );
});

test("desktop.ts re-exports the transport-neutral surface", () => {
  const source = readFileSync(DESKTOP_TRANSPORT, "utf8");
  // 调用方需要的类型与窗口原语必须有中立出口，否则组件只能回头 import Tauri。
  assert.match(source, /export type UnlistenFn\b/, "UnlistenFn must be re-exported");
  assert.match(source, /export function currentWindow\b/, "currentWindow must be exported");
  assert.match(source, /export const isTauri\b/, "isTauri must be exported");
});
