import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { packageHasImportEntry, packageImportTarget } from "./runtime-package-entry.mjs";

function withPackage(files, manifest, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deeptop-runtime-entry-"));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    callback(root, manifest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("resolves the actual Node ESM import condition instead of main or require", () => {
  const manifest = {
    type: "module",
    main: "./index.cjs",
    exports: { ".": { import: "./missing.mjs", require: "./index.cjs" } },
  };
  withPackage({ "index.cjs": "module.exports = {}" }, manifest, (root) => {
    assert.equal(packageImportTarget(manifest), "./missing.mjs");
    assert.equal(packageHasImportEntry(root, manifest), false);
  });
});

test("accepts an existing conditional import target and skips type-only conditions", () => {
  const manifest = {
    type: "module",
    exports: {
      ".": {
        types: "./index.d.ts",
        node: { import: "./index.mjs", require: "./index.cjs" },
        default: "./fallback.mjs",
      },
    },
  };
  withPackage({ "index.mjs": "export default {}" }, manifest, (root) => {
    assert.equal(packageImportTarget(manifest), "./index.mjs");
    assert.equal(packageHasImportEntry(root, manifest), true);
  });
});

test("falls back to main only when exports does not control the package root", () => {
  withPackage({ "main.js": "export default {}" }, { main: "./main.js" }, (root, manifest) => {
    assert.equal(packageImportTarget(manifest), "./main.js");
    assert.equal(packageHasImportEntry(root, manifest), true);
  });
  withPackage({ "main.js": "export default {}" }, { main: "./main.js", exports: { "./subpath": "./main.js" } }, (root, manifest) => {
    assert.equal(packageImportTarget(manifest), undefined);
    assert.equal(packageHasImportEntry(root, manifest), false);
  });
});

test("rejects import targets that escape the package root", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "deeptop-runtime-entry-parent-"));
  const root = path.join(parent, "package");
  try {
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(parent, "outside.mjs"), "export default {}");
    assert.equal(packageHasImportEntry(root, { exports: "../outside.mjs" }), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
