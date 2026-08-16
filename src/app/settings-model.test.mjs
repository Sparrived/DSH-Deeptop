import assert from "node:assert/strict";
import test from "node:test";
import { providerApiKeyEnvOp, providerSettingsOps } from "./settings-model.ts";

const settingsPath = ["providers", "amkr-service"];
const stored = {
  apiKeyEnv: "AMKR_SERVICE_API_KEY",
  api: "openai-completions",
  baseURL: "http://127.0.0.1:28881/v1",
  models: [{ id: "unified-model", name: "统一模型" }],
};

test("providerSettingsOps only touches the edited field", () => {
  const ops = providerSettingsOps(settingsPath, stored, {
    baseURL: "http://127.0.0.1:28881/v2",
    api: "openai-completions",
  });
  assert.deepEqual(ops, [
    { op: "set", path: [...settingsPath, "baseURL"], value: "http://127.0.0.1:28881/v2" },
  ]);
});

test("providerSettingsOps never names apiKeyEnv", () => {
  const ops = providerSettingsOps(settingsPath, stored, {
    baseURL: "http://127.0.0.1:28881/v2",
    api: "openai-completions",
    models: stored.models,
  });
  assert.ok(ops.length > 0);
  assert.ok(ops.every((op) => !op.path.includes("apiKeyEnv")));
});

test("providerSettingsOps skips the write when nothing changed", () => {
  const ops = providerSettingsOps(settingsPath, stored, {
    baseURL: stored.baseURL,
    api: stored.api,
    models: stored.models,
  });
  assert.deepEqual(ops, []);
});

test("providerSettingsOps clears a field with unset when the patch value is empty", () => {
  const ops = providerSettingsOps(settingsPath, stored, { baseURL: null, api: "openai-completions" });
  assert.deepEqual(ops, [{ op: "unset", path: [...settingsPath, "baseURL"] }]);
});

test("providerSettingsOps does not emit a no-op unset for an absent field", () => {
  const ops = providerSettingsOps(settingsPath, { api: "openai-completions" }, { baseURL: null });
  assert.deepEqual(ops, []);
});

test("providerSettingsOps writes models only when the array differs", () => {
  const changed = providerSettingsOps(settingsPath, stored, {
    models: [{ id: "unified-model", name: "另一个模型" }],
  });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].op, "set");
  assert.deepEqual(changed[0].path, [...settingsPath, "models"]);

  const same = providerSettingsOps(settingsPath, stored, { models: stored.models });
  assert.deepEqual(same, []);
});

test("providerSettingsOps never emits a wholesale provider replacement", () => {
  const ops = providerSettingsOps(settingsPath, stored, { baseURL: "http://127.0.0.1:28881/v2" });
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].path, [...settingsPath, "baseURL"]);
});

test("providerSettingsOps supports an empty settings path (whole-section provider)", () => {
  const ops = providerSettingsOps([], { apiKeyEnv: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com" }, {
    baseURL: "https://api.deepseek.com/v2",
  });
  assert.deepEqual(ops, [{ op: "set", path: ["baseURL"], value: "https://api.deepseek.com/v2" }]);
});

test("providerApiKeyEnvOp records the ref when the profile names none", () => {
  const op = providerApiKeyEnvOp(settingsPath, { api: "openai-completions" }, "AMKR_SERVICE_API_KEY");
  assert.deepEqual(op, { op: "set", path: [...settingsPath, "apiKeyEnv"], value: "AMKR_SERVICE_API_KEY" });
});

test("providerApiKeyEnvOp skips when the profile already names a ref", () => {
  const op = providerApiKeyEnvOp(settingsPath, stored, "AMKR_SERVICE_API_KEY");
  assert.equal(op, undefined);
});

test("providerApiKeyEnvOp handles a whole-section provider", () => {
  const op = providerApiKeyEnvOp([], { baseURL: "https://api.deepseek.com" }, "DEEPSEEK_API_KEY");
  assert.deepEqual(op, { op: "set", path: ["apiKeyEnv"], value: "DEEPSEEK_API_KEY" });
});
