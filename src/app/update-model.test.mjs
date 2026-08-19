import assert from "node:assert/strict";
import test from "node:test";
import { updateCheckErrorMessage, updateCheckStateFromResult, updateDownloadStateFromEvent } from "./update-model.ts";

const result = {
  currentVersion: "0.1.2-dev.2",
  channel: "development",
  latestVersion: "0.2.0-dev.1",
  releaseTag: "v0.2.0-dev.1",
  releaseName: "Deeptop 0.2.0-dev.1",
  releaseUrl: "https://github.com/Sparrived/DSH-Deeptop/releases/tag/v0.2.0-dev.1",
  assetName: "Deeptop-0.2.0-dev.1-windows-x64-setup.exe",
  assetSize: 1024,
  sha256: "a".repeat(64),
  installSupported: true,
  updateAvailable: true,
};

test("update result becomes an available development state", () => {
  assert.deepEqual(updateCheckStateFromResult(result, 123), {
    status: "available",
    channel: "development",
    checkedAt: 123,
    latestVersion: "0.2.0-dev.1",
    releaseTag: "v0.2.0-dev.1",
    releaseName: "Deeptop 0.2.0-dev.1",
    releaseUrl: "https://github.com/Sparrived/DSH-Deeptop/releases/tag/v0.2.0-dev.1",
    assetName: "Deeptop-0.2.0-dev.1-windows-x64-setup.exe",
    assetSize: 1024,
    sha256: "a".repeat(64),
    installSupported: true,
  });
});

test("up-to-date result keeps the selected channel", () => {
  assert.deepEqual(updateCheckStateFromResult({ ...result, updateAvailable: false }, 456), {
    status: "up-to-date",
    channel: "development",
    checkedAt: 456,
  });
});

test("download progress events become actionable states", () => {
  assert.deepEqual(updateDownloadStateFromEvent({ phase: "downloading", releaseTag: "v0.2.0", assetName: "update.exe", downloadedBytes: 50, totalBytes: 100, percent: 50 }), {
    status: "downloading",
    releaseTag: "v0.2.0",
    assetName: "update.exe",
    downloadedBytes: 50,
    totalBytes: 100,
    percent: 50,
  });
  assert.deepEqual(updateDownloadStateFromEvent({ phase: "ready", releaseTag: "v0.2.0", assetName: "update.exe", path: "C:/cache/update.exe", sha256: "b".repeat(64) }), {
    status: "ready",
    releaseTag: "v0.2.0",
    assetName: "update.exe",
    path: "C:/cache/update.exe",
    sha256: "b".repeat(64),
  });
  assert.deepEqual(updateDownloadStateFromEvent({ phase: "failed", message: "校验失败" }), { status: "error", message: "校验失败" });
});

test("update errors keep useful messages", () => {
  assert.equal(updateCheckErrorMessage(new Error("网络不可用")), "网络不可用");
  assert.equal(updateCheckErrorMessage(null), "更新检查失败");
});
