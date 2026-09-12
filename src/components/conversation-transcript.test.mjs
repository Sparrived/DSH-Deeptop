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
    forwardRef: (render) => (props) => render(props, null),
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

test("streaming assistant keeps one Markdown surface when animation is unavailable", async () => {
  const renderer = createHookRenderer();
  const { StreamingAssistantText } = await loadTranscriptExports(renderer.react);

  // Server/test environments have no animation frame API, so the component
  // must expose each complete prefix immediately through one Markdown surface.
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

test("entrance motion only follows newly appended transcript items", async () => {
  const renderer = createHookRenderer();
  const { appendedTranscriptKeys } = await loadTranscriptExports(renderer.react);
  const previous = new Set(["user-1", "stream-1"]);

  assert.deepEqual(
    appendedTranscriptKeys(previous, [{ key: "user-1" }, { key: "stream-1" }, { key: "tool-2" }]),
    ["tool-2"],
  );
  assert.deepEqual(
    appendedTranscriptKeys(previous, [{ key: "history-0" }, { key: "user-1" }, { key: "stream-1" }]),
    [],
  );
  assert.deepEqual(appendedTranscriptKeys(new Set(), [{ key: "first" }]), ["first"]);
  assert.deepEqual(appendedTranscriptKeys(previous, [{ key: "replacement" }]), []);
});

test("streaming text frames reveal bursts adaptively and preserve Unicode pairs", async () => {
  const renderer = createHookRenderer();
  const { nextStreamingTextFrame } = await loadTranscriptExports(renderer.react);

  assert.equal(nextStreamingTextFrame("", "abcd"), "ab");
  assert.equal(nextStreamingTextFrame("", "😀x"), "😀");
  assert.equal(nextStreamingTextFrame("old", "replacement"), "replacement");
  assert.equal(nextStreamingTextFrame("done", "done"), "done");

  const burst = "x".repeat(100);
  assert.equal(nextStreamingTextFrame("", burst).length, 52);
});

test("a pending line break makes the stream grow whole lines", async () => {
  const renderer = createHookRenderer();
  const { nextStreamingTextFrame, streamingTextFrameDelay } = await loadTranscriptExports(renderer.react);

  // Four pending lines: paint two, keep two for the smooth reveal.
  assert.equal(nextStreamingTextFrame("", "one\ntwo\nthree\nfour\n"), "one\ntwo\n");
  // With three pending lines one more whole line is painted.
  assert.equal(nextStreamingTextFrame("one\ntwo\n", "one\ntwo\nthree\nfour\nfive\n"), "one\ntwo\nthree\n");
  // The last two pending lines keep the character-by-character reveal.
  assert.equal(nextStreamingTextFrame("one\ntwo\nthree\n", "one\ntwo\nthree\nfour\nfive\n"), "one\ntwo\nthree\nfou");
  assert.equal(nextStreamingTextFrame("", "aa\nbb\n"), "aa");
  // A rewritten prefix is never half-applied.
  assert.equal(nextStreamingTextFrame("a\nb\nc\n", "restarted"), "restarted");

  // A multi-line burst paints more per frame, so it also paces faster; a
  // two-line tail still types smoothly at the normal cadence.
  const singleLine = streamingTextFrameDelay("", "still typing one line");
  assert.equal(streamingTextFrameDelay("", "aa\nbb\n"), singleLine);
  assert.ok(streamingTextFrameDelay("", "one\ntwo\nthree\nfour\n") < singleLine);
});

test("a live Think entry unfolds itself and folds back when the step ends", async () => {
  const renderer = createHookRenderer();
  const { ReasoningEntry } = await loadTranscriptExports(renderer.react);
  const text = "First reasoning line\nSecond reasoning line";

  // Thinking starts: the body is already open on the first paint, in its taller
  // running state, and shows the live label.
  let tree = renderer.render(ReasoningEntry, { text, streaming: true, locale: "en" });
  assert.equal(tree.props["data-state"], "running");
  assert.equal(tree.props.open, true);
  assert.ok(findElement(tree, "pre"));

  // A reader who collapses it keeps it collapsed while more thinking arrives.
  tree.props.onToggle({ currentTarget: { open: false } });
  tree = renderer.render(ReasoningEntry, { text: `${text}\nThird reasoning line`, streaming: true, locale: "en" });
  renderer.flushEffects();
  tree = renderer.render(ReasoningEntry, { text: `${text}\nThird reasoning line`, streaming: true, locale: "en" });
  assert.equal(tree.props.open, false);
  assert.equal(findElement(tree, "pre"), null);

  // The step ends: the entry folds back to the one-line chip by itself.
  tree = renderer.render(ReasoningEntry, { text, streaming: false, locale: "en" });
  renderer.flushEffects();
  tree = renderer.render(ReasoningEntry, { text, streaming: false, locale: "en" });
  assert.equal(tree.props["data-state"], "ok");
  assert.equal(tree.props.open, false);
  assert.equal(findElement(tree, "pre"), null);

  // A thinking step that is already finished at first paint stays folded.
  const fresh = createHookRenderer();
  const { ReasoningEntry: FreshEntry } = await loadTranscriptExports(fresh.react);
  const settled = fresh.render(FreshEntry, { text, streaming: false, locale: "en" });
  assert.equal(settled.props.open, false);
  assert.equal(findElement(settled, "pre"), null);
});
