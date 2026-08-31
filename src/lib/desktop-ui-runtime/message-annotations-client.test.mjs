import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { DesktopUiRuntime } from "./client-runtime.ts";

function dependenciesMatch(left, right) {
  return left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createHookRenderer() {
  const hooks = [];
  let hookIndex = 0;
  let pendingEffects = [];
  const cleanups = [];

  const react = {
    useState(initial) {
      const index = hookIndex++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, (next) => {
        hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next;
      }];
    },
    useEffect(effect, dependencies) {
      const index = hookIndex++;
      const previous = hooks[index];
      if (!previous || !dependenciesMatch(previous.dependencies, dependencies)) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          const cleanup = effect();
          hooks[index] = { dependencies, cleanup };
          if (cleanup) cleanups.push(cleanup);
        });
      }
      hooks[index] = { ...(hooks[index] ?? {}), dependencies };
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot = getSnapshot) {
      const [snapshot, setSnapshot] = react.useState(() => getServerSnapshot());
      react.useEffect(() => {
        const check = () => {
          const next = getSnapshot();
          setSnapshot((current) => Object.is(current, next) ? current : next);
        };
        const cleanup = subscribe(check);
        // React checks once after subscribing so a store update between render
        // and the passive effect cannot be lost.
        check();
        return cleanup;
      }, [subscribe, getSnapshot]);
      return snapshot;
    },
    useMemo(factory, dependencies) {
      const index = hookIndex++;
      const previous = hooks[index];
      if (previous && dependenciesMatch(previous.dependencies, dependencies)) return previous.value;
      const value = factory();
      hooks[index] = { value, dependencies };
      return value;
    },
    useCallback(callback, dependencies) {
      return react.useMemo(() => callback, dependencies);
    },
  };

  return {
    react,
    render(Component, props, { flushEffects = true } = {}) {
      hookIndex = 0;
      pendingEffects = [];
      const tree = Component(props);
      if (flushEffects) this.flushEffects();
      return tree;
    },
    flushEffects() {
      const effects = pendingEffects;
      pendingEffects = [];
      for (const effect of effects) effect();
    },
    dispose() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
}

function jsx(type, props, key) {
  return { type, key, props: props ?? {} };
}

function renderTree(renderer, node, { flushEffects = true } = {}) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return renderTree(renderer, renderer.render(node.type, node.props, { flushEffects }), { flushEffects });
  return node;
}

function findElement(node, type) {
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  return findElement(children, type);
}

async function loadClientModule(react) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./message-annotations-client.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react", "react/jsx-runtime"],
  });
  const module = { exports: {} };
  const requireFromTest = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol.for("react.fragment") };
    return requireFromTest(id);
  }, module, module.exports);
  return module.exports;
}

function descriptor() {
  return {
    pluginId: "deeptop.message-annotations",
    version: "0.1.0",
    displayName: "Message annotations",
    status: "available",
    client: { entryId: "deeptop.message-annotations/client", format: "esm", sdkVersion: "^1.0.0" },
    slots: ["conversation.message.actions"],
    capabilities: { remotes: [{ namespace: "messageAnnotations", methods: ["list", "put", "delete"] }] },
    contributions: [],
  };
}

function item(messageId, note, version = "version-1") {
  return { messageId, note, version, createdAt: 1, updatedAt: 1 };
}

function createHarness(module) {
  const sessionHandlers = new Set();
  const notifications = [];
  const prompts = [];
  const calls = [];
  let listItems = [item("message-1", "existing")];
  let listGate = null;
  const session = { sessionId: "session-1", title: "Session one", running: false, blank: false };
  const runtime = new DesktopUiRuntime({
    request: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "ui.plugin.list") return { items: [descriptor()] };
      if (method === "ui.plugin.invoke") {
        if (payload.method === "list") {
          const pendingList = listGate;
          listGate = null;
          if (pendingList) await pendingList.promise;
          return { value: { ok: true, value: { items: listItems } } };
        }
        if (payload.method === "put") return { value: { ok: true, value: item(payload.args.messageId, payload.args.note, "version-2") } };
        if (payload.method === "delete") return { value: { ok: true, value: { absent: true } } };
      }
      throw new Error(`unexpected request: ${method}`);
    },
    listen: () => () => undefined,
    bundledModules: { "deeptop.message-annotations/client": async () => module },
    locale: "en",
    hostActions: {
      prompt: async (request) => {
        prompts.push(request);
        return "added from test";
      },
      notify: (message, kind) => notifications.push({ message, kind }),
    },
  });
  const originalOnSessionChange = runtime.onSessionChange.bind(runtime);
  const updateSession = runtime.updateSession.bind(runtime);
  // Keep the runtime as the source of truth while exposing a compact signal
  // for assertions that the plugin's session subscription is removed on stop.
  runtime.onSessionChange = (handler) => {
    sessionHandlers.add(handler);
    const dispose = originalOnSessionChange(handler);
    return () => {
      sessionHandlers.delete(handler);
      dispose();
    };
  };
  return {
    runtime,
    session,
    updateSession,
    sessionHandlers,
    notifications,
    prompts,
    calls,
    setListItems: (items) => { listItems = items; },
    setListGate: (gate) => { listGate = gate; },
  };
}

test("activates the message annotation client, renders action and badge, and removes both on stop", async () => {
  const renderer = createHookRenderer();
  const module = await loadClientModule(renderer.react);
  const harness = createHarness(module);
  await harness.runtime.start();
  harness.updateSession(harness.session);
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();

  const context = {
    session: harness.session,
    activeSessionId: harness.session.sessionId,
    sessionGeneration: harness.runtime.sessionGeneration,
    locale: "en",
    host: harness.runtime["hostActions"],
    message: { sessionId: "session-1", messageId: "message-1", role: "assistant", seq: 1 },
  };
  const entries = harness.runtime.slots.snapshot("conversation.message.actions");
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.contributionId]), [
    ["badge", "message-annotations.note"],
    ["action", "message-annotations.edit"],
  ]);

  const badge = renderTree(renderer, entries[0].render(context));
  assert.equal(badge.type, "span");
  assert.equal(badge.props.className, "message-annotation");
  assert.equal(badge.props.children[1], "existing");

  const action = renderTree(renderer, entries[1].render(context));
  assert.equal(action.type, "button");
  assert.equal(action.props.children, "Edit note");
  await action.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.prompts.length, 1);
  assert.equal(harness.calls.at(-1).payload.method, "put");
  assert.equal(harness.calls.at(-1).payload.args.note, "added from test");
  assert.equal(harness.notifications.at(-1).message, "Message note updated");

  await harness.runtime.stop();
  assert.equal(harness.runtime.slots.snapshot("conversation.message.actions").length, 0);
  assert.equal(harness.sessionHandlers.size, 0, "plugin session listener is removed with its scope");
});

test("a mounted Badge catches a list completion between render and subscription", async () => {
  const renderer = createHookRenderer();
  const module = await loadClientModule(renderer.react);
  const harness = createHarness(module);
  const listGate = deferred();
  harness.setListGate(listGate);
  await harness.runtime.start();
  harness.updateSession(harness.session);
  await Promise.resolve();

  const badgeEntry = harness.runtime.slots.snapshot("conversation.message.actions").find((entry) => entry.kind === "badge");
  const context = {
    session: harness.session,
    activeSessionId: harness.session.sessionId,
    sessionGeneration: harness.runtime.sessionGeneration,
    locale: "en",
    host: harness.runtime["hostActions"],
    message: { sessionId: "session-1", messageId: "message-1", role: "assistant", seq: 1 },
  };
  const mountedBadge = badgeEntry.render(context);
  assert.equal(renderTree(renderer, mountedBadge, { flushEffects: false }), null, "the pending list has no snapshot yet");

  listGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
  // The list notify happened before useEffect could subscribe. React's
  // useSyncExternalStore post-subscribe check must make that update visible.
  renderer.flushEffects();
  const rerenderedBadge = renderTree(renderer, mountedBadge, { flushEffects: false });
  assert.equal(rerenderedBadge?.type, "span");
  assert.equal(rerenderedBadge?.props.children[1], "existing");

  renderer.dispose();
  await harness.runtime.stop();
});

test("cancelling the annotation prompt does not invoke the Host or show a save notification", async () => {
  const renderer = createHookRenderer();
  const module = await loadClientModule(renderer.react);
  const harness = createHarness(module);
  harness.runtime["hostActions"].prompt = async () => null;
  await harness.runtime.start();
  harness.updateSession(harness.session);
  await Promise.resolve();
  await Promise.resolve();

  const actionEntry = harness.runtime.slots.snapshot("conversation.message.actions").find((entry) => entry.kind === "action");
  const context = {
    session: harness.session,
    activeSessionId: harness.session.sessionId,
    sessionGeneration: harness.runtime.sessionGeneration,
    locale: "en",
    host: harness.runtime["hostActions"],
    message: { sessionId: "session-1", messageId: "message-2", role: "user" },
  };
  const action = renderTree(renderer, actionEntry.render(context));
  const invokeCount = harness.calls.filter((call) => call.method === "ui.plugin.invoke").length;
  await action.props.onClick();
  assert.equal(harness.calls.filter((call) => call.method === "ui.plugin.invoke").length, invokeCount);
  assert.equal(harness.notifications.some(({ message }) => message === "Saving the message note…"), false);
  await harness.runtime.stop();
});
