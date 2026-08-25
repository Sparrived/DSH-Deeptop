/**
 * i18n 资源校验：检查 src/app/locales/*.json 的完整性与一致性。
 *
 * zh.json 为权威 key 集合；其余语言必须：
 * 1. key 集合与 zh 完全一致（不缺漏、不多余）；
 * 2. 每个 key 的 `{param}` 占位符集合与 zh 一致（防止漏参数或错参数名）。
 *
 * 用法：npm run i18n:check（有缺口时退出码非 0）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const dir = resolve("src/app/locales");
const files = readdirSync(dir).filter((name) => /^[a-z]{2,3}\.json$/.test(name)).sort();
if (files.length === 0) {
  console.error("未找到语言资源文件（src/app/locales/*.json）");
  process.exit(1);
}

const tables = Object.fromEntries(files.map((name) => [basename(name, ".json"), JSON.parse(readFileSync(resolve(dir, name), "utf8"))]));
const zh = tables.zh;
if (!zh) {
  console.error("缺少权威资源 zh.json");
  process.exit(1);
}

const placeholder = (text) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).size
  ? [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
  : [];

let issues = 0;
for (const locale of Object.keys(tables)) {
  if (locale === "zh") continue;
  const table = tables[locale];
  const zhKeys = Object.keys(zh).sort();
  const missing = zhKeys.filter((key) => !(key in table));
  const extra = Object.keys(table).filter((key) => !(key in zh));
  if (missing.length > 0) {
    issues += missing.length;
    console.error(`[${locale}] 缺 ${missing.length} 个 key（回退英文/中文）：`);
    for (const key of missing.slice(0, 30)) console.error(`  - ${key}`);
    if (missing.length > 30) console.error(`  … 共 ${missing.length} 个`);
  }
  if (extra.length > 0) {
    issues += extra.length;
    console.error(`[${locale}] 多余 ${extra.length} 个 key（zh 未收录）：${extra.slice(0, 10).join(", ")}`);
  }
  let paramMismatch = 0;
  for (const key of zhKeys) {
    const zhParams = placeholder(zh[key]);
    const locParams = placeholder(table[key] ?? "");
    if (JSON.stringify(zhParams) !== JSON.stringify(locParams)) {
      paramMismatch += 1;
      if (paramMismatch <= 10) console.error(`  - ${key} 占位符不一致：zh=${zhParams.join(",") || "无"} ${locale}=${locParams.join(",") || "无"}`);
    }
  }
  if (paramMismatch > 0) {
    issues += paramMismatch;
    console.error(`[${locale}] ${paramMismatch} 个 key 占位符不一致`);
  }
}

if (issues === 0) {
  console.log(`i18n 资源校验通过：${Object.keys(tables).length} 种语言，${Object.keys(zh).length} 个 key，全量一致`);
} else {
  console.error(`i18n 资源校验失败：${issues} 处缺口`);
  process.exit(1);
}