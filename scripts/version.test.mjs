import assert from "node:assert/strict";
import test from "node:test";
import { preserveLineEndings } from "./version.mjs";

test("keeps the checkout's line endings when rewriting a manifest", () => {
  // A CRLF checkout must not be rewritten as LF: git would then report a
  // content-identical file as modified after every version:set.
  assert.equal(
    preserveLineEndings('{\n  "version": "0.2.0"\n}\n', '{\r\n  "version": "0.2.0"\r\n}\r\n'),
    '{\r\n  "version": "0.2.0"\r\n}\r\n',
  );
  assert.equal(
    preserveLineEndings('{\n  "version": "0.2.0"\n}\n', '{\n  "version": "0.2.0"\n}\n'),
    '{\n  "version": "0.2.0"\n}\n',
  );
});

test("does not accumulate carriage returns on already-CRLF content", () => {
  // Cargo.toml and Cargo.lock are read back before editing, so their content
  // already carries the checkout's endings by the time it reaches the writer.
  assert.equal(
    preserveLineEndings('version = "0.2.0"\r\n', 'version = "0.1.0"\r\n'),
    'version = "0.2.0"\r\n',
  );
});

test("falls back to LF for a new or newline-free file", () => {
  assert.equal(preserveLineEndings('{\n}\n', ""), '{\n}\n');
  assert.equal(preserveLineEndings('{}\n', "{}"), '{}\n');
});
