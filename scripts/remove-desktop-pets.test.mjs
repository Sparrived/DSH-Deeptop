import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyRemovalPlan,
  removeDesktopPets,
  resolveOwnedPath,
  stripFeatureBlocks,
  transformCargoToml,
  transformPackageJson,
  transformPackageLock,
  transformTauriConfig,
} from "./remove-desktop-pets.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("stripFeatureBlocks removes complete regions and preserves CRLF", () => {
  const source = [
    "const core = true;",
    "// @deeptop-pets:start first",
    "const pet = true;",
    "// @deeptop-pets:end first",
    "const coreToo = true;",
    "/* @deeptop-pets:start second */",
    "pet();",
    "/* @deeptop-pets:end second */",
    "",
  ].join("\r\n");
  assert.equal(stripFeatureBlocks(source, "fixture.ts"), "const core = true;\r\nconst coreToo = true;\r\n");
});

test("stripFeatureBlocks does not leave a doubled separator line", () => {
  const source = [
    "const before = true;",
    "",
    "// @deeptop-pets:start removable",
    "const pet = true;",
    "// @deeptop-pets:end removable",
    "",
    "const after = true;",
    "",
  ].join("\n");
  assert.equal(stripFeatureBlocks(source), "const before = true;\n\nconst after = true;\n");
});

test("stripFeatureBlocks fails closed for missing, nested and mismatched markers", () => {
  assert.throws(() => stripFeatureBlocks("const core = true;\n", "missing.ts"), /没有宠物功能标记/u);
  assert.throws(() => stripFeatureBlocks([
    "// @deeptop-pets:start outer",
    "// @deeptop-pets:start inner",
  ].join("\n"), "nested.ts"), /嵌套/u);
  assert.throws(() => stripFeatureBlocks([
    "// @deeptop-pets:start left",
    "// @deeptop-pets:end right",
  ].join("\n"), "mismatch.ts"), /不匹配/u);
});

test("resolveOwnedPath permits only a non-root descendant", () => {
  const root = path.resolve("fixture-root");
  assert.equal(resolveOwnedPath(root, "src/pets"), path.join(root, "src", "pets"));
  assert.throws(() => resolveOwnedPath(root, ""), /非法/u);
  assert.throws(() => resolveOwnedPath(root, ".."), /越出/u);
  assert.throws(() => resolveOwnedPath(root, path.resolve(root, "src")), /非法/u);
});

test("structured transforms remove only declared feature entries", () => {
  const packageText = `${JSON.stringify({
    scripts: {
      test: "node --test pet.test.mjs keep.test.mjs",
      "pet:pack": "pack",
      "pets:remove": "remove",
    },
    devDependencies: { fflate: "1", typescript: "2" },
  }, null, 2)}\n`;
  const transformedPackage = JSON.parse(transformPackageJson(packageText, {
    scripts: ["pet:pack", "pets:remove"],
    testEntries: ["pet.test.mjs"],
    devDependencies: ["fflate"],
  }));
  assert.deepEqual(transformedPackage.scripts, { test: "node --test keep.test.mjs" });
  assert.deepEqual(transformedPackage.devDependencies, { typescript: "2" });

  const lockText = `${JSON.stringify({ packages: {
    "": { devDependencies: { fflate: "1", typescript: "2" } },
    "node_modules/fflate": { version: "1" },
    "node_modules/typescript": { version: "2" },
  } }, null, 2)}\n`;
  const transformedLock = JSON.parse(transformPackageLock(lockText, {
    rootDevDependencies: ["fflate"],
    packages: ["node_modules/fflate"],
  }));
  assert.deepEqual(transformedLock.packages[""].devDependencies, { typescript: "2" });
  assert.equal(transformedLock.packages["node_modules/fflate"], undefined);
  assert.ok(transformedLock.packages["node_modules/typescript"]);

  const tauri = JSON.parse(transformTauriConfig('{"app":{"macOSPrivateApi":true,"windows":[]}}\n', {
    appKeys: ["macOSPrivateApi"],
  }));
  assert.deepEqual(tauri.app, { windows: [] });

  const cargo = transformCargoToml('tauri = { version = "2", features = ["macos-private-api", "tray-icon"] }\n', {
    tauriFeatures: ["macos-private-api"],
  });
  assert.equal(cargo, 'tauri = { version = "2", features = ["tray-icon"] }\n');
});

test("removeDesktopPets applies a complete miniature removal plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeptop-pet-removal-test-"));
  const put = async (relative, content) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  };
  try {
    const manifest = {
      schemaVersion: 1,
      id: "desktop-pets",
      markerFiles: ["source.ts", "src-tauri/Cargo.toml"],
      ownedPaths: ["owned/pet.txt"],
      generatedPaths: ["generated"],
      removalToolPaths: ["tool.mjs", "desktop-pets.feature.json"],
      packageJson: {
        scripts: ["pet:pack", "pets:remove"],
        testEntries: ["pet.test.mjs"],
        devDependencies: ["fflate"],
      },
      packageLock: {
        rootDevDependencies: ["fflate"],
        packages: ["node_modules/fflate"],
      },
      cargo: { tauriFeatures: ["macos-private-api"] },
      tauriConfig: { appKeys: ["macOSPrivateApi"] },
    };
    await put("desktop-pets.feature.json", `${JSON.stringify(manifest, null, 2)}\n`);
    await put("source.ts", [
      "const core = true;",
      "// @deeptop-pets:start fixture",
      "const pet = true;",
      "// @deeptop-pets:end fixture",
      "",
    ].join("\n"));
    await put("src-tauri/Cargo.toml", [
      "[package]",
      'name = "fixture"',
      'version = "0.0.0"',
      "",
      "[dependencies]",
      'tauri = { version = "2", features = ["macos-private-api", "tray-icon"] }',
      "# @deeptop-pets:start fixture-dependency",
      'base64 = "0.22"',
      "# @deeptop-pets:end fixture-dependency",
      "",
    ].join("\n"));
    await put("package.json", `${JSON.stringify({
      scripts: {
        test: "node --test pet.test.mjs keep.test.mjs",
        "pet:pack": "pack",
        "pets:remove": "remove",
      },
      devDependencies: { fflate: "1", typescript: "2" },
    }, null, 2)}\n`);
    await put("package-lock.json", `${JSON.stringify({ packages: {
      "": { devDependencies: { fflate: "1", typescript: "2" } },
      "node_modules/fflate": { version: "1" },
    } }, null, 2)}\n`);
    await put("src-tauri/tauri.conf.json", '{"app":{"macOSPrivateApi":true,"windows":[]}}\n');
    await put("owned/pet.txt", "pet\n");
    await put("generated/stale-pet.json", "pet\n");
    await put("tool.mjs", "tool\n");

    await removeDesktopPets(root, { apply: true, refreshCargoLock: false });

    assert.equal(await readFile(path.join(root, "source.ts"), "utf8"), "const core = true;\n");
    assert.match(await readFile(path.join(root, "src-tauri", "Cargo.toml"), "utf8"), /features = \["tray-icon"\]/u);
    assert.doesNotMatch(await readFile(path.join(root, "src-tauri", "Cargo.toml"), "utf8"), /base64|deeptop-pets/u);
    await assert.rejects(access(path.join(root, "owned", "pet.txt")));
    await assert.rejects(access(path.join(root, "generated")));
    await assert.rejects(access(path.join(root, "tool.mjs")));
    await assert.rejects(access(path.join(root, "desktop-pets.feature.json")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyRemovalPlan rolls back every change when a write fails mid-run", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "deeptop-pet-rollback-test-"));
  const put = async (relative, content) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  };
  try {
    // 两个带标记的文件 + 一个待删除目录；把第二个标记文件的属性改为只读，
    // 使写入在第一个文件已被改写之后失败，验证快照回滚。
    await put("first.ts", [
      "const one = true;",
      "// @deeptop-pets:start block-one",
      "const petOne = true;",
      "// @deeptop-pets:end block-one",
      "",
    ].join("\n"));
    await put("second.ts", [
      "const two = true;",
      "// @deeptop-pets:start block-two",
      "const petTwo = true;",
      "// @deeptop-pets:end block-two",
      "",
    ].join("\n"));
    await put("owned/pet.txt", "pet\n");
    await put("owned/nested/deep.txt", "deep\n");

    const originalFirst = await readFile(path.join(root, "first.ts"), "utf8");
    const originalSecond = await readFile(path.join(root, "second.ts"), "utf8");
    const plan = {
      writes: new Map([
        [path.join(root, "first.ts"), "const one = true;\n"],
        [path.join(root, "second.ts"), "const two = true;\n"],
      ]),
      ownedPaths: [path.join(root, "owned")],
      generatedPaths: [],
      removalToolPaths: [],
    };
    const locked = path.join(root, "second.ts");
    await chmod(locked, 0o444);

    await assert.rejects(applyRemovalPlan(plan, root), /已回滚全部改动/u);
    assert.equal(await readFile(path.join(root, "first.ts"), "utf8"), originalFirst);
    assert.equal(await readFile(path.join(root, "second.ts"), "utf8"), originalSecond);
    assert.equal(await readFile(path.join(root, "owned", "pet.txt"), "utf8"), "pet\n");
    assert.equal(await readFile(path.join(root, "owned", "nested", "deep.txt"), "utf8"), "deep\n");

    await chmod(locked, 0o644);
    // 回滚后仓库保持原状，剔除可以重新执行并成功。
    await applyRemovalPlan(plan, root);
    assert.equal(await readFile(path.join(root, "first.ts"), "utf8"), "const one = true;\n");
    await assert.rejects(access(path.join(root, "owned", "pet.txt")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the repository feature manifest remains fully detachable", async () => {
  const plan = await removeDesktopPets(repositoryRoot);
  assert.ok(plan.writes.size >= 10);
  assert.ok(plan.ownedPaths.length >= 20);
  assert.ok(plan.removalToolPaths.length >= 3);
});
