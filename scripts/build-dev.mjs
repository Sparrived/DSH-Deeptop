#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cargoManifest = path.join(root, "src-tauri", "Cargo.toml");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

const version = args.find((value) => !value.startsWith("-"));
if (!version) {
  printUsage();
  process.exitCode = 1;
  console.error("\n缺少开发版本号，例如：0.1.2-dev.2");
  process.exit();
}

if (!/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`开发构建必须使用带 prerelease 的 SemVer，例如 0.1.2-dev.2，实际为：${version}`);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function printUsage() {
  console.log(`用法：npm run build:dev -- <开发版本号>

示例：
  npm run build:dev -- 0.1.2-dev.2

流程：
  1. 同步并检查所有版本清单
  2. 运行 JavaScript 测试和前端构建
  3. 运行 Rust fmt、check、test 和 clippy
  4. 构建本地 Windows x64 NSIS 安装包

脚本只修改本地版本清单和构建产物，不执行 git push、Tag 或 GitHub Release。`);
}

function run(command, commandArgs, label) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(npmCommand, ["run", "version:set", "--", version], "同步版本清单");
run(npmCommand, ["run", "version:check"], "检查版本一致性");
run(npmCommand, ["test"], "运行 JavaScript 测试");
run(npmCommand, ["run", "build"], "构建前端资源");
run("cargo", ["fmt", "--manifest-path", cargoManifest, "--all", "--", "--check"], "检查 Rust 格式");
run("cargo", ["check", "--manifest-path", cargoManifest], "检查 Rust 编译");
run("cargo", ["test", "--manifest-path", cargoManifest], "运行 Rust 测试");
run("cargo", ["clippy", "--manifest-path", cargoManifest, "--all-targets", "--", "-D", "warnings"], "运行 Rust Clippy");
run(npmCommand, ["run", "tauri:build"], "构建 Windows x64 NSIS 安装包");

const artifact = path.join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
  `Deeptop_${version}_x64-setup.exe`,
);
if (!existsSync(artifact)) {
  throw new Error(`构建完成但没有找到安装包：${artifact}`);
}

const bytes = readFileSync(artifact);
const size = statSync(artifact).size;
const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
console.log(`\n✅ 开发版构建完成：${version}`);
console.log(`安装包：${artifact}`);
console.log(`大小：${size} bytes`);
console.log(`SHA256：${sha256}`);
console.log("未执行 git push、Tag 或 GitHub Release。");
