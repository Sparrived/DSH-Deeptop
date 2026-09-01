import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesRoot = path.join(root, "src-tauri", "resources");
const archivePath = path.join(resourcesRoot, "dsh-runtime.tar.gz");
const manifestPath = path.join(resourcesRoot, "dsh-runtime-manifest.json");
const entry = "node_modules/@deepseek-ai/dsh/lib/bin.js";
const runtimeSmokePackages = ["@deepseek-ai/dsh-attachment-local"];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 JSON 清单 ${filePath}：${error.message}`);
  }
}

if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
  throw new Error(`内嵌 DSH 运行时归档不存在：${archivePath}`);
}
const manifest = readJson(manifestPath);
if (
  manifest.format !== 1 ||
  manifest.runtimeFeatures !== 4 ||
  !Array.isArray(manifest.desktopRuntimePackages) ||
  !manifest.desktopRuntimePackages.includes("undici") ||
  !Array.isArray(manifest.runtimeSmokePackages) ||
  !runtimeSmokePackages.every((name) => manifest.runtimeSmokePackages.includes(name)) ||
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
if (!/^[0-9a-f]{64}$/.test(manifest.treeSha256)) {
  throw new Error(`内嵌 DSH 清单缺少运行时树摘要：${manifest.treeSha256}`);
}

// The Rust bridge compiles the bundled commit/version into the binary and
// refuses to start a runtime whose manifest does not match. Verify the staged
// resource still matches those compiled constants so a vendor/dsh advance alone
// cannot silently produce a non-launchable installer.
const mainSource = fs.readFileSync(path.join(root, "src-tauri", "src", "main.rs"), "utf8");
const pinnedCommit = mainSource.match(
  /const BUNDLED_DSH_SOURCE_COMMIT:\s*&str\s*=\s*"([0-9a-f]{40})"/,
)?.[1];
const pinnedVersion = mainSource.match(
  /const BUNDLED_DSH_VERSION:\s*&str\s*=\s*"([^"]+)"/,
)?.[1];
if (!pinnedCommit || !pinnedVersion) {
  throw new Error("无法从 src-tauri/src/main.rs 读取内嵌 DSH 编译期常量");
}
if (manifest.sourceCommit !== pinnedCommit || manifest.packageVersion !== pinnedVersion) {
  throw new Error(
    `内嵌 DSH 清单与编译期常量不一致：清单 ${manifest.packageVersion} @ ${manifest.sourceCommit}，` +
      `main.rs ${pinnedVersion} @ ${pinnedCommit}。请先运行 npm run dsh:sync 并在同一提交重建。`,
  );
}

// Verify the immutable artifact rather than the deploy staging tree. This catches
// omitted platform packages such as sharp's native optional dependency.
const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deeptop-runtime-verify-"));
try {
  const archiveCheck = spawnSync("tar", ["-xzf", archivePath, "-C", extractedRoot], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (archiveCheck.error || archiveCheck.status !== 0) {
    const detail = archiveCheck.error?.message || archiveCheck.stderr?.trim() || archiveCheck.status;
    throw new Error(`内嵌 DSH 运行时归档无法解压：${archivePath}（${detail}）`);
  }
  if (!fs.existsSync(path.join(extractedRoot, "node_modules", "undici", "index.js"))) {
    throw new Error(`内嵌 DSH 运行时缺少桌面网络代理依赖：${archivePath}`);
  }
  const smokeScript = `for (const name of ${JSON.stringify(runtimeSmokePackages)}) await import(name)`;
  const smokeCheck = spawnSync(process.execPath, ["--input-type=module", "-e", smokeScript], {
    cwd: extractedRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_PATH: "",
      SHARP_FORCE_GLOBAL_LIBVIPS: "",
      SHARP_IGNORE_GLOBAL_LIBVIPS: "1",
    },
    windowsHide: true,
  });
  if (smokeCheck.error || smokeCheck.status !== 0) {
    const detail = smokeCheck.error?.message || smokeCheck.stderr?.trim() || smokeCheck.status;
    throw new Error(`内嵌 DSH 运行时启动依赖不可加载：${detail}`);
  }
} finally {
  fs.rmSync(extractedRoot, { recursive: true, force: true });
}

console.log(`✅ 内嵌 DSH 压缩运行时校验通过：${manifest.packageVersion} @ ${manifest.sourceCommit}`);
