// i18n 文案键守卫：源码里传给 `t()` 的每个键都必须能在 zh/en 资源里找到，
// 否则 `t()` 会把 key 原样显示给用户（例如界面上出现 `git.error.stashListFailed`）。
//
// 只扫描 `t(...)` 实参里的字面量：DSH 的 namespace/method 名（`settings.describe`）
// 形状相同但不是文案键，按调用点取值才不会误报。

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "./locales/en.json" with { type: "json" };
import zh from "./locales/zh.json" with { type: "json" };

const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/u;

function collectSourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "locales") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, found);
      continue;
    }
    if (/\.(ts|tsx)$/u.test(entry)) found.push(full);
  }
  return found;
}

/** 取 `t(...)` 实参里的字符串字面量：括号配平地扫过去，最多看 400 字符。 */
function collectMessageKeys(text, keys) {
  for (const call of text.matchAll(/\bt\(/gu)) {
    let depth = 1;
    let index = call.index + 2;
    const limit = Math.min(text.length, index + 400);
    while (index < limit && depth > 0) {
      const char = text[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if (char === '"') {
        const end = text.indexOf('"', index + 1);
        if (end === -1) break;
        const literal = text.slice(index + 1, end);
        if (MESSAGE_KEY.test(literal)) keys.add(literal);
        index = end;
      }
      index += 1;
    }
  }
  return keys;
}

test("every message key passed to t() exists in both locales", () => {
  const missing = [];
  for (const file of collectSourceFiles(SOURCE_ROOT)) {
    const keys = collectMessageKeys(readFileSync(file, "utf8"), new Set());
    for (const key of keys) {
      if (key in zh && key in en) continue;
      missing.push(`${file.slice(SOURCE_ROOT.length)}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `以下文案键在 zh.json / en.json 里缺失：\n${missing.join("\n")}`);
});

test("zh and en expose exactly the same key set", () => {
  const onlyZh = Object.keys(zh).filter((key) => !(key in en));
  const onlyEn = Object.keys(en).filter((key) => !(key in zh));
  assert.deepEqual(onlyZh, [], "只在 zh.json 里的键");
  assert.deepEqual(onlyEn, [], "只在 en.json 里的键");
});

test("message placeholders stay in sync between locales", () => {
  const placeholders = (text) => (text.match(/\{(\w+)\}/gu) ?? []).sort().join(",");
  const mismatched = [];
  for (const key of Object.keys(zh)) {
    if (!(key in en)) continue;
    if (placeholders(zh[key]) !== placeholders(en[key])) {
      mismatched.push(`${key}: zh={${placeholders(zh[key])}} en={${placeholders(en[key])}}`);
    }
  }
  assert.deepEqual(mismatched, [], `中英文占位符不一致：\n${mismatched.join("\n")}`);
});

/** 同一份资源里重复出现的键名。JSON 解析只保留最后一条，被覆盖的那条会静默失效。 */
function duplicateMessageKeys(text) {
  const seen = new Set();
  const duplicates = [];
  // 每行一个 `"键": 值`；JSON 的值不能跨行，所以按行取名是安全的。
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*"((?:[^"\\]|\\.)+)"\s*:/u.exec(line);
    if (!match) continue;
    const key = JSON.parse(`"${match[1]}"`);
    if (seen.has(key)) duplicates.push(key);
    else seen.add(key);
  }
  return duplicates;
}

test("no locale file defines the same message key twice", () => {
  const localeDir = fileURLToPath(new URL("./locales", import.meta.url));
  const duplicates = [];
  for (const name of readdirSync(localeDir).filter((entry) => entry.endsWith(".json")).sort()) {
    for (const key of duplicateMessageKeys(readFileSync(join(localeDir, name), "utf8"))) {
      duplicates.push(`${name}: ${key}`);
    }
  }
  // 重复键只会让最后一条生效，界面显示的是被覆盖的文案（打包器也只会打一条警告）。
  assert.deepEqual(duplicates, [], `语言资源里重复定义的键（后一条覆盖前一条）：\n${duplicates.join("\n")}`);
});
