import assert from "node:assert/strict";
import test from "node:test";
import { updateCheckErrorMessage, updateCheckStateFromResult } from "./update-model.ts";

const result = {
  currentVersion: "0.1.2-dev.2",
  latestVersion: "0.2.0",
  releaseTag: "v0.2.0",
  releaseName: "Deeptop 0.2.0",
  releaseUrl: "https://github.com/Sparrived/DSH-Deeptop/releases/tag/v0.2.0",
  updateAvailable: true,
};

test("update result becomes an available state", () => {
  assert.deepEqual(updateCheckStateFromResult(result, 123), {
    status: "available",
    checkedAt: 123,
    latestVersion: "0.2.0",
    releaseTag: "v0.2.0",
    releaseUrl: "https://github.com/Sparrived/DSH-Deeptop/releases/tag/v0.2.0",
  });
});

test("up-to-date result does not expose a release action", () => {
  assert.deepEqual(updateCheckStateFromResult({ ...result, updateAvailable: false }, 456), {
    status: "up-to-date",
    checkedAt: 456,
  });
});

test("update errors keep useful messages", () => {
  assert.equal(updateCheckErrorMessage(new Error("网络不可用")), "网络不可用");
  assert.equal(updateCheckErrorMessage(null), "更新检查失败");
});
