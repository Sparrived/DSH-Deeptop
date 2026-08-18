import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "generate-release-notes.mjs");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commit(cwd, message, content) {
  writeFileSync(path.join(cwd, "change.txt"), `${content}\n`, "utf8");
  git(cwd, ["add", "change.txt"]);
  git(cwd, ["commit", "-m", message]);
}

function generate(cwd, tag, output) {
  const env = { ...process.env };
  delete env.GITHUB_REPOSITORY;
  delete env.GITHUB_SERVER_URL;
  execFileSync(process.execPath, [script, "--tag", tag, "--version", tag.slice(1), "--output", output], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return readFileSync(path.join(cwd, output), "utf8");
}

test("开发版比较上一个 Tag，正式版只比较上一个正式版", () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), "deeptop-release-notes-"));
  try {
    git(repository, ["init", "-b", "master"]);
    git(repository, ["config", "user.name", "Release Notes Test"]);
    git(repository, ["config", "user.email", "release-notes@example.test"]);
    commit(repository, "chore(test): 初始化版本", "base");
    git(repository, ["tag", "v0.1.0"]);
    commit(repository, "feat(test): 稳定版功能", "stable-1");
    git(repository, ["tag", "v0.1.1"]);
    commit(repository, "fix(test): 开发版修复一", "dev-1");
    git(repository, ["tag", "v0.1.1-dev.1"]);
    commit(repository, "fix(test): 开发版修复二", "dev-2");
    git(repository, ["tag", "v0.1.1-dev.2"]);
    commit(repository, "feat(test): 下一稳定版功能", "stable-2");
    git(repository, ["tag", "v0.1.2"]);

    const devNotes = generate(repository, "v0.1.1-dev.2", "dev-notes.md");
    assert.match(devNotes, /对比 `v0\.1\.1-dev\.1`/);
    assert.doesNotMatch(devNotes, /对比 `v0\.1\.1`/);

    const stableNotes = generate(repository, "v0.1.2", "stable-notes.md");
    assert.match(stableNotes, /对比 `v0\.1\.1`/);
    assert.doesNotMatch(stableNotes, /对比 `v0\.1\.1-dev\.2`/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
