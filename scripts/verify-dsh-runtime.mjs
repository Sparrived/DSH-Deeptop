import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(root, "src-tauri", "resources", "dsh-runtime");
const manifestPath = path.join(runtimeRoot, "runtime-manifest.json");
const packagePath = path.join(runtimeRoot, "node_modules", "@deepseek-ai", "dsh", "package.json");
const entry = "node_modules/@deepseek-ai/dsh/lib/bin.js";

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 JSON 清单 ${filePath}：${error.message}`);
  }
}

function assertFile(relativePath, label) {
  const filePath = path.join(runtimeRoot, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`内嵌 DSH 缺少${label}：${filePath}`);
  }
}

const manifest = readJson(manifestPath);
if (
  manifest.format !== 1 ||
  manifest.packageName !== "@deepseek-ai/dsh" ||
  manifest.entry !== entry ||
  manifest.platform !== process.platform ||
  manifest.arch !== process.arch
) {
  throw new Error(`内嵌 DSH 运行时清单不匹配当前平台：${manifestPath}`);
}
if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) {
  throw new Error(`内嵌 DSH 清单缺少固定源码提交：${manifest.sourceCommit}`);
}

const dshPackage = readJson(packagePath);
if (dshPackage.name !== "@deepseek-ai/dsh" || dshPackage.version !== manifest.packageVersion) {
  throw new Error(`内嵌 DSH 包版本不匹配：${dshPackage.name}@${dshPackage.version}`);
}
if (typeof dshPackage.bin?.dsh !== "string" || dshPackage.bin.dsh !== "lib/bin.js") {
  throw new Error("内嵌 DSH CLI 清单缺少安全的 dsh 入口");
}

function assertNoLinks(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const itemPath = path.join(directory, item.name);
    const stat = fs.lstatSync(itemPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`内嵌 DSH 运行时不能包含符号链接：${itemPath}`);
    }
    if (stat.isDirectory()) assertNoLinks(itemPath);
  }
}

assertNoLinks(runtimeRoot);

for (const relativePath of [
  entry,
  "DSH-LICENSE",
  "node_modules/@deepseek-ai/cosmokit/package.json",
  "node_modules/@deepseek-ai/schemastery/package.json",
  "node_modules/@deepseek-ai/cordis-plugin-group/package.json",
  "node_modules/@deepseek-ai/dsh-host-apiproxy/package.json",
]) {
  assertFile(relativePath, "必要文件");
}

console.log(`✅ 内嵌 DSH 校验通过：${manifest.packageVersion} @ ${manifest.sourceCommit}`);
