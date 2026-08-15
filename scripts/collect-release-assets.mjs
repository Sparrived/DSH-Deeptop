import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  args.set(key.slice(2), process.argv[index + 1]);
  index += 1;
}

const version = args.get("version");
const platform = args.get("platform");
const architecture = args.get("arch");
const output = path.resolve(root, args.get("output") ?? "release-assets");

if (!version || !platform || !architecture) {
  throw new Error(
    "用法：node scripts/collect-release-assets.mjs --version <版本> --platform <平台> --arch <架构> [--output <目录>]",
  );
}

const bundleDirectories = {
  windows: [
    ["nsis", ".exe", "setup"],
    ["msi", ".msi", "msi"],
  ],
  linux: [
    ["deb", ".deb", "deb"],
    ["appimage", ".AppImage", "appimage"],
  ],
  macos: [["dmg", ".dmg", "dmg"]],
};

if (!bundleDirectories[platform]) {
  throw new Error(`不支持的平台：${platform}`);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

let copied = 0;
for (const [directory, extension, kind] of bundleDirectories[platform]) {
  const sourceDirectory = path.join(root, "src-tauri", "target", "release", "bundle", directory);
  if (!fs.existsSync(sourceDirectory)) continue;

  const files = fs
    .readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase()))
    .map((entry) => entry.name)
    .sort();

  files.forEach((fileName, index) => {
    const suffix = files.length > 1 ? `-${index + 1}` : "";
    const destinationName = `Deeptop-${version}-${platform}-${architecture}-${kind}${suffix}${extension}`;
    fs.copyFileSync(path.join(sourceDirectory, fileName), path.join(output, destinationName));
    console.log(`${fileName} -> ${destinationName}`);
    copied += 1;
  });
}

if (copied === 0) {
  throw new Error(`没有找到 ${platform} ${architecture} 的 Tauri bundle，请检查构建日志和目标格式`);
}

console.log(`collected ${copied} release asset(s) in ${output}`);
