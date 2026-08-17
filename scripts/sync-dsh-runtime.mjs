import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "vendor", "dsh");
const outputRoot = path.join(root, "src-tauri", "resources", "dsh-runtime");
const sourceNodeModules = path.join(sourceRoot, "node_modules");
const cliManifestPath = path.join(sourceRoot, "apps", "cli", "package.json");
const entry = "node_modules/@deepseek-ai/dsh/lib/bin.js";
const force = process.argv.includes("--force");

function run(command, args, cwd, extraEnv = {}) {
  console.log(`\n▶ ${command} ${args.join(" ")}`);
  const spawnCommand = process.platform === "win32" && command.endsWith(".cmd") ? process.env.ComSpec ?? "cmd.exe" : command;
  const spawnArgs = spawnCommand === command ? args : ["/d", "/s", "/c", command, ...args];
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} 执行失败，退出码 ${result.status ?? 1}`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: sourceRoot, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`无法读取 DSH 源码版本：${result.stderr?.trim() || result.status}`);
  }
  return result.stdout.trim();
}

function isRuntimeReady(manifest, packageVersion) {
  return (
    !force &&
    manifest?.sourceCommit === gitOutput(["rev-parse", "HEAD"]) &&
    manifest?.packageVersion === packageVersion &&
    manifest?.entry === entry &&
    manifest?.platform === process.platform &&
    manifest?.arch === process.arch &&
    fs.existsSync(path.join(outputRoot, entry)) &&
    fs.existsSync(path.join(outputRoot, "node_modules", "@deepseek-ai", "cosmokit", "package.json")) &&
    fs.existsSync(path.join(outputRoot, "node_modules", "@deepseek-ai", "schemastery", "package.json")) &&
    fs.existsSync(path.join(outputRoot, "node_modules", "@deepseek-ai", "cordis-plugin-group", "package.json"))
  );
}

if (!fs.existsSync(path.join(sourceRoot, ".git")) && !fs.existsSync(path.join(root, ".gitmodules"))) {
  throw new Error("缺少 vendor/dsh 子模块，请使用 git clone --recurse-submodules 或 git submodule update --init --recursive");
}
if (!fs.existsSync(cliManifestPath)) {
  throw new Error(`缺少 DSH CLI 清单：${cliManifestPath}`);
}

const cliManifest = readJson(cliManifestPath);
const packageVersion = cliManifest.version;
const sourceCommit = gitOutput(["rev-parse", "HEAD"]);
const dirty = gitOutput(["status", "--porcelain"]);
if (dirty) {
  throw new Error("vendor/dsh 工作区不是干净的；请提交或还原源码改动后再生成发布运行时");
}

const currentManifestPath = path.join(outputRoot, "runtime-manifest.json");
const currentManifest = fs.existsSync(currentManifestPath) ? readJson(currentManifestPath) : null;
if (isRuntimeReady(currentManifest, packageVersion)) {
  console.log(`✅ 内嵌 DSH 已是最新：${packageVersion} @ ${sourceCommit}`);
  process.exit(0);
}

const buildToolsReady =
  fs.existsSync(path.join(sourceNodeModules, "typescript", "bin", "tsc")) &&
  fs.existsSync(path.join(sourceNodeModules, "tsdown", "dist", "run.mjs"));
if (!fs.existsSync(sourceNodeModules) || !buildToolsReady) {
  const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
  run(corepack, ["pnpm", "install", "--frozen-lockfile"], sourceRoot, { CI: "true" });
}

const cliEntry = path.join(sourceRoot, "apps", "cli", "lib", "bin.js");
if (!fs.existsSync(cliEntry) || force) {
  run(process.execPath, [path.join(sourceRoot, "node_modules", "typescript", "bin", "tsc"), "-b", "tsconfig.host.json"], sourceRoot);
  run(process.execPath, [path.join(sourceRoot, "node_modules", "tsdown", "dist", "run.mjs"), "--env.DSH_BUILD_FACE", "host"], sourceRoot);
}
if (!fs.existsSync(cliEntry)) {
  throw new Error(`DSH 源码构建完成但没有找到 CLI 入口：${cliEntry}`);
}

const temporaryRoot = `${outputRoot}.tmp-${process.pid}`;
const deployRoot = `${outputRoot}.deploy-${process.pid}`;
fs.rmSync(temporaryRoot, { recursive: true, force: true });
fs.rmSync(deployRoot, { recursive: true, force: true });
fs.mkdirSync(temporaryRoot, { recursive: true });

try {
  const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
  run(
    corepack,
    [
      "pnpm",
      "--config.ignore-scripts=true",
      "--config.node-linker=hoisted",
      "--filter",
      "@deepseek-ai/dsh",
      "deploy",
      "--prod",
      "--legacy",
      deployRoot,
    ],
    sourceRoot,
    { CI: "true" },
  );

  const bundledPackageRoot = path.join(temporaryRoot, "node_modules", "@deepseek-ai", "dsh");
  fs.mkdirSync(bundledPackageRoot, { recursive: true });
  fs.cpSync(deployRoot, bundledPackageRoot, { recursive: true, dereference: true, filter: (source) => {
    const relative = path.relative(deployRoot, source);
    return !relative.split(path.sep).includes("node_modules");
  }});
  fs.cpSync(path.join(deployRoot, "node_modules"), path.join(temporaryRoot, "node_modules"), {
    recursive: true,
    dereference: true,
    filter(source) {
      const relative = path.relative(path.join(deployRoot, "node_modules"), source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      return !parts.includes(".pnpm") && !parts.includes(".bin") && !parts.includes(".cache");
    },
  });

  // pnpm deploy resolves registry packages but omits workspace-only packages.
  // Copy every built package from the DSH source's vendor workspace into the
  // flat runtime tree; the profile may import any of these host plugins.
  const vendorPackages = fs.readdirSync(path.join(sourceRoot, "vendor"), { withFileTypes: true });
  for (const vendorPackage of vendorPackages) {
    if (!vendorPackage.isDirectory()) continue;
    const packageSource = path.join(sourceRoot, "vendor", vendorPackage.name);
    const packageManifestPath = path.join(packageSource, "package.json");
    if (!fs.existsSync(packageManifestPath)) continue;
    const packageManifest = readJson(packageManifestPath);
    if (typeof packageManifest.name !== "string" || !packageManifest.name.startsWith("@deepseek-ai/")) continue;
    const packageParts = packageManifest.name.split("/");
    const packageTarget = path.join(temporaryRoot, "node_modules", ...packageParts);
    fs.rmSync(packageTarget, { recursive: true, force: true });
    fs.cpSync(packageSource, packageTarget, {
      recursive: true,
      dereference: true,
      filter(source) {
        const relative = path.relative(packageSource, source);
        return !relative || !relative.split(path.sep).some((part) => part === "node_modules" || part === ".cache");
      },
    });
  }

  const runtimePackage = {
    name: "deeptop-dsh-runtime",
    private: true,
    dshSourceCommit: sourceCommit,
    dshVersion: packageVersion,
  };
  fs.writeFileSync(path.join(temporaryRoot, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  fs.copyFileSync(path.join(sourceRoot, "LICENSE"), path.join(temporaryRoot, "DSH-LICENSE"));

  const packagedManifest = path.join(temporaryRoot, "node_modules", "@deepseek-ai", "dsh", "package.json");
  const packagedEntry = path.join(temporaryRoot, entry);
  if (!fs.existsSync(packagedManifest) || !fs.existsSync(packagedEntry)) {
    throw new Error("生成的内嵌运行时缺少 @deepseek-ai/dsh/package.json 或 lib/bin.js");
  }
  const packaged = readJson(packagedManifest);
  if (packaged.name !== "@deepseek-ai/dsh" || packaged.version !== packageVersion) {
    throw new Error(`内嵌 DSH 清单版本不匹配：${packaged.name}@${packaged.version}`);
  }

  const manifest = {
    format: 1,
    packageName: "@deepseek-ai/dsh",
    packageVersion,
    sourceRepository: "https://github.com/deepseek-ai/deepseek-harness.git",
    sourceCommit,
    build: "host",
    platform: process.platform,
    arch: process.arch,
    entry,
  };
  fs.writeFileSync(path.join(temporaryRoot, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.renameSync(temporaryRoot, outputRoot);
  console.log(`✅ 已生成内嵌 DSH：${packageVersion} @ ${sourceCommit}`);
} catch (error) {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  throw error;
} finally {
  fs.rmSync(deployRoot, { recursive: true, force: true });
}
