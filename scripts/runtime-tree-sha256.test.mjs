import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isSafeRuntimePathSegment, runtimeTreeSha256 } from "./runtime-tree-sha256.mjs";

test("matches the native runtime digest and ignores only root cache metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deeptop-runtime-digest-"));
  try {
    fs.mkdirSync(path.join(root, "dir"));
    fs.writeFileSync(path.join(root, "a.txt"), "alpha");
    fs.writeFileSync(path.join(root, "dir", "b.bin"), Buffer.from([0, 1]));
    fs.writeFileSync(path.join(root, "runtime-manifest.json"), "first");
    fs.writeFileSync(path.join(root, ".complete"), "first");
    fs.writeFileSync(path.join(root, ".complete.tmp"), "first");

    const digest = runtimeTreeSha256(root);
    assert.equal(digest, "ebe07cc2bd582638ab0d85745bef551e537b2e0bc6a95869256824484f0232c9");
    assert.throws(
      () => runtimeTreeSha256(root, { rejectCacheMetadata: true }),
      /保留缓存文件/u,
    );

    fs.writeFileSync(path.join(root, "runtime-manifest.json"), "second");
    fs.writeFileSync(path.join(root, ".complete"), "second");
    fs.writeFileSync(path.join(root, ".complete.tmp"), "second");
    assert.equal(runtimeTreeSha256(root), digest);

    fs.writeFileSync(path.join(root, "dir", "runtime-manifest.json"), "nested");
    assert.notEqual(runtimeTreeSha256(root), digest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("length-delimited records distinguish file-boundary lookalikes", () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), "deeptop-runtime-tree-a-"));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), "deeptop-runtime-tree-b-"));
  try {
    fs.writeFileSync(path.join(first, "a"), "F\nb\nX");
    fs.writeFileSync(path.join(second, "a"), "");
    fs.writeFileSync(path.join(second, "b"), "X");
    assert.notEqual(runtimeTreeSha256(first), runtimeTreeSha256(second));
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});

test("uses the same portable path-segment policy as native extraction", () => {
  assert.equal(isSafeRuntimePathSegment("@deepseek-ai"), true);
  for (const invalid of ["", ".", "..", "a/b", "a\\b", "a:b"]) {
    assert.equal(isSafeRuntimePathSegment(invalid), false, invalid);
  }
});
