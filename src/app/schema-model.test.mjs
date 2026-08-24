import assert from "node:assert/strict";
import test from "node:test";
import { isSchemaEnvelope, schemaEnumChoices, schemaNodeAtPath, schemaObjectHasKeys, schemaRootNode } from "./schema-model.ts";

/** Build the toJSON-style envelope of a small object schema, mirroring schemastery's shape. */
function envelopeOf(rootNode) {
  const refs = { 0: rootNode };
  return { uid: 0, refs };
}

test("recognizes a schemastery envelope", () => {
  assert.equal(isSchemaEnvelope({ uid: 0, refs: {} }), true);
  assert.equal(isSchemaEnvelope(null), false);
  assert.equal(isSchemaEnvelope({ uid: 0 }), false);
  assert.equal(isSchemaEnvelope([{ uid: 0, refs: {} }]), false);
});

test("walks object paths through dict refs", () => {
  const envelope = envelopeOf({
    type: "object",
    meta: {},
    dict: { defaultPreset: 1, credentialRef: 2 },
  });
  envelope.refs[1] = { type: "union", list: [3, 4] };
  envelope.refs[2] = { type: "string", meta: { role: "credential-ref" } };
  envelope.refs[3] = { type: "const", value: "workspace-write", meta: { description: "Write inside the workspace" } };
  envelope.refs[4] = { type: "const", value: "danger-full-access", meta: { description: "Full access" } };
  const union = schemaNodeAtPath(envelope, ["defaultPreset"]);
  assert.equal(union?.type, "union");
  assert.deepEqual(schemaEnumChoices(union, envelope), [
    { value: "workspace-write", description: "Write inside the workspace" },
    { value: "danger-full-access", description: "Full access" },
  ]);
  assert.equal(schemaObjectHasKeys(schemaRootNode(envelope), ["defaultPreset"]), true);
  assert.equal(schemaObjectHasKeys(schemaRootNode(envelope), ["missing"]), false);
});

test("reads single const choices and missing nodes safely", () => {
  const envelope = envelopeOf({ type: "const", value: "fixed" });
  assert.deepEqual(schemaEnumChoices(schemaRootNode(envelope), envelope), [{ value: "fixed" }]);
  assert.equal(schemaNodeAtPath(envelope, ["nope"]), undefined);
  assert.deepEqual(schemaEnumChoices(undefined, envelope), []);
  assert.deepEqual(schemaEnumChoices({ type: "string" }, envelope), []);
});

test("keeps node references resolvable only through refs", () => {
  const envelope = envelopeOf({ type: "array", inner: 7 });
  assert.equal(envelope.refs[7], undefined);
  assert.deepEqual(schemaEnumChoices(schemaNodeAtPath(envelope, []), envelope), []);
});