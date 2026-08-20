import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "vendor", "dsh");
const resourcesRoot = path.join(root, "src-tauri", "resources");
const archivePath = path.join(resourcesRoot, "dsh-runtime.tar.gz");
const manifestPath = path.join(resourcesRoot, "dsh-runtime-manifest.json");
const legacyOutputRoot = path.join(resourcesRoot, "dsh-runtime");
const sourceNodeModules = path.join(sourceRoot, "node_modules");
const cliManifestPath = path.join(sourceRoot, "apps", "cli", "package.json");
const entry = "node_modules/@deepseek-ai/dsh/lib/bin.js";
const OPTIONAL_RUNTIME_PACKAGES = [
  ["@deepseek-ai/dsh-file-reference", "packages/context/file-reference", true],
  ["@deepseek-ai/dsh-file-reference-local", "packages/context/file-reference-local", true],
  ["@deepseek-ai/dsh-session-reference", "packages/context/session-reference", true],
  ["@deepseek-ai/dsh-tool-pwsh-persistent", "packages/shell/tool-pwsh-persistent", false],
  ["@deepseek-ai/dsh-terminal", "packages/terminal/terminal", true],
  ["@deepseek-ai/dsh-terminal-bash", "packages/terminal/terminal-bash", false],
  ["@deepseek-ai/dsh-pwsh-local", "packages/shell/pwsh-local", true],
  ["@deepseek-ai/dsh-subprocess", "packages/subprocess/subprocess", true],
  ["@deepseek-ai/dsh-subprocess-local", "packages/subprocess/subprocess-local", true],
  ["@deepseek-ai/dsh-sandbox", "packages/sandbox/sandbox", true],
  ["@deepseek-ai/dsh-sandbox-policy", "packages/sandbox/sandbox-policy", true],
  ["@deepseek-ai/dsh-sandbox-local", "packages/sandbox/sandbox-local", true],
  ["@deepseek-ai/dsh-timeout", "packages/util/timeout", false],
  ["@deepseek-ai/dsh-experimental-agent-team", "packages/experimental/agent-team", true],
  ["@deepseek-ai/dsh-experimental-tool-agent-team", "packages/experimental/tool-agent-team", false],
].map(([name, relativePath, defaultExport]) => ({
  name,
  sourcePath: path.join(sourceRoot, relativePath),
  defaultExport,
}));
const DESKTOP_PRESET_SOURCE_ROOT = path.join(root, "deeptop-bridge", "presets");
const DESKTOP_PRESETS = ["desktop-persistent-pwsh", "desktop-agent-teams"];
const GENERATED_HOST_ENTRY_PACKAGES = new Set(["@deepseek-ai/dsh-typert-protocol"]);
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

function treeSha256(rootPath) {
  const hash = createHash("sha256");
  function visit(directory, relativeDirectory = "") {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      Buffer.from(left.name).compare(Buffer.from(right.name)),
    );
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (relative === "runtime-manifest.json" || relative === ".complete") continue;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`内嵌运行时禁止符号链接：${relative}`);
      if (stat.isDirectory()) {
        hash.update(`D\n${relative}\n`);
        visit(absolute, relative);
      } else if (stat.isFile()) {
        hash.update(`F\n${relative}\n`);
        hash.update(fs.readFileSync(absolute));
      } else {
        throw new Error(`内嵌运行时包含不支持的文件类型：${relative}`);
      }
    }
  }
  visit(rootPath);
  return hash.digest("hex");
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
    manifest?.runtimeFeatures === 2 &&
    manifest?.entry === entry &&
    manifest?.platform === process.platform &&
    manifest?.arch === process.arch &&
    fs.existsSync(archivePath) &&
    fs.existsSync(manifestPath) &&
    typeof manifest?.treeSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(manifest.treeSha256)
  );
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertNoLinks(rootPath, label, shouldSkip = () => false) {
  const realRootPath = fs.realpathSync(rootPath);
  function visit(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (shouldSkip(relative)) continue;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        const target = fs.realpathSync(absolute);
        if (!isPathWithin(realRootPath, target)) {
          throw new Error(`${label} 包含指向根目录外部的符号链接或 junction：${relative}`);
        }
        continue;
      }
      if (stat.isDirectory()) visit(absolute, relative);
    }
  }
  visit(rootPath);
}

function packagePathForName(packageName) {
  return path.join(temporaryRoot, "node_modules", ...packageName.split("/"));
}

function copyRuntimePackage(packageSource, packageName) {
  assertNoLinks(packageSource, `源码包 ${packageName}`, (relative) =>
    relative.split(path.sep).some((part) => ["node_modules", "tests", "src", ".cache"].includes(part)),
  );
  const packageTarget = packagePathForName(packageName);
  fs.rmSync(packageTarget, { recursive: true, force: true });
  fs.cpSync(packageSource, packageTarget, {
    recursive: true,
    dereference: true,
    filter(source) {
      const relative = path.relative(packageSource, source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.includes("node_modules") || parts.includes("tests") || parts.includes("src") || parts.includes(".cache")) {
        return false;
      }
      return parts[0] === "lib" || parts[0] === "config" || parts[0] === "bin" || parts.length === 1;
    },
  });
}

function copyWorkspacePackages(workspaceRoot) {
  const manifests = [];
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name === ".git" || item.name === ".cache") continue;
      const itemPath = path.join(directory, item.name);
      if (item.isDirectory()) {
        visit(itemPath);
      } else if (item.isFile() && item.name === "package.json") {
        manifests.push(itemPath);
      }
    }
  }
  visit(workspaceRoot);
  for (const manifestPath of manifests) {
    const packageManifest = readJson(manifestPath);
    if (typeof packageManifest.name !== "string" || !packageManifest.name.startsWith("@deepseek-ai/")) continue;
    if (packageManifest.name === "@deepseek-ai/dsh") continue;
    const main = typeof packageManifest.main === "string" ? packageManifest.main : "";
    const sourceRoot = path.dirname(manifestPath);
    const sourceMain = main ? path.join(sourceRoot, main) : undefined;
    const targetRoot = packagePathForName(packageManifest.name);
    const targetManifest = path.join(targetRoot, "package.json");
    const targetMain = main ? path.join(targetRoot, main) : undefined;

    // pnpm deploy already contains the correct host artifact for packages that
    // are part of the CLI production closure. Do not overwrite it with the
    // source tree's client-only lib/types output (clientBundle packages such as
    // Typert registry intentionally do not emit lib/index.js in the source
    // workspace). Copy only a built source package that deploy omitted, or when
    // the existing deployed package is incomplete.
    if (main && !fs.existsSync(sourceMain) && !GENERATED_HOST_ENTRY_PACKAGES.has(packageManifest.name)) continue;
    if (fs.existsSync(targetManifest) && (!main || fs.existsSync(targetMain))) continue;
    copyRuntimePackage(sourceRoot, packageManifest.name);
  }
}

function copyOptionalRuntimePackages() {
  for (const optional of OPTIONAL_RUNTIME_PACKAGES) {
    const sourceManifestPath = path.join(optional.sourcePath, "package.json");
    if (!fs.existsSync(sourceManifestPath)) throw new Error(`缺少可选运行时包清单：${sourceManifestPath}`);
    const sourceManifest = readJson(sourceManifestPath);
    const sourceEntry = path.join(optional.sourcePath, "lib", "types", "index.js");
    if (!fs.existsSync(sourceEntry)) {
      throw new Error(`可选运行时包尚未生成 Host 入口：${optional.name}（${sourceEntry}）`);
    }
    copyRuntimePackage(optional.sourcePath, optional.name);
    const packageRoot = packagePathForName(optional.name);
    const packageManifest = readJson(path.join(packageRoot, "package.json"));
    packageManifest.main = "lib/index.js";
    fs.writeFileSync(path.join(packageRoot, "package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`);
    const exports = optional.defaultExport
      ? `export * from "./types/index.js";\nexport { default } from "./types/index.js";\n`
      : `export * from "./types/index.js";\n`;
    fs.writeFileSync(path.join(packageRoot, "lib", "index.js"), exports);
  }
}

function verifyOptionalRuntimeClosure() {
  for (const optional of OPTIONAL_RUNTIME_PACKAGES) {
    const packageRoot = packagePathForName(optional.name);
    const packageManifestPath = path.join(packageRoot, "package.json");
    if (!fs.existsSync(packageManifestPath)) throw new Error(`运行时缺少可选包：${optional.name}`);
    const packageManifest = readJson(packageManifestPath);
    const main = typeof packageManifest.main === "string" ? packageManifest.main : "lib/index.js";
    if (!fs.existsSync(path.join(packageRoot, main))) throw new Error(`运行时缺少 ${optional.name} 入口：${main}`);
  }
  for (const presetId of DESKTOP_PRESETS) {
    const presetPath = path.join(temporaryRoot, "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets", presetId, "agent.cordis.yml");
    if (!fs.existsSync(presetPath)) throw new Error(`运行时缺少 Agent Preset：${presetId}`);
    const source = fs.readFileSync(presetPath, "utf8");
    if (!source.split(/\r?\n/u).some((line) => line.trimStart().startsWith("- id:"))) throw new Error(`Agent Preset 没有有效的 id 行：${presetId}`);
    for (const match of source.matchAll(/^\s+name:\s+['"]([^'"]+)['"]$/gmu)) {
      const name = match[1];
      if (!name.startsWith("../") && !name.startsWith("@deepseek-ai/")) continue;
      const resolved = name.startsWith("../")
        ? path.resolve(path.dirname(presetPath), name)
        : packagePathForName(name);
      if (resolved === undefined || !fs.existsSync(resolved)) throw new Error("Agent Preset " + presetId + " 引用的入口不可解析：" + name);
    }
  }
  const names = JSON.stringify(OPTIONAL_RUNTIME_PACKAGES.map(({ name }) => name));
  run(process.execPath, ["--input-type=module", "-e", `for (const name of ${names}) await import(name)`], temporaryRoot);
}

function copyDesktopPresets() {
  const shippedRoot = path.join(temporaryRoot, "node_modules", "@deepseek-ai", "dsh", "config", "agent-presets");
  for (const presetId of DESKTOP_PRESETS) {
    const source = path.join(DESKTOP_PRESET_SOURCE_ROOT, presetId);
    const target = path.join(shippedRoot, presetId);
    if (!fs.existsSync(path.join(source, "agent.cordis.yml"))) {
      throw new Error(`缺少 Deeptop preset：${source}`);
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true, dereference: true });
  }
}

function ensureClientBundleHostEntries() {
  const packageNames = [
    "@deepseek-ai/dsh-typert-protocol",
    "@deepseek-ai/dsh-typert-registry",
    "@deepseek-ai/dsh-api-gateway",
  ];
  for (const packageName of packageNames) {
    const packageRoot = packagePathForName(packageName);
    const packageManifest = readJson(path.join(packageRoot, "package.json"));
    const hostEntry = path.join(packageRoot, "lib", "index.js");
    const generatedEntry = path.join(packageRoot, "lib", "types", "index.js");
    if (!fs.existsSync(hostEntry)) {
      if (!fs.existsSync(generatedEntry)) {
        throw new Error(`内嵌运行时缺少 ${packageName} 的可执行 Host 入口`);
      }
      const exports = packageName === "@deepseek-ai/dsh-typert-protocol"
        ? 'export * from "./types/index.js";\n'
        : 'export * from "./types/index.js";\nexport { default } from "./types/index.js";\n';
      fs.writeFileSync(hostEntry, exports);
    }
    const invariant = path.join(packageRoot, "lib", "invariant.js");
    const generatedInvariant = path.join(packageRoot, "lib", "types", "invariant.js");
    if (!fs.existsSync(invariant) && fs.existsSync(generatedInvariant)) {
      fs.writeFileSync(invariant, 'export * from "./types/invariant.js";\n');
    }
    packageManifest.main = "lib/index.js";
    fs.writeFileSync(path.join(packageRoot, "package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`);
  }
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

const currentManifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
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
  // Experimental Agent Teams is intentionally outside the official Host
  // aggregate. Build its package artifacts explicitly so an opt-in desktop
  // Profile can use the official service without changing vendor sources.
  run(process.execPath, [
    path.join(sourceRoot, "node_modules", "typescript", "bin", "tsc"),
    "-b",
    "packages/experimental/agent-team/tsconfig.json",
    "packages/experimental/tool-agent-team/tsconfig.json",
  ], sourceRoot);
  // RC8 keeps the private repository root in the tsdown workspace, but it has no
  // emitted lib/types entry. Build the published CLI workspace only; tsc has
  // already emitted the host artifacts for its workspace dependencies.
  run(process.execPath, [
    path.join(sourceRoot, "node_modules", "tsdown", "dist", "run.mjs"),
    "--env.DSH_BUILD_FACE",
    "host",
    "--filter",
    "@deepseek-ai/dsh",
  ], sourceRoot);
}
if (!fs.existsSync(cliEntry)) {
  throw new Error(`DSH 源码构建完成但没有找到 CLI 入口：${cliEntry}`);
}

const temporaryRoot = path.join(resourcesRoot, `dsh-runtime.build-${process.pid}`);
const deployRoot = path.join(resourcesRoot, `dsh-runtime.deploy-${process.pid}`);
const temporaryArchive = `${archivePath}.tmp-${process.pid}`;
fs.rmSync(temporaryRoot, { recursive: true, force: true });
fs.rmSync(deployRoot, { recursive: true, force: true });
fs.rmSync(temporaryArchive, { force: true });
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
  assertNoLinks(deployRoot, "pnpm deploy 产物");

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
  // Copy every built @deepseek-ai workspace package recursively. The previous
  // top-level vendor-only copy missed packages nested under packages/*/*,
  // causing profile boot to fail with cascading ERR_MODULE_NOT_FOUND errors.
  copyWorkspacePackages(sourceRoot);
  copyOptionalRuntimePackages();
  copyDesktopPresets();
  ensureClientBundleHostEntries();
  verifyOptionalRuntimeClosure();

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
    runtimeFeatures: 2,
    packageName: "@deepseek-ai/dsh",
    packageVersion,
    sourceRepository: "https://github.com/deepseek-ai/deepseek-harness.git",
    sourceCommit,
    build: "host",
    platform: process.platform,
    arch: process.arch,
    entry,
    treeSha256: treeSha256(temporaryRoot),
    optionalPackages: OPTIONAL_RUNTIME_PACKAGES.map(({ name }) => name),
    optionalPresets: DESKTOP_PRESETS,
  };
  fs.writeFileSync(path.join(temporaryRoot, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Ship one compressed immutable resource instead of tens of thousands of
  // installer files. The Rust bridge extracts it once into a versioned cache.
  // Windows 10/11, macOS, Linux, and the GitHub runners all provide tar.
  run("tar", ["-czf", temporaryArchive, "-C", temporaryRoot, "."], root);
  fs.rmSync(archivePath, { force: true });
  fs.renameSync(temporaryArchive, archivePath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  fs.rmSync(legacyOutputRoot, { recursive: true, force: true });
  console.log(`✅ 已生成压缩内嵌 DSH：${packageVersion} @ ${sourceCommit}`);
} catch (error) {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  fs.rmSync(temporaryArchive, { force: true });
  throw error;
} finally {
  fs.rmSync(deployRoot, { recursive: true, force: true });
}
