import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";

const PET_MANIFEST_FILE = "pet.json";
const DEEPTOP_MANIFEST_FILE = "deeptop.json";
const SPRITESHEET_FILE = "spritesheet.webp";
const DEEPTOP_RUNTIME_PROFILE = "deeptop";
const PET_ATLAS_WIDTH = 1536;
const PET_ATLAS_HEIGHT = 2288;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_PACK_BYTES = 12 * 1024 * 1024;
const MAX_INTERACTIONS = 32;
const ARCHIVE_TIME = new Date("1980-01-01T00:00:00.000Z");
const interactionEvents = new Set(["pointerEnter", "pointerLeave", "tap", "doubleTap", "longPress", "dragStart", "dragEnd", "idleTimeout"]);
const animationStates = new Set(["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"]);
const loopingStates = new Set(["idle", "running-right", "running-left", "waiting", "running"]);
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** 返回可直接写入市场目录的稳定包大小和 SHA-256。 */
export function bundleIntegrity(bytes) {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象`);
  return value;
}

function text(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label}不能为空、不能包含控制字符或首尾空白，且不能超过 ${maximum} 个字符`);
  }
  return value;
}

function integer(value, label, minimum, maximum, fallback) {
  const next = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(next) || next < minimum || next > maximum) throw new Error(`${label}必须是 ${minimum}–${maximum} 的整数`);
  return next;
}

/** 读取 VP8X、VP8 或 VP8L WebP 的画布尺寸，不修改图像内容。 */
export function webpMetadata(bytes) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error(`${SPRITESHEET_FILE} 必须是有效的 WebP`);
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.subarray(offset, offset + 4).toString("ascii");
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) throw new Error(`${SPRITESHEET_FILE} 的 RIFF 块已截断`);
    if (kind === "VP8X" && size >= 10) {
      return {
        width: 1 + bytes.readUIntLE(data + 4, 3),
        height: 1 + bytes.readUIntLE(data + 7, 3),
      };
    }
    if (kind === "VP8 " && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    if (kind === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1];
      const b2 = bytes[data + 2];
      const b3 = bytes[data + 3];
      const b4 = bytes[data + 4];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      };
    }
    offset = data + size + (size % 2);
  }
  throw new Error(`${SPRITESHEET_FILE} 缺少受支持的 VP8X、VP8 或 VP8L 图像块`);
}

function normalizePetManifest(value) {
  const manifest = object(value, PET_MANIFEST_FILE);
  const id = text(manifest.id, "宠物 id", 64);
  if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) {
    throw new Error("宠物 id 必须为 3–64 位小写字母、数字、点、下划线或连字符");
  }
  if (manifest.spriteVersionNumber !== 2 || manifest.spritesheetPath !== SPRITESHEET_FILE) {
    throw new Error(`pet.json 动画清单格式不受支持，spritesheetPath 必须为 ${SPRITESHEET_FILE}`);
  }
  return {
    id,
    displayName: text(manifest.displayName, "宠物名称", 80),
    ...(manifest.description === undefined ? {} : { description: text(manifest.description, "宠物描述", 500) }),
    spriteVersionNumber: 2,
    spritesheetPath: SPRITESHEET_FILE,
  };
}

function normalizeInteraction(value, index) {
  const interaction = object(value, `interactions[${index}]`);
  const event = text(interaction.on, `interactions[${index}].on`, 32);
  const play = text(interaction.play, `interactions[${index}].play`, 32);
  const then = interaction.then === undefined ? undefined : text(interaction.then, `interactions[${index}].then`, 32);
  if (!interactionEvents.has(event)) throw new Error(`interactions[${index}].on 不是受支持的互动事件`);
  if (!animationStates.has(play) || then && !animationStates.has(then)) throw new Error(`interactions[${index}] 必须引用 Deeptop Pet 标准动画`);
  if (then && loopingStates.has(play)) throw new Error(`interactions[${index}] 的循环动画不能声明 then`);
  return {
    on: event,
    play,
    ...(then ? { then } : {}),
    cooldownMs: integer(interaction.cooldownMs, `interactions[${index}].cooldownMs`, 0, 60_000, 0),
  };
}

function normalizeDeeptopManifest(value) {
  const manifest = object(value, DEEPTOP_MANIFEST_FILE);
  if (manifest.kind !== "deeptop-pet" || manifest.schemaVersion !== 2
    || manifest.runtimeProfile !== DEEPTOP_RUNTIME_PROFILE) {
    throw new Error(`${DEEPTOP_MANIFEST_FILE} 不是受支持的 Deeptop Pet 清单`);
  }
  const version = text(manifest.version, "版本", 80);
  if (!semverPattern.test(version)) throw new Error("版本必须是 SemVer");
  const sourceInteractions = manifest.interactions;
  if (sourceInteractions !== undefined && (!Array.isArray(sourceInteractions) || sourceInteractions.length > MAX_INTERACTIONS)) {
    throw new Error(`interactions 必须是最多 ${MAX_INTERACTIONS} 项的数组`);
  }
  return {
    kind: "deeptop-pet",
    schemaVersion: 2,
    runtimeProfile: DEEPTOP_RUNTIME_PROFILE,
    version,
    author: text(manifest.author, "作者名称", 80),
    license: text(manifest.license, "许可证", 120),
    ...(sourceInteractions === undefined ? {} : { interactions: sourceInteractions.map(normalizeInteraction) }),
  };
}

async function readSpritesheet(sourceRoot, resolvedRoot) {
  const file = path.join(sourceRoot, SPRITESHEET_FILE);
  const resolvedFile = await realpath(file);
  const relation = path.relative(resolvedRoot, resolvedFile);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) throw new Error(`${SPRITESHEET_FILE} 不能离开宠物源码目录`);
  const metadata = await stat(resolvedFile);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_ASSET_BYTES) throw new Error(`${SPRITESHEET_FILE} 必须是 10 MB 以内的文件`);
  const bytes = await readFile(resolvedFile);
  const dimensions = webpMetadata(bytes);
  if (dimensions.width !== PET_ATLAS_WIDTH || dimensions.height !== PET_ATLAS_HEIGHT) {
    throw new Error(`Deeptop Pet 图集必须是 ${PET_ATLAS_WIDTH}×${PET_ATLAS_HEIGHT}，实际为 ${dimensions.width}×${dimensions.height}`);
  }
  return bytes;
}

/** 把 Deeptop Pet 目录构建为安全、可重复生成的 `.deeptop-pet` ZIP 制品。 */
export async function buildPetBundle(sourceDirectory) {
  const sourceRoot = path.resolve(sourceDirectory);
  const resolvedRoot = await realpath(sourceRoot);
  const petManifest = normalizePetManifest(JSON.parse(await readFile(path.join(sourceRoot, PET_MANIFEST_FILE), "utf8")));
  const extensionPath = path.join(sourceRoot, DEEPTOP_MANIFEST_FILE);
  const deeptopManifest = existsSync(extensionPath)
    ? normalizeDeeptopManifest(JSON.parse(await readFile(extensionPath, "utf8")))
    : null;
  const spritesheet = await readSpritesheet(sourceRoot, resolvedRoot);
  const archiveEntries = {
    [PET_MANIFEST_FILE]: [strToU8(`${JSON.stringify(petManifest, null, 2)}\n`), { level: 6, mtime: ARCHIVE_TIME }],
    ...(deeptopManifest ? { [DEEPTOP_MANIFEST_FILE]: [strToU8(`${JSON.stringify(deeptopManifest, null, 2)}\n`), { level: 6, mtime: ARCHIVE_TIME }] } : {}),
    [SPRITESHEET_FILE]: [spritesheet, { level: 0, mtime: ARCHIVE_TIME }],
  };
  const bytes = zipSync(archiveEntries);
  if (bytes.length > MAX_PACK_BYTES) throw new Error("生成的宠物包不能超过 12 MB");
  return {
    bytes,
    integrity: bundleIntegrity(bytes),
    manifest: {
      ...petManifest,
      version: deeptopManifest?.version ?? "1.0.0",
      author: deeptopManifest?.author ?? "社区创作者",
      license: deeptopManifest?.license ?? "未声明",
    },
  };
}

export async function writePetBundle(sourceDirectory, outputFile, replaceExisting = false) {
  const bundle = await buildPetBundle(sourceDirectory);
  const output = path.resolve(outputFile || sourceDirectory, outputFile ? "" : `${bundle.manifest.id}-${bundle.manifest.version}.deeptop-pet`);
  if (existsSync(output) && !replaceExisting) throw new Error(`输出文件已存在：${output}（使用 --force 明确替换）`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bundle.bytes);
  return {
    path: output,
    manifest: bundle.manifest,
    ...bundle.integrity,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const replaceExisting = args.includes("--force");
  const positional = args.filter((argument) => argument !== "--force");
  if (positional.length < 1 || positional.length > 2) throw new Error("用法：npm run pet:pack -- <宠物目录> [输出.deeptop-pet] [--force]");
  const output = await writePetBundle(positional[0], positional[1], replaceExisting);
  process.stdout.write(`✅ Deeptop Pet 宠物包已生成：${output.path}\nSHA-256：${output.sha256}\n大小：${output.sizeBytes} 字节\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
