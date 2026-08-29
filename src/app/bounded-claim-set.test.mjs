import assert from "node:assert/strict";
import test from "node:test";
import { BoundedClaimSet } from "./bounded-claim-set.ts";

test("rejects duplicate claims and allows retry after release", () => {
  const claims = new BoundedClaimSet(3);
  assert.equal(claims.claim("rpc-1"), true);
  assert.equal(claims.claim("rpc-1"), false);
  claims.release("rpc-1");
  assert.equal(claims.claim("rpc-1"), true);
});

test("evicts the oldest successful claim at the fixed bound", () => {
  const claims = new BoundedClaimSet(2);
  claims.claim("rpc-1");
  claims.claim("rpc-2");
  claims.claim("rpc-3");
  assert.equal(claims.size, 2);
  assert.equal(claims.has("rpc-1"), false);
  assert.equal(claims.has("rpc-2"), true);
  assert.equal(claims.has("rpc-3"), true);
});
