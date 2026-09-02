import fs from "node:fs";
import path from "node:path";

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveImportTarget(target) {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const resolved = resolveImportTarget(candidate);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (!target || typeof target !== "object") return undefined;
  const importConditions = new Set(["node-addons", "node", "import", "module-sync", "default"]);
  for (const [condition, candidate] of Object.entries(target)) {
    if (!importConditions.has(condition)) continue;
    const resolved = resolveImportTarget(candidate);
    if (resolved) return resolved;
  }
  return undefined;
}

export function packageImportTarget(packageManifest) {
  if (packageManifest.exports !== undefined) {
    const exports = packageManifest.exports;
    const rootExport =
      exports &&
      typeof exports === "object" &&
      !Array.isArray(exports) &&
      Object.keys(exports).some((key) => key.startsWith("."))
        ? exports["."]
        : exports;
    return resolveImportTarget(rootExport);
  }
  return typeof packageManifest.main === "string" && packageManifest.main.trim() !== ""
    ? packageManifest.main
    : "index.js";
}

export function packageHasImportEntry(packageRoot, packageManifest) {
  const target = packageImportTarget(packageManifest);
  if (typeof target !== "string" || target.trim() === "") return false;
  if (packageManifest.exports !== undefined && !target.startsWith("./")) return false;
  const resolved = path.resolve(packageRoot, target);
  return isPathWithin(packageRoot, resolved) && fs.statSync(resolved, { throwIfNoEntry: false })?.isFile() === true;
}
