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

function contextHarness({ put } = {}) {
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
          if (put) return put(args);
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
    listenerCount() { return sessionHandlers.size; },
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

test("keeps the Host's current value when an edit loses a version race", async () => {
  const current = item("message-1", "newer note", "version-9");
  const harness = contextHarness({
    put: async () => ({ ok: false, error: { code: "version-conflict", current } }),
  });
  const store = createMessageAnnotationStore(harness.context);
  harness.switchSession("session-1");
  await store.load("session-1", harness.context.session.generation);
  const notifications = [];
  store.subscribe(() => notifications.push(store.get("session-1")));

  await assert.rejects(
    store.put("session-1", "message-1", "stale edit", harness.context.session.generation),
    error => error.code === "version-conflict" && /version-conflict/.test(error.message),
  );
  assert.equal(store.get("session-1")["message-1"].note, "newer note");
  assert.equal(store.get("session-1")["message-1"].version, "version-9");
  assert.equal(notifications.length, 1, "the conflict refresh notifies the visible badge");
});

test("disposes its session listener and ignores later callbacks", async () => {
  const harness = contextHarness();
  const store = createMessageAnnotationStore(harness.context);
  assert.equal(harness.listenerCount(), 1);
  store.dispose();
  store.dispose();
  assert.equal(harness.listenerCount(), 0);
  harness.switchSession("session-1");
  assert.deepEqual(store.get("session-1"), {});
  await assert.rejects(store.put("session-1", "message-1", "after dispose", 2), /disposed/);
});
