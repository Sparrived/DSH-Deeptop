import assert from "node:assert/strict";
import test from "node:test";
import { schemaDraftOps } from "./schema-form-model.ts";

test("maps a touched-field draft to mutate ops by path", () => {
  assert.deepEqual(schemaDraftOps({
    "baseURL": "https://api.example.com/v1",
    "models/0/id": "my-model",
    "retryPolicy/maxRetries": 3,
  }), [
    { op: "set", path: ["baseURL"], value: "https://api.example.com/v1" },
    { op: "set", path: ["models", "0", "id"], value: "my-model" },
    { op: "set", path: ["retryPolicy", "maxRetries"], value: 3 },
  ]);
});

test("emits unset for cleared fields and nothing for an empty draft", () => {
  assert.deepEqual(schemaDraftOps({ "baseURL": null }), [{ op: "unset", path: ["baseURL"] }]);
  assert.deepEqual(schemaDraftOps({}), []);
});

test("keeps booleans and numbers typed", () => {
  assert.deepEqual(schemaDraftOps({ "enabled": true, "limit": 0 }), [
    { op: "set", path: ["enabled"], value: true },
    { op: "set", path: ["limit"], value: 0 },
  ]);
});