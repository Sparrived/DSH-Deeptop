import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedRoutingKeys,
  duplicateRoutingKey,
  readSubagentRouting,
  routingNotesByName,
  subagentRoutingOps,
} from "./subagent-routing-model.ts";

function namespace(ns, value) {
  return { ns, schema: {}, value, applies: "live", secrets: [], revision: 1 };
}

test("reads allowed routes from the official namespace and notes from the routing namespace", () => {
  const draft = readSubagentRouting(
    namespace("subagent-model-selection", {
      enabled: true,
      allowedModels: [
        { provider: "deepseek-official", model: "deepseek-v4-flash" },
        { provider: "deepseek-official", model: "deepseek-v4-pro" },
      ],
    }),
    namespace("deeptop-subagent-routing", {
      routes: [{ provider: "deepseek-official", model: "deepseek-v4-pro", note: " 疑难推理 " }],
      guidance: "自定义规则",
    }),
  );
  assert.deepEqual(draft, {
    enabled: true,
    rows: [
      { provider: "deepseek-official", model: "deepseek-v4-flash", note: "" },
      { provider: "deepseek-official", model: "deepseek-v4-pro", note: "疑难推理" },
    ],
    guidance: "自定义规则",
  });
});

test("tolerates missing namespaces and malformed route entries", () => {
  assert.deepEqual(readSubagentRouting(undefined, undefined), { enabled: false, rows: [], guidance: "" });
  assert.deepEqual(allowedRoutingKeys(namespace("ns", { allowedModels: [{ provider: "p" }, null, "x", { provider: "p", model: "m" }, { provider: "p", model: "m" }] })), [
    { provider: "p", model: "m" },
  ]);
  assert.deepEqual([...routingNotesByName(namespace("ns", { routes: [{ provider: "p", model: "m", note: "  " }, 7] })).entries()], []);
});

test("keeps notes keyed by the exact provider and model pair", () => {
  const notes = routingNotesByName(namespace("ns", {
    routes: [
      { provider: "a", model: "m", note: "甲" },
      { provider: "b", model: "m", note: "乙" },
    ],
  }));
  assert.equal(notes.get("a\u0000m"), "甲");
  assert.equal(notes.get("b\u0000m"), "乙");
  assert.equal(notes.size, 2);
});

test("reports the first duplicated route", () => {
  assert.equal(duplicateRoutingKey([{ provider: "p", model: "m", note: "" }, { provider: "p", model: "m", note: "" }]), "p/m");
  assert.equal(duplicateRoutingKey([{ provider: "p", model: "m", note: "" }, { provider: "p", model: "n", note: "" }]), undefined);
  assert.equal(duplicateRoutingKey([{ provider: " ", model: " ", note: "" }]), undefined);
});

test("emits ops only for changed fields", () => {
  const current = { enabled: true, rows: [{ provider: "p", model: "m", note: "" }], guidance: "" };
  const unchanged = subagentRoutingOps(current, current);
  assert.deepEqual(unchanged, { policy: [], routing: [] });

  const withNote = { ...current, rows: [{ provider: "p", model: "m", note: "用在这里" }] };
  assert.deepEqual(subagentRoutingOps(current, withNote), {
    policy: [],
    routing: [{ op: "set", path: ["routes"], value: [{ provider: "p", model: "m", note: "用在这里" }] }],
  });
});

test("forces the policy off when no route remains and trims row fields", () => {
  const current = { enabled: true, rows: [{ provider: "p", model: "m", note: "旧说明" }], guidance: "" };
  const cleared = { enabled: true, rows: [], guidance: "" };
  const ops = subagentRoutingOps(current, cleared);
  assert.deepEqual(ops.policy, [
    { op: "set", path: ["enabled"], value: false },
    { op: "set", path: ["allowedModels"], value: [] },
  ]);
  assert.deepEqual(ops.routing, [{ op: "set", path: ["routes"], value: [] }]);

  const padded = subagentRoutingOps(current, {
    enabled: true,
    rows: [{ provider: " p ", model: " m ", note: " 新说明 " }],
    guidance: "规则",
  });
  assert.deepEqual(padded.policy, []);
  assert.deepEqual(padded.routing, [
    { op: "set", path: ["routes"], value: [{ provider: "p", model: "m", note: "新说明" }] },
    { op: "set", path: ["guidance"], value: "规则" },
  ]);
});

test("drops incomplete rows instead of writing them", () => {
  const ops = subagentRoutingOps(
    { enabled: false, rows: [], guidance: "" },
    { enabled: true, rows: [{ provider: "p", model: "", note: "" }, { provider: "p", model: "m", note: "" }], guidance: "" },
  );
  assert.deepEqual(ops.policy, [
    { op: "set", path: ["enabled"], value: true },
    { op: "set", path: ["allowedModels"], value: [{ provider: "p", model: "m" }] },
  ]);
});
