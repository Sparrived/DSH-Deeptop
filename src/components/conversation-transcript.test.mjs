import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { buildPtcProgramView, readPtcDispatch } from "../app/ptc-program.ts";

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
    useLayoutEffect(effect, dependencies) {
      react.useEffect(effect, dependencies);
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

function findElementByClass(node, className) {
  if (!node || typeof node !== "object") return null;
  if (typeof node.props?.className === "string" && node.props.className.split(" ").includes(className)) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElementByClass(child, className);
      if (found) return found;
    }
    return null;
  }
  return findElementByClass(children, className);
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

async function loadModuleExports(react, entry) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
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

function loadTranscriptExports(react) {
  return loadModuleExports(react, "./ConversationTranscript.tsx");
}

test("the disclosure shell keeps its body mounted and animates by state", async () => {
  const renderer = createHookRenderer();
  const { DisclosureEntry } = await loadModuleExports(renderer.react, "./DisclosureEntry.tsx");
  const body = { type: "div", key: null, props: { className: "tool-parts", children: "body" } };
  const props = {
    base: "tool-entry",
    className: "tool-paired",
    open: false,
    onToggle: () => { toggles += 1; },
    summary: null,
    children: body,
    "data-tool-status": "returned",
  };
  let toggles = 0;

  let tree = renderer.render(DisclosureEntry, props);
  assert.equal(tree.props.className, "tool-entry tool-paired");
  assert.equal(tree.props["data-open"], "false");
  assert.equal(tree.props["data-tool-status"], "returned");
  // The body is always mounted, inside 折叠层 → 裁剪层, so the collapse has
  // something to animate and the text survives folding.
  assert.equal(findElementByClass(tree, "tool-entry-clip").props.children, body);
  assert.ok(findElementByClass(tree, "tool-entry-collapse"));
  const summary = findElement(tree, "button");
  assert.equal(summary.props.className, "tool-entry-summary");
  assert.equal(summary.props["aria-expanded"], false);
  summary.props.onClick();
  assert.equal(toggles, 1);

  tree = renderer.render(DisclosureEntry, { ...props, open: true });
  assert.equal(tree.props["data-open"], "true");
  assert.equal(findElement(tree, "button").props["aria-expanded"], true);
  // Attributes the entry does not carry stay off the root element.
  const injected = renderer.render(DisclosureEntry, { ...props, base: "injected-entry", className: undefined, "data-tool-status": undefined });
  assert.equal(injected.props.className, "injected-entry");
  assert.equal("data-tool-status" in injected.props, false);
});

test("folding a Think entry keeps one reasoning body surface", async () => {
  const renderer = createHookRenderer();
  const { ReasoningEntry } = await loadTranscriptExports(renderer.react);
  const props = { text: "First reasoning line\nSecond reasoning line", streaming: false, locale: "en" };

  let tree = renderer.render(ReasoningEntry, props);
  assert.equal(tree.props["data-open"], "false");
  const firstPre = findElement(tree, "pre");
  const firstBody = createPre();
  firstPre.props.ref(firstBody);
  renderer.flushEffects();
  assert.equal(firstBody.textContent, props.text);

  // Unfolding is a state change, not a remount: React keeps the same body ref,
  // so the incremental text node survives.
  findElement(tree, "button").props.onClick();
  tree = renderer.render(ReasoningEntry, props);
  assert.equal(tree.props["data-open"], "true");
  assert.equal(findElement(tree, "pre").props.ref, firstPre.props.ref);

  // Folding again keeps the body mounted with its text intact, so the collapse
  // can animate and the reasoning is never lost.
  findElement(tree, "button").props.onClick();
  tree = renderer.render(ReasoningEntry, props);
  assert.equal(tree.props["data-open"], "false");
  renderer.flushEffects();

  assert.equal(firstBody.textContent, props.text);
  assert.equal(firstBody.childNodes.length, 1);
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
  assert.equal(tree.props.children, undefined);
  // 渐显窗口跟着书写落点走，渲染容器得把它接出去。
  assert.equal(typeof tree.props.containerRef, "object");

  tree = renderer.render(StreamingAssistantText, { text: "first second", locale: "en" });
  assert.equal(tree.props.text, "first second");
  // 没有动画时不做收笔，类名保持稳定。
  assert.equal(tree.props.className, "message-text streaming-assistant-text");

  renderer.flushEffects();
  tree = renderer.render(StreamingAssistantText, { text: "first second\nthird line", locale: "en" });
  assert.equal(tree.props.text, "first second\nthird line");
  assert.equal(tree.props.className, "message-text streaming-assistant-text");

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
  const { nextStreamingTextFrame, streamingTextFrameDelay, lastInkIndex } = await loadTranscriptExports(renderer.react);

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

  // 渐显窗口的落点是最后一个有内容的字符：行尾空白不算，全空白时没有落点。
  assert.equal(lastInkIndex("typing"), 5);
  assert.equal(lastInkIndex("typing\n"), 5);
  assert.equal(lastInkIndex("typing \n  "), 5);
  assert.equal(lastInkIndex("\n\n  "), -1);
  assert.equal(lastInkIndex(""), -1);
});

test("a live Think entry unfolds itself and folds back when the step ends", async () => {
  const renderer = createHookRenderer();
  const { ReasoningEntry } = await loadTranscriptExports(renderer.react);
  const text = "First reasoning line\nSecond reasoning line";

  // Thinking starts: the body is already open on the first paint, in its taller
  // running state, and shows the live label.
  let tree = renderer.render(ReasoningEntry, { text, streaming: true, locale: "en" });
  assert.equal(tree.props["data-state"], "running");
  assert.equal(tree.props["data-open"], "true");

  // A reader who collapses it keeps it collapsed while more thinking arrives.
  findElement(tree, "button").props.onClick();
  tree = renderer.render(ReasoningEntry, { text: `${text}\nThird reasoning line`, streaming: true, locale: "en" });
  renderer.flushEffects();
  tree = renderer.render(ReasoningEntry, { text: `${text}\nThird reasoning line`, streaming: true, locale: "en" });
  assert.equal(tree.props["data-open"], "false");

  // Thinking stops: the entry folds back to the one-line chip by itself.
  tree = renderer.render(ReasoningEntry, { text, streaming: false, locale: "en" });
  renderer.flushEffects();
  tree = renderer.render(ReasoningEntry, { text, streaming: false, locale: "en" });
  assert.equal(tree.props["data-state"], "ok");
  assert.equal(tree.props["data-open"], "false");

  // A step that is already finished at first paint stays folded.
  const fresh = createHookRenderer();
  const { ReasoningEntry: FreshEntry } = await loadTranscriptExports(fresh.react);
  const settled = fresh.render(FreshEntry, { text, streaming: false, locale: "en" });
  assert.equal(settled.props["data-open"], "false");
});

function collectByClass(node, className, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectByClass(child, className, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (typeof node.props?.className === "string" && node.props.className.split(" ").includes(className)) out.push(node);
  collectByClass(node.props?.children, className, out);
  return out;
}

/** PTC 执行视图的测试夹具：一次循环外的 bash、一次失败的 read、一次定位不到的动态调用。 */
const PTC_CODE = [
  "const listing = await tools.bash({ command: 'ls' })",
  "return [listing, await tools.read({ file_path: 'missing.txt' })]",
].join("\n");

function ptcProgram(programFailed = false) {
  const dispatch = (settle) => (time, subCallId, name, args, text = "ok", error = false) => ({
    type: settle ? "tool/ptc-dispatch" : "tool/ptc-dispatch-start",
    seq: time,
    time,
    data: {
      rootCallId: "call-1",
      parentCallId: "call-1",
      subCallId,
      name,
      arguments: args,
      ...(settle ? { isError: error, content: [{ type: "text", text }] } : {}),
    },
  });
  const started = dispatch(false);
  const settled = dispatch(true);
  const events = [
    started(1_000, "call-1:ptc:1", "bash", { command: "ls" }),
    settled(1_200, "call-1:ptc:1", "bash", { command: "ls" }, "demo.txt"),
    started(1_300, "call-1:ptc:2", "read", { file_path: "missing.txt" }),
    settled(1_400, "call-1:ptc:2", "read", { file_path: "missing.txt" }, "Error: not found", true),
    started(1_500, "call-1:ptc:3", "mystery", { n: 1 }),
    settled(1_600, "call-1:ptc:3", "mystery", { n: 1 }, "ok"),
  ];
  return buildPtcProgramView(
    JSON.stringify({ code: PTC_CODE, description: "列目录并读取" }),
    events.map((event) => readPtcDispatch(event)),
    "zh",
    programFailed,
  );
}

test("PTC execution view keeps its panes out of the DOM while the card is folded", async () => {
  const renderer = createHookRenderer();
  const { PtcProgramView } = await loadModuleExports(renderer.react, "./PtcProgramView.tsx");

  const closed = renderer.render(PtcProgramView, { program: ptcProgram(), locale: "zh", open: false });
  assert.equal(closed, null);

  const open = renderer.render(PtcProgramView, { program: ptcProgram(), locale: "zh", open: true });
  assert.equal(findElementByClass(open, "ptc-program").props["data-has-program"], "true");
  assert.equal(findElementByClass(open, "ptc-pane-program") !== null, true);
  assert.equal(findElementByClass(open, "ptc-pane-trace") !== null, true);
});

test("PTC call-site marks share their numbering with the execution rows", async () => {
  const renderer = createHookRenderer();
  const { PtcProgramView } = await loadModuleExports(renderer.react, "./PtcProgramView.tsx");
  const program = ptcProgram();

  const tree = renderer.render(PtcProgramView, { program, locale: "zh", open: true });

  // Two of the three calls have a source call site; the dynamically named one has none.
  const lines = collectByClass(tree, "ptc-line");
  assert.equal(lines.length, PTC_CODE.split("\n").length);
  assert.deepEqual(lines.map((line) => line.props["data-anchored"] ?? "false"), ["true", "true"]);
  const marks = collectByClass(tree, "ptc-mark");
  assert.deepEqual(marks.map((mark) => mark.props.children), [1, 2]);
  assert.deepEqual(marks.map((mark) => mark.props["data-state"]), ["ok", "error"]);

  const rows = collectByClass(tree, "ptc-call-row");
  assert.deepEqual(rows.map((row) => row.props["aria-expanded"]), [false, false, false]);
  // 顺序与源码调用位点一致：程序里先 bash 后 read，执行栏也如此。
  assert.deepEqual(collectByClass(tree, "ptc-call-index").map((cell) => cell.props.children), [1, 2, 3]);
  // 三次调用彼此不重叠，因此没有并行标记。
  assert.equal(collectByClass(tree, "ptc-call-parallel").length, 0);
  // 未定位与「程序捕获了失败」各一条脚注。
  assert.equal(collectByClass(tree, "ptc-note").length, 2);
});

test("expanding one PTC trace row reveals only that call's arguments and result", async () => {
  const renderer = createHookRenderer();
  const { PtcProgramView } = await loadModuleExports(renderer.react, "./PtcProgramView.tsx");

  let tree = renderer.render(PtcProgramView, { program: ptcProgram(), locale: "zh", open: true });
  collectByClass(tree, "ptc-call-row")[1].props.onClick();
  tree = renderer.render(PtcProgramView, { program: ptcProgram(), locale: "zh", open: true });

  const rows = collectByClass(tree, "ptc-call-row");
  assert.deepEqual(rows.map((row) => row.props["aria-expanded"]), [false, true, false]);
  const detail = collectByClass(tree, "ptc-call-detail");
  assert.equal(detail.length, 1);
  // 失败调用的结果分区带着错误修饰符，程序成功的整体状态不因此改变。
  assert.equal(collectByClass(detail[0], "ptc-call-block").some((block) => block.props.className.includes("error")), true);
});

test("the folded PTC row reports calls, failures and wall time, omitting what does not exist", async () => {
  const renderer = createHookRenderer();
  const { programStatsText } = await loadTranscriptExports(renderer.react);

  // 三次调用顺序发生（无并行）、一次失败、跨度 600ms。
  assert.equal(programStatsText(ptcProgram(), "zh"), "3 次调用 · 1 次失败 · 600 ms");
  assert.equal(programStatsText(ptcProgram(), "en"), "3 calls · 1 failed · 600 ms");
  // 外层程序自己失败时，内部失败就不再是「被捕获」的，脚注不计。
  assert.equal(ptcProgram(true).caughtFailures, 0);
});

test("the folded PTC row shows the in-flight call and its progress while the program runs", async () => {
  const renderer = createHookRenderer();
  const { programTickerText } = await loadTranscriptExports(renderer.react);
  const running = buildPtcProgramView(
    JSON.stringify({ code: "await tools.bash({ command: 'ls notes' })", description: "列目录" }),
    [readPtcDispatch({
      type: "tool/ptc-dispatch-start",
      seq: 1,
      time: 1_000,
      data: { rootCallId: "call-1", parentCallId: "call-1", subCallId: "call-1:ptc:1", name: "bash", arguments: { command: "ls notes" } },
    })],
    "zh",
  );

  assert.equal(programTickerText(running, "zh"), "bash · ls notes · 0/1");
  assert.equal(running.active.line, 1);
});

function collectByType(node, type, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectByType(child, type, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (node.type === type) out.push(node);
  collectByType(node.props?.children, type, out);
  return out;
}

test("ask_user_question shows the asked questions and their options", async () => {
  const renderer = createHookRenderer();
  const { QuestionListField } = await loadModuleExports(renderer.react, "../app/tool-args-render.tsx");

  const tree = renderer.render(QuestionListField, {
    locale: "zh",
    questions: [
      {
        id: "release",
        header: "发布渠道",
        question: "选择发布渠道",
        multiSelect: true,
        options: [{ label: "GitHub", description: "公开可见" }, { label: "内测" }],
      },
      { id: "confirm", question: "确认继续？" },
    ],
  });

  // 问题原文是这次调用唯一的事实，必须逐条出现在卡片里。
  assert.deepEqual(collectByClass(tree, "tool-question-prompt").map((node) => node.props.children), ["选择发布渠道", "确认继续？"]);
  // 标题取 header，缺失时退回稳定的 id。
  assert.deepEqual(collectByClass(tree, "tool-question-title").map((node) => node.props.children), ["发布渠道", "confirm"]);
  assert.deepEqual(
    collectByClass(tree, "tool-question-option").flatMap((option) => collectByType(option, "strong").map((node) => node.props.children)),
    ["GitHub", "内测"],
  );
  // 选项说明与多选标记各自可见。
  assert.deepEqual(
    collectByClass(tree, "tool-question-option-copy").flatMap((copy) => collectByType(copy, "small").map((node) => node.props.children)),
    ["公开可见"],
  );
  assert.deepEqual(collectByClass(tree, "tool-question-mode").map((node) => node.props.children), ["多选"]);
});

const READ_IMAGE_ENVELOPE = [
  "<path>shots/card.png</path>",
  "<type>image</type>",
  "<content>",
  "image/png image, 320x200 px, 4096 bytes",
  "</content>",
].join("\n");

function readImageRowProps(overrides = {}) {
  return {
    item: {
      key: "event-3",
      kind: "tool",
      label: "read_image",
      text: JSON.stringify({ file_path: "shots/card.png" }),
      toolName: "read_image",
      toolCallId: "call-1",
      toolState: "result",
      toolResultText: READ_IMAGE_ENVELOPE,
      images: [{ mediaType: "image/png", attachmentId: "attachment-1", name: "card.png" }],
    },
    diff: undefined,
    hasToolResult: true,
    toolStatus: "returned",
    locale: "zh",
    onOpenUrl: async () => {},
    onOpenPath: async () => {},
    onPreviewImage: () => {},
    onLoadImageAttachment: async () => "data:image/png;base64,AAAA",
    ...overrides,
  };
}

test("a read_image row renders the returned image inside its result part", async () => {
  const renderer = createHookRenderer();
  const { ToolEntryView } = await loadTranscriptExports(renderer.react);
  const props = readImageRowProps();

  let tree = renderer.render(ToolEntryView, props);

  // 图片挂在结果分区里，经会话附件加载器解析（源文件可能已经被删掉），点击放大
  // 复用消息图片同一个画廊回调。
  const gallery = collectByClass(tree, "tool-result-images");
  assert.equal(gallery.length, 1);
  assert.deepEqual(gallery[0].props.children.props.images, props.item.images);
  assert.equal(gallery[0].props.children.props.onLoadAttachment, props.onLoadImageAttachment);
  assert.equal(gallery[0].props.children.props.onOpen, props.onPreviewImage);
  // 模型信封换成一行路径与尺寸，而不是把 XML 当正文显示。
  assert.equal(findElementByClass(tree, "tool-result-image-path").props.children, "shots/card.png");
  assert.equal(collectByClass(tree, "tool-result-image-note").length, 1);

  // 「查看原文」保留完整信封；图片不因此消失。
  const rawToggles = collectByClass(tree, "tool-raw-toggle");
  assert.equal(rawToggles.length, 2);
  rawToggles[1].props.onClick();
  tree = renderer.render(ToolEntryView, props);
  assert.equal(collectByClass(tree, "tool-result-image-note").length, 0);
  assert.equal(collectByClass(tree, "tool-result-images").length, 1);
});

test("a result whose images carry unrecognised text keeps the generic result view", async () => {
  const renderer = createHookRenderer();
  const { ToolEntryView } = await loadTranscriptExports(renderer.react);
  const props = readImageRowProps({
    item: { ...readImageRowProps().item, toolResultText: "not the image envelope" },
  });

  const tree = renderer.render(ToolEntryView, props);

  // 信封没识别出来时结果文本原样交给通用视图，不能被悄悄藏起来。
  assert.equal(collectByClass(tree, "tool-result-image-note").length, 0);
  assert.equal(collectByClass(tree, "tool-result-images").length, 1);
  assert.equal(collectByProp(tree, "text", "not the image envelope").length, 1);
});

function collectByProp(node, key, value, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectByProp(child, key, value, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (node.props?.[key] === value) out.push(node);
  collectByProp(node.props?.children, key, value, out);
  return out;
}
