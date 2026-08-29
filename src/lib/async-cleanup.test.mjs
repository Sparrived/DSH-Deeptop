import assert from "node:assert/strict";
import test from "node:test";
import { trackAsyncCleanup } from "./async-cleanup.ts";

test("runs a cleanup that resolves after its owner was disposed", async () => {
  let resolveRegistration;
  const registration = new Promise((resolve) => { resolveRegistration = resolve; });
  const cleanups = [];
  let disposed = false;
  let cleaned = 0;
  trackAsyncCleanup(cleanups, registration, () => disposed);
  disposed = true;
  resolveRegistration(() => { cleaned += 1; });
  await registration;
  await Promise.resolve();
  assert.equal(cleaned, 1);
  assert.equal(cleanups.length, 0);
});

test("tracks a live cleanup once and invokes its registration callback", async () => {
  const cleanups = [];
  let registered = 0;
  const cleanup = () => undefined;
  const registration = Promise.resolve(cleanup);
  trackAsyncCleanup(cleanups, registration, () => false, () => { registered += 1; });
  await registration;
  await Promise.resolve();
  assert.deepEqual(cleanups, [cleanup]);
  assert.equal(registered, 1);
});
