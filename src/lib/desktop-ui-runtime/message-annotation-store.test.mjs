import assert from "node:assert/strict";
import test from "node:test";
import { createMessageAnnotationStore } from "./message-annotation-store.ts";

const item = (messageId, note, version = "version-1") => ({
  messageId,
  note,
  version,
  createdAt: 1,
  updatedAt: 1,
});

function contextHarness() {
  const sessionHandlers = new Set();
  let generation = 1;
  const lists = new Map([["session-1", [item("message-1", "old")]], ["session-2", []]]);
  let pendingPutResolve = null;
  const context = {
    locale: "en",
    logger: { warn: () => undefined },
    session: {
      get generation() { return generation; },
      onChange(handler) {
        sessionHandlers.add(handler);
        return () => { sessionHandlers.delete(handler); };
      },
    },
    remote: {
      invokeIn: async (_namespace, method, args) => {
        if (method === "list") return { ok: true, value: { items: lists.get(args.sessionId) ?? [] } };
        if (method === "put") {
          return await new Promise((resolve) => { pendingPutResolve = () => resolve({ ok: true, value: item(args.messageId, args.note, "version-2") }); });
        }
        return { ok: true, value: { absent: true } };
      },
    },
  };
  return {
    context,
    switchSession(sessionId) {
      generation += 1;
      const session = { sessionId, title: sessionId, running: false, blank: false };
      for (const handler of sessionHandlers) handler(session);
    },
    resolvePut() { pendingPutResolve?.(); },
  };
}

test("loads per-session values and ignores a late write after session switch", async () => {
  const harness = contextHarness();
  const store = createMessageAnnotationStore(harness.context);
  harness.switchSession("session-1");
  await Promise.resolve();
  assert.equal(store.get("session-1")["message-1"]?.note, "old");

  const pending = store.put("session-1", "message-2", "late", harness.context.session.generation);
  harness.switchSession("session-2");
  await store.load("session-2", harness.context.session.generation);
  harness.resolvePut();
  const result = await pending;
  assert.equal(result.switched, true);
  assert.equal(store.get("session-1")["message-2"], undefined);
  assert.deepEqual(store.get("session-2"), {});
});
