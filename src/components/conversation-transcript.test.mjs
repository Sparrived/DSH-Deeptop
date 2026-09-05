import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

function dependenciesMatch(left, right) {
  return left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
}

function createHookRenderer() {
  const hooks = [];
  let hookIndex = 0;
  let pendingEffects = [];

  const react = {
    Component: class {},
    memo: (component) => component,
    useState(initial) {
      const index = hookIndex++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, (next) => {
        hooks[index].value = typeof next === "function" ? next(hooks[index].value) : next;
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!hooks[index]) hooks[index] = { current: initial };
      return hooks[index];
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
    useEffect(effect, dependencies) {
      const index = hookIndex++;
      const previous = hooks[index];
      if (!previous || !dependenciesMatch(previous.dependencies, dependencies)) pendingEffects.push(effect);
      hooks[index] = { dependencies };
    },
  };

  return {
    react,
    render(Component, props) {
      hookIndex = 0;
      pendingEffects = [];
      return Component(props);
    },
    flushEffects() {
      for (const effect of pendingEffects) effect();
      pendingEffects = [];
    },
  };
}

function jsx(type, props, key) {
  return { type, key, props: props ?? {} };
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

function createPre() {
  let nodes = [];
  const createTextNode = (value) => ({
    nodeType: 3,
    data: value,
    appendData(delta) { this.data += delta; },
  });
  return {
    ownerDocument: { createTextNode },
    get firstChild() { return nodes[0] ?? null; },
    get childNodes() { return nodes; },
    get textContent() { return nodes.map((node) => node.data ?? "").join(""); },
    set textContent(value) { nodes = [createTextNode(value)]; },
    replaceChildren(...children) { nodes = children; },
    appendChild(node) { nodes.push(node); return node; },
  };
}

async function loadTranscriptExports(react) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./ConversationTranscript.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react", "react-dom", "react/jsx-runtime"],
    loader: { ".css": "empty" },
  });
  const module = { exports: {} };
  const requireFromTest = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((id) => {
    if (id === "react") return react;
    if (id === "react-dom") return { createPortal: (children) => children };
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol.for("react.fragment") };
    return requireFromTest(id);
  }, module, module.exports);
  return module.exports;
}

test("reopening a Think entry restores the full reasoning body", async () => {
  const renderer = createHookRenderer();
  const { ReasoningEntry } = await loadTranscriptExports(renderer.react);
  const props = { text: "First reasoning line\nSecond reasoning line", streaming: false, locale: "en" };

  let tree = renderer.render(ReasoningEntry, props);
  tree.props.onToggle({ currentTarget: { open: true } });
  tree = renderer.render(ReasoningEntry, props);
  const firstPre = findElement(tree, "pre");
  const firstBody = createPre();
  firstPre.props.ref(firstBody);
  renderer.flushEffects();
  assert.equal(firstBody.textContent, props.text);

  tree.props.onToggle({ currentTarget: { open: false } });
  tree = renderer.render(ReasoningEntry, props);
  firstPre.props.ref(null);
  renderer.flushEffects();
  assert.equal(findElement(tree, "pre"), null);

  tree.props.onToggle({ currentTarget: { open: true } });
  tree = renderer.render(ReasoningEntry, props);
  const reopenedPre = findElement(tree, "pre");
  const reopenedBody = createPre();
  reopenedPre.props.ref(reopenedBody);
  renderer.flushEffects();

  assert.equal(reopenedBody.textContent, props.text);
  assert.equal(reopenedBody.childNodes.length, 1);
});

test("streaming assistant renders every growing text frame through one Markdown surface", async () => {
  const renderer = createHookRenderer();
  const { StreamingAssistantText } = await loadTranscriptExports(renderer.react);

  // Streaming now re-parses the growing response as Markdown on each frame
  // (incomplete fences/lists are rendered readably); the component must stay a
  // single declarative Markdown surface instead of appending raw text nodes.
  let tree = renderer.render(StreamingAssistantText, { text: "first", locale: "en" });
  assert.equal(tree.props.text, "first");
  assert.equal(tree.props.className, "message-text streaming-assistant-text");
  assert.equal(tree.props.locale, "en");
  assert.equal(typeof tree.props.ref, "undefined");
  assert.equal(tree.props.children, undefined);

  tree = renderer.render(StreamingAssistantText, { text: "first second", locale: "en" });
  assert.equal(tree.props.text, "first second");
  assert.equal(tree.props.className, "message-text streaming-assistant-text");

  tree = renderer.render(StreamingAssistantText, { text: "first second third", locale: "en" });
  assert.equal(tree.props.text, "first second third");

  // A reset frame must reach the same single Markdown surface.
  tree = renderer.render(StreamingAssistantText, { text: "reset", locale: "en" });
  assert.equal(tree.props.text, "reset");
});
