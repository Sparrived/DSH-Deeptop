import assert from "node:assert/strict";
import test from "node:test";
import { declareModelReasoningEffortsOps, errorText, modelHasMaxReasoning, providerApiKeyEnvOp, providerSettingsOps, toggleModelMaxReasoning } from "./settings-model.ts";

test("maps RC8 routing, timezone and image admission errors", () => {
  const modelError = new Error("provider rejected model");
  modelError.code = "model-unavailable";
  assert.match(errorText(modelError), /当前模型不可用/);
  const zoneError = new Error("invalid zone");
  zoneError.code = "invalid-time-zone";
  assert.match(errorText(zoneError), /客户端时区无效/);
  const imageError = new Error("image rejected");
  imageError.code = "attachment-error";
  imageError.details = { reason: "IMAGE_TOO_MANY_PIXELS" };
  assert.match(errorText(imageError), /图片像素数/);
  const missingAttachment = new Error("Attachment object is missing.");
  missingAttachment.code = "session/attachment-invalid";
  missingAttachment.details = { reason: "ATTACHMENT_NOT_FOUND" };
  assert.match(errorText(missingAttachment), /图片文件已不在本地存储/);
  const workspaceError = new Error("cannot attach session 'session-1' to workspace 'E:/目录': its cwd 'E:/目录' does not resolve");
  workspaceError.code = "workspace-unavailable";
  assert.match(errorText(workspaceError), /工作区目录当前不可用/);
});

const settingsPath = ["providers", "amkr-service"];
const stored = {
  apiKeyEnv: "AMKR_SERVICE_API_KEY",
  api: "openai-completions",
  baseURL: "http://127.0.0.1:28881/v1",
  models: [{ id: "unified-model", name: "统一模型" }],
};

test("toggleModelMaxReasoning adds and removes only the canonical max level", () => {
  const model = { id: "unified-model", name: "统一模型", input: ["text"], reasoningEfforts: { off: "none", high: "high" } };
  assert.equal(modelHasMaxReasoning(model), false);
  const enabled = toggleModelMaxReasoning(model);
  assert.equal(modelHasMaxReasoning(enabled), true);
  assert.deepEqual(enabled.reasoningEfforts, { off: "none", high: "high", max: "max" });
  assert.deepEqual(model, { id: "unified-model", name: "统一模型", input: ["text"], reasoningEfforts: { off: "none", high: "high" } });
  const disabled = toggleModelMaxReasoning(enabled);
  assert.equal(modelHasMaxReasoning(disabled), false);
  assert.deepEqual(disabled.reasoningEfforts, { off: "none", high: "high" });
});

test("toggleModelMaxReasoning removes an off-only declaration instead of creating an invalid profile", () => {
  const disabled = toggleModelMaxReasoning({ id: "unified-model", reasoningEfforts: { off: null, max: "max" } });
  assert.deepEqual(disabled, { id: "unified-model" });
});

test("declareModelReasoningEffortsOps declares on the listed model entry", () => {
  const efforts = { low: "low", medium: "medium", high: "high" };
  const ops = declareModelReasoningEffortsOps(settingsPath, stored.models, "unified-model", efforts);
  assert.deepEqual(ops, [{
    op: "set",
    path: [...settingsPath, "models"],
    value: [{ id: "unified-model", name: "统一模型", reasoningEfforts: efforts }],
  }]);
});

test("declareModelReasoningEffortsOps falls back to modelOverrides for a catalog model", () => {
  const ops = declareModelReasoningEffortsOps(settingsPath, stored.models, "unlisted-model", { high: "high" });
  assert.deepEqual(ops, [{
    op: "set",
    path: [...settingsPath, "modelOverrides", "unlisted-model", "reasoningEfforts"],
    value: { high: "high" },
  }]);
});

test("declareModelReasoningEffortsOps skips an already identical entry declaration", () => {
  const declared = [{ id: "unified-model", reasoningEfforts: { low: "low" } }];
  assert.deepEqual(declareModelReasoningEffortsOps(settingsPath, declared, "unified-model", { low: "low" }), []);
  assert.equal(declareModelReasoningEffortsOps(settingsPath, declared, "unified-model", { high: "high" }).length, 1);
});

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
