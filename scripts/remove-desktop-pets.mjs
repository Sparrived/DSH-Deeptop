import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FEATURE_MARKER = "@deeptop-pets";
const FEATURE_MANIFEST = "desktop-pets.feature.json";

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function formatJson(value, original) {
  return `${JSON.stringify(value, null, 2)}\n`.replaceAll("\n", detectEol(original));
}

/** Resolve one manifest-owned path and reject roots, absolute paths and traversal. */
export function resolveOwnedPath(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`非法的宠物功能路径：${String(relativePath)}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relation = path.relative(resolvedRoot, resolved);
  if (!relation || relation.startsWith(`..${path.sep}`) || relation === ".." || path.isAbsolute(relation)) {
    throw new Error(`宠物功能路径越出项目目录：${relativePath}`);
  }
  return resolved;
}

/** Remove complete, non-nested feature regions while preserving the source EOL style. */
export function stripFeatureBlocks(text, fileName = "source") {
  const eol = detectEol(text);
  const hadTrailingEol = /\r?\n$/.test(text);
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const output = [];
  const ids = new Set();
  let activeId = null;
  let justEndedBlock = false;
  let count = 0;

  for (const [index, line] of lines.entries()) {
    const start = line.match(new RegExp(`${FEATURE_MARKER}:start\\s+([a-z0-9][a-z0-9-]*)`));
    const end = line.match(new RegExp(`${FEATURE_MARKER}:end\\s+([a-z0-9][a-z0-9-]*)`));
    if (start) {
      if (activeId) throw new Error(`${fileName}:${index + 1} 出现嵌套宠物功能标记`);
      if (ids.has(start[1])) throw new Error(`${fileName}:${index + 1} 重复宠物功能标记 ${start[1]}`);
      activeId = start[1];
      ids.add(activeId);
      count += 1;
      continue;
    }
    if (end) {
      if (!activeId) throw new Error(`${fileName}:${index + 1} 存在没有起点的宠物功能结束标记`);
      if (end[1] !== activeId) {
        throw new Error(`${fileName}:${index + 1} 宠物功能标记不匹配：${activeId} / ${end[1]}`);
      }
      activeId = null;
      justEndedBlock = true;
      continue;
    }
    if (!activeId) {
      if (justEndedBlock && line === "" && output.at(-1) === "") {
        justEndedBlock = false;
        continue;
      }
      justEndedBlock = false;
      output.push(line);
    }
  }

  if (activeId) throw new Error(`${fileName} 的宠物功能标记 ${activeId} 没有结束`);
  if (count === 0) throw new Error(`${fileName} 没有宠物功能标记，拒绝猜测删除范围`);
  while (output.length > 0 && output.at(-1) === "") output.pop();
  return `${output.join(eol)}${hadTrailingEol ? eol : ""}`;
}

function requireOwnProperty(object, key, context) {
  if (!object || !Object.prototype.hasOwnProperty.call(object, key)) {
    throw new Error(`${context} 缺少预期项 ${key}，拒绝继续删除`);
  }
}

/** Remove feature-owned npm commands, tests and dependencies. */
export function transformPackageJson(text, config) {
  const value = JSON.parse(text);
  for (const script of config.scripts) {
    requireOwnProperty(value.scripts, script, "package.json scripts");
    delete value.scripts[script];
  }

  const testTokens = value.scripts.test.split(/\s+/u);
  for (const entry of config.testEntries) {
    if (!testTokens.includes(entry)) throw new Error(`package.json test 缺少预期项 ${entry}`);
  }
  value.scripts.test = testTokens.filter((token) => !config.testEntries.includes(token)).join(" ");

  for (const dependency of config.devDependencies) {
    requireOwnProperty(value.devDependencies, dependency, "package.json devDependencies");
    delete value.devDependencies[dependency];
  }
  return formatJson(value, text);
}

/** Remove feature-owned npm lockfile nodes without resolving the dependency graph again. */
export function transformPackageLock(text, config) {
  const value = JSON.parse(text);
  const rootDevDependencies = value.packages?.[""]?.devDependencies;
  for (const dependency of config.rootDevDependencies) {
    requireOwnProperty(rootDevDependencies, dependency, "package-lock.json root devDependencies");
    delete rootDevDependencies[dependency];
  }
  for (const packagePath of config.packages) {
    requireOwnProperty(value.packages, packagePath, "package-lock.json packages");
    delete value.packages[packagePath];
  }
  return formatJson(value, text);
}

/** Remove feature-owned Tauri application settings. */
export function transformTauriConfig(text, config) {
  const value = JSON.parse(text);
  for (const key of config.appKeys) {
    requireOwnProperty(value.app, key, "src-tauri/tauri.conf.json app");
    delete value.app[key];
  }
  return formatJson(value, text);
}

/** Remove selected features from the single-line Tauri dependency declaration. */
export function transformCargoToml(text, config) {
  const linePattern = /^tauri\s*=\s*\{[^\r\n]*\}$/mu;
  const match = text.match(linePattern);
  if (!match) throw new Error("src-tauri/Cargo.toml 中没有可识别的 tauri 依赖声明");
  const featurePattern = /features\s*=\s*\[([^\]]*)\]/u;
  const featureMatch = match[0].match(featurePattern);
  if (!featureMatch) throw new Error("src-tauri/Cargo.toml 的 tauri 依赖没有 features 列表");
  const features = JSON.parse(`[${featureMatch[1]}]`);
  for (const feature of config.tauriFeatures) {
    if (!features.includes(feature)) throw new Error(`tauri features 缺少预期项 ${feature}`);
  }
  const retained = features.filter((feature) => !config.tauriFeatures.includes(feature));
  const replacement = match[0].replace(featurePattern, `features = [${retained.map((feature) => JSON.stringify(feature)).join(", ")}]`);
  return text.replace(linePattern, replacement);
}

async function loadRemovalPlan(root) {
  const manifestPath = resolveOwnedPath(root, FEATURE_MANIFEST);
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest.schemaVersion !== 1 || manifest.id !== "desktop-pets") {
    throw new Error("desktop-pets.feature.json 版本或功能标识无效");
  }

  const writes = new Map();
  for (const file of manifest.markerFiles) {
    const sourcePath = resolveOwnedPath(root, file);
    const source = await readFile(sourcePath, "utf8");
    writes.set(sourcePath, stripFeatureBlocks(source, file));
  }

  const packagePath = resolveOwnedPath(root, "package.json");
  writes.set(packagePath, transformPackageJson(await readFile(packagePath, "utf8"), manifest.packageJson));
  const packageLockPath = resolveOwnedPath(root, "package-lock.json");
  writes.set(packageLockPath, transformPackageLock(await readFile(packageLockPath, "utf8"), manifest.packageLock));
  const tauriConfigPath = resolveOwnedPath(root, "src-tauri/tauri.conf.json");
  writes.set(tauriConfigPath, transformTauriConfig(await readFile(tauriConfigPath, "utf8"), manifest.tauriConfig));
  const cargoPath = resolveOwnedPath(root, "src-tauri/Cargo.toml");
  writes.set(cargoPath, transformCargoToml(writes.get(cargoPath), manifest.cargo));

  const ownedPaths = manifest.ownedPaths.map((entry) => resolveOwnedPath(root, entry));
  const generatedPaths = (manifest.generatedPaths ?? []).map((entry) => resolveOwnedPath(root, entry));
  const removalToolPaths = manifest.removalToolPaths.map((entry) => resolveOwnedPath(root, entry));
  for (const target of [...ownedPaths, ...removalToolPaths]) {
    await stat(target).catch((error) => {
      const statError = new Error(`宠物功能清单中的路径不存在：${path.relative(root, target)}`);
      statError.cause = error;
      throw statError;
    });
  }
  return { manifest, writes, ownedPaths, generatedPaths, removalToolPaths };
}

async function refreshedCargoLock(root, cargoToml) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "deeptop-no-pets-lock-"));
  try {
    await writeFile(path.join(temporaryRoot, "Cargo.toml"), cargoToml, "utf8");
    await writeFile(path.join(temporaryRoot, "Cargo.lock"), await readFile(path.join(root, "src-tauri", "Cargo.lock"), "utf8"), "utf8");
    await mkdir(path.join(temporaryRoot, "src"));
    await writeFile(path.join(temporaryRoot, "src", "main.rs"), "fn main() {}\n", "utf8");
    const manifestPath = path.join(temporaryRoot, "Cargo.toml");
    const targetDirectory = path.resolve(root, process.env.CARGO_TARGET_DIR ?? path.join(root, "src-tauri", "target"));
    const runCheck = (offline) => spawnSync("cargo", ["check", "--quiet", "--manifest-path", manifestPath, ...(offline ? ["--offline"] : [])], {
      cwd: temporaryRoot,
      encoding: "utf8",
      env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
      windowsHide: true,
    });
    let result = runCheck(true);
    if (result.status !== 0 && /offline|failed to download|no matching package|HTTP request/iu.test(`${result.stderr}\n${result.stdout}`)) {
      result = runCheck(false);
    }
    if (result.error || result.status !== 0) {
      throw new Error(`无法预先验证无宠物版 Rust 构建并刷新 Cargo.lock：${result.error?.message || result.stderr || result.stdout}`);
    }
    return readFile(path.join(temporaryRoot, "Cargo.lock"), "utf8");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

/** Recursively yield one backup entry per file under a write/delete target. */
async function* collectFileBackups(target) {
  const info = await stat(target);
  if (info.isDirectory()) {
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) yield* collectFileBackups(child);
      else if (entry.isFile()) yield { filePath: child, bytes: await readFile(child) };
    }
    return;
  }
  if (info.isFile()) yield { filePath: target, bytes: await readFile(target) };
}

async function restoreFileBackups(snapshots) {
  for (const { filePath, bytes } of snapshots) {
    await mkdir(path.dirname(filePath), { recursive: true });
    // Windows 只读属性会让恢复写入同样 EPERM，先补回写位再重试一次。
    await writeFile(filePath, bytes).catch(async (error) => {
      if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
      const current = await stat(filePath).catch(() => undefined);
      if (!current?.isFile()) throw error;
      await chmod(filePath, current.mode | 0o200);
      await writeFile(filePath, bytes);
    });
  }
}

/**
 * Apply the removal plan transactionally: every rewritten and deleted file is
 * backed up first; on any failure mid-run all changes are restored so the
 * repository never stays half-removed (Windows 文件锁等场景)。
 * 可选的 generatedPaths 构建缓存放在关键段之外尽力删除，失败只警告。
 */
export async function applyRemovalPlan(plan, root) {
  const criticalTargets = [
    ...plan.writes.keys(),
    ...plan.ownedPaths,
    ...plan.removalToolPaths,
  ];
  let snapshots;
  try {
    snapshots = [];
    for (const target of criticalTargets) {
      for await (const backup of collectFileBackups(target)) snapshots.push(backup);
    }
  } catch (error) {
    throw new Error(`无法备份待改动文件，已取消剔除且未修改任何文件：${error.message}`);
  }
  try {
    for (const [file, content] of plan.writes) await writeFile(file, content, "utf8");
    for (const target of plan.ownedPaths) await rm(target, { recursive: true, force: false });
    for (const target of plan.removalToolPaths) await rm(target, { recursive: true, force: false });
  } catch (error) {
    try {
      await restoreFileBackups(snapshots);
    } catch (restoreError) {
      throw new Error(
        `剔除在中途失败：${error.message}；且回滚也未能完成，请按 git status 手工恢复：${restoreError.message}`,
      );
    }
    throw new Error(`剔除在中途失败，已回滚全部改动，仓库保持原状：${error.message}`);
  }
  for (const target of plan.generatedPaths) {
    await rm(target, { recursive: true, force: true }).catch((error) => {
      console.warn(`可选构建缓存删除失败（可稍后手工清理）：${path.relative(root, target)}：${error.message}`);
    });
  }
}

/** Validate and optionally apply complete source removal. */
export async function removeDesktopPets(root, { apply = false, refreshCargoLock = true } = {}) {
  const resolvedRoot = path.resolve(root);
  const plan = await loadRemovalPlan(resolvedRoot);
  if (!apply) return plan;

  if (refreshCargoLock) {
    const cargoPath = resolveOwnedPath(resolvedRoot, "src-tauri/Cargo.toml");
    const cargoLockPath = resolveOwnedPath(resolvedRoot, "src-tauri/Cargo.lock");
    plan.writes.set(cargoLockPath, await refreshedCargoLock(resolvedRoot, plan.writes.get(cargoPath)));
  }

  await applyRemovalPlan(plan, resolvedRoot);
  return plan;
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const apply = process.argv.includes("--apply");
  const plan = await removeDesktopPets(projectRoot, { apply });
  if (!apply) {
    console.log(`宠物功能剔除预检通过：将更新 ${plan.writes.size + 1} 个文件、删除 ${plan.ownedPaths.length + plan.removalToolPaths.length} 个功能路径，并清理 ${plan.generatedPaths.length} 个可选构建缓存。`);
    console.log("执行 npm run pets:remove 可一次完成剔除；当前未修改任何文件。");
    return;
  }
  console.log("宠物系统已从源码、原生注册、前端入口、依赖、文档与锁文件中完整剔除。");
  console.log("用户配置目录中的已安装宠物包和养成数据未删除，可由用户自行清理。");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
