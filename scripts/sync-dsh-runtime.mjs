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
    if (main && !fs.existsSync(sourceMain)) continue;
    if (fs.existsSync(targetManifest) && (!main || fs.existsSync(targetMain))) continue;
    copyRuntimePackage(sourceRoot, packageManifest.name);
  }
}

function ensureClientBundleHostEntries() {
  const packageNames = [
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
      fs.writeFileSync(
        hostEntry,
        'export * from "./types/index.js";\nexport { default } from "./types/index.js";\n',
      );
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
  run(process.execPath, [path.join(sourceRoot, "node_modules", "tsdown", "dist", "run.mjs"), "--env.DSH_BUILD_FACE", "host"], sourceRoot);
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
  ensureClientBundleHostEntries();

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
    treeSha256: treeSha256(temporaryRoot),
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
