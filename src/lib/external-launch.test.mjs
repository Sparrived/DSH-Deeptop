import assert from "node:assert/strict";
import test from "node:test";
import { externalLaunchKey, parseExternalLaunchPayload } from "./external-launch.ts";

test("accepts the native external launch protocol", () => {
  const request = parseExternalLaunchPayload({ paths: ["C:\\work\\demo"], cwd: "C:\\work\\demo", source: "windows-context-menu" });
  assert.deepEqual(request, { paths: ["C:\\work\\demo"], cwd: "C:\\work\\demo", source: "windows-context-menu" });
});

test("rejects malformed or empty native launch payloads", () => {
  assert.equal(parseExternalLaunchPayload(null), null);
  assert.equal(parseExternalLaunchPayload({ paths: [], cwd: "C:\\work" }), null);
  assert.equal(parseExternalLaunchPayload({ paths: [""], cwd: "C:\\work" }), null);
  assert.equal(parseExternalLaunchPayload({ paths: ["C:\\work"], cwd: "" }), null);
});

test("uses a stable key for queue de-duplication", () => {
  assert.equal(externalLaunchKey({ paths: ["C:\\a", "C:\\b"], cwd: "C:\\a", source: "test" }), "C:\\a\u0000C:\\b");
});
