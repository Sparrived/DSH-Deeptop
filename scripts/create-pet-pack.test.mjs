import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { buildPetBundle, bundleIntegrity, webpMetadata, writePetBundle } from "./create-pet-pack.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function webp(width = 1536, height = 2288) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

async function fixture({ includeExtension = true, runtimeProfile = "deeptop" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeptop-pet-pack-"));
  await writeFile(path.join(root, "pet.json"), JSON.stringify({
    id: "maker.cloud-cat",
    displayName: "云猫",
    description: "Deeptop Pet 测试宠物",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
  }));
  if (includeExtension) {
    await writeFile(path.join(root, "deeptop.json"), JSON.stringify({
      kind: "deeptop-pet",
      schemaVersion: 2,
      runtimeProfile,
      version: "1.0.0-beta.1+win-x64",
      author: "Maker",
      license: "MIT",
      interactions: [{ on: "tap", play: "waving", then: "idle", cooldownMs: 500 }],
    }));
  }
  await writeFile(path.join(root, "spritesheet.webp"), webp());
  return root;
}

test("builds a deterministic Deeptop Pet archive", async () => {
  const root = await fixture();
  try {
    const first = await buildPetBundle(root);
    const second = await buildPetBundle(root);
    assert.deepEqual(first.bytes, second.bytes);
    const archive = unzipSync(first.bytes);
    assert.deepEqual(Object.keys(archive), ["pet.json", "deeptop.json", "spritesheet.webp"]);
    const pet = JSON.parse(strFromU8(archive["pet.json"]));
    const extension = JSON.parse(strFromU8(archive["deeptop.json"]));
    assert.equal(pet.spriteVersionNumber, 2);
    assert.equal(pet.spritesheetPath, "spritesheet.webp");
    assert.equal(extension.runtimeProfile, "deeptop");
    assert.equal(extension.version, "1.0.0-beta.1+win-x64");
    assert.deepEqual(extension.interactions[0], { on: "tap", play: "waving", then: "idle", cooldownMs: 500 });
    assert.deepEqual(first.integrity, second.integrity);
    assert.match(first.integrity.sha256, /^[0-9a-f]{64}$/);
    assert.equal(first.integrity.sizeBytes, first.bytes.length);
    assert.deepEqual(bundleIntegrity(first.bytes), first.integrity);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects runtime profiles other than deeptop", async () => {
  const root = await fixture({ runtimeProfile: "unsupported" });
  try {
    await assert.rejects(buildPetBundle(root), /不是受支持的 Deeptop Pet 清单/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes a shareable bundle and returns catalog integrity fields", async () => {
  const root = await fixture();
  const output = path.join(root, "share", "cloud-cat.deeptop-pet");
  try {
    const result = await writePetBundle(root, output);
    assert.equal(result.path, output);
    assert.equal(result.manifest.id, "maker.cloud-cat");
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    const saved = await readFile(output);
    assert.deepEqual(bundleIntegrity(saved), { sha256: result.sha256, sizeBytes: result.sizeBytes });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packages every distributable repository pet example deterministically", async () => {
  const examples = [
    ["sawatari-shizuku", "io.github.suakitsu.sawatari-shizuku"],
    ["whale-maid", "io.github.suakitsu.whale-maid-bubble"],
  ];
  for (const [directory, id] of examples) {
    const source = path.join(repositoryRoot, "examples", "pets", directory);
    const first = await buildPetBundle(source);
    const second = await buildPetBundle(source);
    assert.equal(first.manifest.id, id);
    assert.deepEqual(first.bytes, second.bytes);
    assert.deepEqual(first.integrity, second.integrity);
    assert.deepEqual(Object.keys(unzipSync(first.bytes)), ["pet.json", "deeptop.json", "spritesheet.webp"]);
  }
});

test("packages a plain Deeptop Pet without requiring extension metadata", async () => {
  const root = await fixture({ includeExtension: false });
  try {
    const bundle = await buildPetBundle(root);
    const archive = unzipSync(bundle.bytes);
    assert.deepEqual(Object.keys(archive), ["pet.json", "spritesheet.webp"]);
    assert.equal(bundle.manifest.author, "社区创作者");
    assert.equal(bundle.manifest.version, "1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads the fixed Deeptop Pet VP8X dimensions", () => {
  assert.deepEqual(webpMetadata(webp()), { width: 1536, height: 2288 });
  assert.throws(() => webpMetadata(Buffer.from("not-webp")), /有效的 WebP/);
});

test("rejects unsupported atlas dimensions", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "spritesheet.webp"), webp(192, 208));
    await assert.rejects(buildPetBundle(root), /1536×2288/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects interaction rules outside the standard Deeptop Pet states", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "deeptop.json"), JSON.stringify({
      kind: "deeptop-pet",
      schemaVersion: 2,
      runtimeProfile: "deeptop",
      version: "1.0.0",
      author: "Maker",
      license: "MIT",
      interactions: [{ on: "tap", play: "custom-script", cooldownMs: 0 }],
    }));
    await assert.rejects(buildPetBundle(root), /Deeptop Pet 标准动画/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
