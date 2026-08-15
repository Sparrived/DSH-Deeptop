import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "check";
const suppliedVersion = process.argv[3];

function normalizeVersion(value) {
  const normalized = String(value ?? "").trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error(`版本必须符合 SemVer（例如 0.2.0 或 0.2.0-rc.1），实际为：${value}`);
  }
  return normalized;
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function write(relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  const current = fs.readFileSync(absolutePath, "utf8");
  if (current !== content) {
    fs.writeFileSync(absolutePath, content, "utf8");
    console.log(`updated ${relativePath}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function updateJson(relativePath, update) {
  const json = readJson(relativePath);
  update(json);
  write(relativePath, `${JSON.stringify(json, null, 2)}\n`);
}

function readCargoVersion(relativePath, packageName) {
  const source = read(relativePath);
  const match = source.match(
    new RegExp(`\\[\\[package\\]\\]\\s+name = "${packageName}"\\s+version = "([^"]+)"`),
  );
  if (!match) {
    throw new Error(`无法在 ${relativePath} 中找到 ${packageName} 的版本`);
  }
  return match[1];
}

function readManifestVersions() {
  const packageLock = readJson("package-lock.json");
  const cargoToml = read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const cargoLock = readCargoVersion("src-tauri/Cargo.lock", "deeptop");
  return {
    "package.json": readJson("package.json").version,
    "package-lock.json": packageLock.version,
    "package-lock.json#packages.": packageLock.packages?.[""]?.version,
    "deeptop-bridge/package.json": readJson("deeptop-bridge/package.json").version,
    "src-tauri/tauri.conf.json": readJson("src-tauri/tauri.conf.json").version,
    "src-tauri/Cargo.toml": cargoToml,
    "src-tauri/Cargo.lock": cargoLock,
  };
}

function check(expectedInput) {
  const versions = readManifestVersions();
  const expected = expectedInput ? normalizeVersion(expectedInput) : versions["package.json"];
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length > 0) {
    const details = Object.entries(versions)
      .map(([file, version]) => `  ${file}: ${version ?? "<missing>"}`)
      .join("\n");
    throw new Error(`版本不一致，期望 ${expected}：\n${details}`);
  }
  console.log(`version ${expected} is consistent across all manifests`);
  return expected;
}

function setVersion(input) {
  const version = normalizeVersion(input);
  updateJson("package.json", (json) => {
    json.version = version;
  });
  updateJson("package-lock.json", (json) => {
    json.version = version;
    if (json.packages?.[""]) {
      json.packages[""].version = version;
    }
  });
  updateJson("deeptop-bridge/package.json", (json) => {
    json.version = version;
  });
  updateJson("src-tauri/tauri.conf.json", (json) => {
    json.version = version;
  });

  const cargoToml = read("src-tauri/Cargo.toml").replace(
    /^(version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );
  write("src-tauri/Cargo.toml", cargoToml);

  const cargoLock = read("src-tauri/Cargo.lock").replace(
    /(\[\[package\]\]\s+name = "deeptop"\s+version = ")[^"]+(")/,
    `$1${version}$2`,
  );
  write("src-tauri/Cargo.lock", cargoLock);
  check(version);
}

if (mode === "set") {
  if (!suppliedVersion) {
    throw new Error("用法：npm run version:set -- <版本号>");
  }
  setVersion(suppliedVersion);
} else if (mode === "check") {
  check(suppliedVersion);
} else {
  throw new Error(`未知操作 ${mode}，可用操作：set、check`);
}
