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

/**
 * Apply one reference file's line endings to freshly generated content.
 *
 * The generators below always emit LF, but a Windows checkout with
 * `core.autocrlf=true` holds these manifests as CRLF. Writing LF back makes git
 * report a content-identical file as modified, so every `version:set` leaves a
 * phantom change behind. Generated content is normalized first so already-CRLF
 * input cannot accumulate carriage returns.
 *
 * @param content - generated content, in LF.
 * @param reference - the file as it currently exists on disk.
 * @returns the content using the reference file's line endings.
 */
export function preserveLineEndings(content, reference) {
  const firstNewline = reference.indexOf("\n");
  const eol = firstNewline > 0 && reference[firstNewline - 1] === "\r" ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");
  return eol === "\n" ? normalized : normalized.replace(/\n/g, eol);
}

function write(relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  const current = fs.readFileSync(absolutePath, "utf8");
  const next = preserveLineEndings(content, current);
  if (current !== next) {
    fs.writeFileSync(absolutePath, next, "utf8");
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
    "cordis/package.json": readJson("cordis/package.json").version,
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
  updateJson("cordis/package.json", (json) => {
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

// Only run the CLI when this file is the entry point, so the pure helpers above
// stay importable by tests without touching the real manifests.
const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
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
}
