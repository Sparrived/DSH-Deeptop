import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT_MANIFEST = "runtime-manifest.json";
const CACHE_METADATA = new Set([".complete", ".complete.tmp"]);
const DIGEST_MAGIC = Buffer.from("deeptop-runtime-tree-v2\0", "utf8");

function uint64(value) {
  const encoded = Buffer.allocUnsafe(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

export function isSafeRuntimePathSegment(name) {
  return (
    name !== "" &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes(":")
  );
}

function directoryEntries(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true, encoding: "buffer" })
    .map((entry) => {
      const nameBytes = Buffer.from(entry.name);
      const name = nameBytes.toString("utf8");
      if (!Buffer.from(name, "utf8").equals(nameBytes)) {
        throw new Error(`内嵌运行时禁止非 UTF-8 路径：${directory}`);
      }
      if (!isSafeRuntimePathSegment(name)) throw new Error(`内嵌运行时包含不安全的路径段：${name}`);
      return { entry, name, nameBytes };
    })
    .sort((left, right) => left.nameBytes.compare(right.nameBytes));
}

function updateRecord(hash, type, relative, content) {
  const relativeBytes = Buffer.from(relative, "utf8");
  hash.update(Buffer.from([type]));
  hash.update(uint64(relativeBytes.length));
  hash.update(relativeBytes);
  if (content !== undefined) {
    hash.update(uint64(content.length));
    hash.update(content);
  }
}

/** Compute the unambiguous runtime tree digest used by the native extraction cache. */
export function runtimeTreeSha256(rootPath, { rejectCacheMetadata = false } = {}) {
  const hash = createHash("sha256");
  hash.update(DIGEST_MAGIC);
  function visit(directory, relativeDirectory = "") {
    for (const { name } of directoryEntries(directory)) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`内嵌运行时禁止符号链接：${relative}`);
      if (!relativeDirectory && name === ROOT_MANIFEST) {
        if (!stat.isFile()) throw new Error(`内嵌运行时清单不是普通文件：${absolute}`);
        continue;
      }
      if (!relativeDirectory && CACHE_METADATA.has(name)) {
        if (rejectCacheMetadata) throw new Error(`内嵌运行时归档包含保留缓存文件：${name}`);
        if (!stat.isFile()) throw new Error(`内嵌运行时缓存标记不是普通文件：${absolute}`);
        continue;
      }
      if (stat.isDirectory()) {
        updateRecord(hash, 0x44, relative);
        visit(absolute, relative);
      } else if (stat.isFile()) {
        updateRecord(hash, 0x46, relative, fs.readFileSync(absolute));
      } else {
        throw new Error(`内嵌运行时包含不支持的文件类型：${relative}`);
      }
    }
  }
  visit(rootPath);
  return hash.digest("hex");
}
