import assert from "node:assert/strict";
import test from "node:test";
import { capabilityNotice, capabilityStatus } from "./capability-model.ts";

function capabilities(services) {
  return {
    probedAt: 1,
    services: {
      bootstrap: true,
      sessions: true,
      workspace: true,
      references: true,
      annotations: true,
      subagents: true,
      tasks: true,
      skills: true,
      agentPresets: true,
      goals: true,
      settings: true,
      credentials: true,
      llm: true,
      plugins: true,
      tools: true,
      sessionExport: true,
      commands: true,
      fileAttachments: true,
      ...services,
    },
  };
}

test("no probe means no degradation (backward compatible)", () => {
  const status = capabilityStatus(null);
  assert.equal(status.probed, false);
  assert.deepEqual(status.missing, []);
  assert.equal(status.features.workspace, true);
  assert.equal(capabilityNotice(null), null);
});

test("full probe exposes every degradable feature", () => {
  const status = capabilityStatus(capabilities({}));
  assert.equal(status.probed, true);
  assert.deepEqual(status.missing, []);
  for (const feature of Object.values(status.features)) assert.equal(feature, true);
  assert.equal(capabilityNotice(capabilities({})), null);
});

test("missing capabilities degrade only the affected features", () => {
  const status = capabilityStatus(capabilities({
    references: false,
    sessionExport: false,
    commands: false,
  }));
  assert.deepEqual(status.missing, ["references", "commands", "sessionExport"]);
  assert.equal(status.features.references, false);
  assert.equal(status.features.commands, false);
  assert.equal(status.features.sessionExport, false);
  assert.equal(status.features.workspace, true);
  assert.equal(status.features.annotations, true);
  assert.match(capabilityNotice(capabilities({ references: false, sessionExport: false })), /引用候选、会话 ZIP 导出/);
});

test("a runtime without file staging degrades only non-image attachments", () => {
  const status = capabilityStatus(capabilities({ fileAttachments: false }));
  assert.deepEqual(status.missing, ["fileAttachments"]);
  assert.equal(status.features.fileAttachments, false);
  // 图片附件走的是既有的原生图片管线，不受文件附件能力影响。
  assert.equal(status.features.references, true);
  assert.match(capabilityNotice(capabilities({ fileAttachments: false })), /文件附件/);
});

test("unprobed capabilities never disable file attachments", () => {
  // 探测失败（null）与「探测到能力缺失」不同：前者保持旧行为，不误判为退化。
  assert.equal(capabilityStatus(null).features.fileAttachments, true);
  assert.equal(capabilityStatus(capabilities({})).features.fileAttachments, true);
});
