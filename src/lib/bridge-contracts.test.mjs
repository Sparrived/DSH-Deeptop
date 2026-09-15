import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  bridgeContracts,
  bridgeErrorCode,
  capabilityRequiredBy,
  isBridgeUnavailableError,
  isCapabilityUnavailable,
  remoteContracts,
} from "./bridge-contracts.ts";

test("every bridge method declares a capability requirement", () => {
  for (const [method, contract] of Object.entries(bridgeContracts)) {
    assert.equal(typeof contract.requires, "string", `${method} requires a capability key`);
    assert.ok(contract.requires.length > 0, `${method} requires a non-empty capability key`);
  }
});

test("registry covers every method the desktop frontend invokes", () => {
  const expected = [
    "session.list", "session.search", "session.create", "session.history", "session.models",
    "session.selectModel", "session.rename", "session.fork", "session.prompt",
    "session.attachment", "session.cancel", "session.exportZip", "session.updateQueue",
    "session.repairCorrupt",
    "workspace.list", "workspace.create", "workspace.attachSession", "workspace.rename",
    "workspace.delete", "workspace.insertSessionBefore", "workspace.archiveSession",
    "workspace.restoreSession", "workspace.deleteArchivedSession", "workspace.setSessionPinned",
    "reference.files", "reference.sessions",
    "messageAnnotations.list", "messageAnnotations.put", "messageAnnotations.delete",
    "subagent.list", "subagent.history", "subagent.prompt", "subagent.interrupt",
    "skill.list", "skill.install", "tool.settings.describe", "skill.settings.install",
    "skill.settings.installStatus", "skill.settings.cancelInstall", "skill.settings.remove",
    "skill.settings.openDirectory", "mcp.settings.mutate",
    "desktop.capabilities",
    "agentPreset.list", "agentPreset.select", "agentPreset.read", "agentPreset.copy",
    "agentPreset.openDocument", "agentPreset.remove",
    "goal.create", "goal.edit", "goal.pause", "goal.resume", "goal.complete", "goal.clear",
    "settings.describe", "settings.update", "settings.replace", "settings.mutate", "settings.openDocument",
    "credentials.describe", "credentials.set", "credentials.unset",
    "llm.providers", "llm.models", "llm.discoverModels",
    "host.describe", "host.pickDirectory", "host.openPath",
    "plugin.list", "plugin.config.describe", "plugin.config.mutate",
    "respond",
  ];
  for (const method of expected) {
    assert.ok(method in bridgeContracts, `missing contract for ${method}`);
  }
});

test("remote contracts keep the official namespace/method names", () => {
  assert.equal(remoteContracts["commands/list"].namespace, "commands");
  assert.equal(remoteContracts["commands/list"].method, "list");
  assert.equal(remoteContracts["commands/execute"].method, "execute");
  assert.equal(capabilityRequiredBy("reference.files"), "references");
  assert.equal(capabilityRequiredBy("session.exportZip"), "sessionExport");
});

// Typert admits arguments by the descriptor's exact wire fields, so a renamed
// Remote parameter must be mirrored at the call site or every invocation fails
// with `gateway/arguments-invalid` before the command handler runs.
test("the commands/execute call site sends the vendored Remote wire fields", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const call = /desktopRemoteInvoke\("commands\/execute",\s*\{([^}]*)\}/.exec(app)?.[1];
  assert.ok(call, "commands/execute call site not found");
  const fields = [...call.matchAll(/(?:^|,)\s*(\w+)\s*(?=[,:])/gu)].map((match) => match[1]).sort();
  assert.deepEqual(fields, ["agentId", "line", "submittedAttachments"]);
});

test("error code helpers classify only the expected failures", () => {
  const withCode = (code) => Object.assign(new Error(code), { code });
  assert.equal(bridgeErrorCode(withCode("reference-unavailable")), "reference-unavailable");
  assert.equal(bridgeErrorCode(new Error("plain")), undefined);
  assert.equal(isCapabilityUnavailable(withCode("reference-unavailable")), true);
  assert.equal(isCapabilityUnavailable(withCode("bridge-unavailable")), true);
  assert.equal(isCapabilityUnavailable(withCode("session-not-found")), false);
  assert.equal(isCapabilityUnavailable(new Error("plain")), false);
  assert.equal(isBridgeUnavailableError(withCode("bridge-unavailable")), true);
  assert.equal(isBridgeUnavailableError(withCode("reference-unavailable")), false);
});
