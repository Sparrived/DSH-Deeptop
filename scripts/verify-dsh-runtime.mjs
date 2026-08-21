import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesRoot = path.join(root, "src-tauri", "resources");
const archivePath = path.join(resourcesRoot, "dsh-runtime.tar.gz");
const manifestPath = path.join(resourcesRoot, "dsh-runtime-manifest.json");
const entry = "node_modules/@deepseek-ai/dsh/lib/bin.js";

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

// The archive is extracted and checked by the Rust bridge. This command only
// checks the compressed resource can be enumerated on the build host; staging
// checks in sync-dsh-runtime.mjs cover the required package entries before it is
// compressed.
const archiveCheck = spawnSync("tar", ["-tzf", archivePath], {
  cwd: root,
  stdio: "ignore",
  windowsHide: true,
});
if (archiveCheck.error || archiveCheck.status !== 0) {
  throw new Error(`内嵌 DSH 运行时归档无法读取：${archivePath}`);
}

console.log(`✅ 内嵌 DSH 压缩运行时校验通过：${manifest.packageVersion} @ ${manifest.sourceCommit}`);
