// 发送方式的可见性检查：空闲会话没有排队/插入可选，运行中的发送按钮直接显示
// 本次投递方式，箭头在按钮右侧的上拉菜单；待处理消息按排队/插入分色标注。
// 轻量 hooks 渲染器与 stats-pills.test.mjs 相同：直接调用组件函数，
// 在没有 DOM 的环境里检查返回的元素树。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// 组件只在 effect/回调里访问 DOM，测试不驱动它们；这里只需一个占位目标。
globalThis.document = { body: {} };

function dependenciesMatch(left, right) {
  return left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
}

function createHookRenderer() {
  const hooks = [];
  let hookIndex = 0;

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
    useId: () => "test-id",
    // 测试不驱动 effect：外部点击/Escape 关闭与测量定位不属于本次断言范围。
    useEffect() {},
    useLayoutEffect() {},
  };

  return {
    react,
    render(Component, props) {
      hookIndex = 0;
      return Component(props);
    },
  };
}

function jsx(type, props, key) {
  return { type, key, props: props ?? {} };
}

// 图标在本测试里只是占位元素类型；Proxy 让任意具名图标都能按名解析。
const LUCIDE_STUBS = new Proxy({}, { get: (_target, name) => String(name) });

function collectElements(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  collectElements(node.props?.children, predicate, found);
  return found;
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node === null || node === undefined || typeof node !== "object") return String(node ?? "");
  return textOf(node.props?.children);
}

async function loadModule(react, entry) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
    loader: { ".css": "empty" },
  });
  const module = { exports: {} };
  const requireFromTest = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((id) => {
    if (id === "react") return react;
    if (id === "react-dom") return { createPortal: (children) => children };
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol.for("react.fragment") };
    if (id === "lucide-react") return LUCIDE_STUBS;
    return requireFromTest(id);
  }, module, module.exports);
  return module.exports;
}

const composerProps = {
  runtimeAvailable: true,
  activeRunning: false,
  activeSessionId: "session-1",
  defaultModelName: "gpt-5",
  loading: false,
  composer: "草稿",
  attachments: [],
  promptMode: "queue",
  candidates: [],
  candidatesDismissed: true,
  activeCandidateIndex: 0,
  models: null,
  modelMenuRef: { current: null },
  composerRef: { current: null },
  selectedModelValue: "gpt-5",
  reasoningChoices: [],
  modelMenuOpen: false,
  modelMenuPane: "models",
  sessionStats: {},
  sessionRunningMs: 0,
  sendShortcut: "Enter",
  onExitPlan() {},
  locale: "zh",
  onComposerChange() {},
  onPaste() {},
  onAddFiles() {},
  onRemoveAttachment() {},
  permissions: null,
  onSetPermission() {},
  onSetPromptMode() {},
  onChooseCandidate() {},
  onSetCandidateIndex() {},
  onDismissCandidates() {},
  onAction() {},
  onCancel() {},
  onToggleModelMenu() {},
  onSetModelPane() {},
  onChangeModel() {},
  onChangeReasoningEffort() {},
};

const byClass = (tree, className) => collectElements(tree, (node) => node.props?.className === className)[0];
const sendButton = (tree) => byClass(tree, "send-button");
const modeLabel = (tree) => byClass(tree, "send-button-mode-label");

function modePicker(tree) {
  return collectElements(tree, (node) => node.props?.className?.startsWith("mode-picker") === true);
}

test("hides the send-mode choice while the session is idle", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  for (const promptMode of ["queue", "steer"]) {
    const tree = renderer.render(ComposerShell, { ...composerProps, promptMode });
    // 空闲会话没有可投递的回合，resolveSubmitMode 只会排队，因此不给选择。
    assert.deepEqual(modePicker(tree), []);
    assert.equal(modeLabel(tree), undefined);
    assert.equal(sendButton(tree).props["aria-label"], "发送消息");
  }

  // 空闲时偏好仍是插入，也不该在按钮上声称插入。
  const tree = renderer.render(ComposerShell, { ...composerProps, promptMode: "steer" });
  assert.deepEqual(modePicker(tree), []);
});

test("labels the send button with the resolved delivery during a turn", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const queueTree = renderer.render(ComposerShell, { ...composerProps, activeRunning: true, promptMode: "queue" });
  assert.equal(textOf(modeLabel(queueTree)), "排队");
  assert.equal(sendButton(queueTree).props["aria-label"], "排队");

  const steerTree = renderer.render(ComposerShell, { ...composerProps, activeRunning: true, promptMode: "steer" });
  assert.equal(textOf(modeLabel(steerTree)), "插入");
  assert.equal(sendButton(steerTree).props["aria-label"], "插入");
});

test("keeps the delivery state and picker visible for the whole turn", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  // 空草稿也要显示状态，否则用户在输入前既看不到、也改不了投递方式。
  const tree = renderer.render(ComposerShell, { ...composerProps, activeRunning: true, composer: "", promptMode: "steer" });
  assert.equal(textOf(modeLabel(tree)), "插入");
  assert.equal(sendButton(tree).props.disabled, true);
  assert.equal(byClass(tree, "mode-picker-trigger").props.disabled, undefined);
});

test("keeps the mode choice off a slash command line", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const tree = renderer.render(ComposerShell, { ...composerProps, activeRunning: true, composer: "/help" });
  // 命令行执行命令而不是投递消息，按钮不声称排队或插入。
  assert.equal(modeLabel(tree), undefined);
  assert.equal(sendButton(tree).props["aria-label"], "发送消息");
  assert.deepEqual(modePicker(tree), []);
});

test("opens the delivery menu upward and records the picked mode", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const props = { ...composerProps, activeRunning: true };
  const picked = [];
  let tree = renderer.render(ComposerShell, { ...props, onSetPromptMode: (mode) => picked.push(mode) });

  const trigger = byClass(tree, "mode-picker-trigger");
  assert.equal(trigger.props["aria-haspopup"], "menu");
  assert.equal(trigger.props["aria-expanded"], false);
  // 上拉：箭头朝上。
  assert.equal(trigger.props.children.type, "ChevronUp");

  trigger.props.onClick();
  tree = renderer.render(ComposerShell, { ...props, onSetPromptMode: (mode) => picked.push(mode) });
  assert.equal(byClass(tree, "mode-picker-trigger").props["aria-expanded"], true);
  const options = collectElements(tree, (node) => node.props?.role === "menuitemradio");
  assert.deepEqual(options.map((option) => textOf(byClass(option, "mode-menu-option-label"))), ["排队", "插入"]);
  assert.deepEqual(options.map((option) => option.props["aria-checked"]), [true, false]);

  options[1].props.onClick();
  assert.deepEqual(picked, ["steer"]);
  tree = renderer.render(ComposerShell, { ...props, onSetPromptMode: (mode) => picked.push(mode) });
  assert.equal(byClass(tree, "mode-picker-trigger").props["aria-expanded"], false);
});

test("marks each pending message as queued or inserted", async () => {
  const renderer = createHookRenderer();
  const { QueueDock } = await loadModule(renderer.react, "./QueueDock.tsx");

  const item = (id, placement) => ({ id, placement, message: { content: `内容 ${id}` } });
  const tree = renderer.render(QueueDock, {
    locale: "zh",
    items: [item("a", "queued"), item("b", "steering"), item("c", "context")],
    editingId: null,
    editingText: "",
    onEditingTextChange() {},
    onSave() {},
    onCancelEdit() {},
    onBeginEdit() {},
    onRemove() {},
  });

  // 上下文条目不属于待处理消息；其余按投递方式标注。
  const hasClass = (node, name) => String(node.props?.className ?? "").split(" ").includes(name);
  const rows = collectElements(tree, (node) => hasClass(node, "queue-dock-item"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(textOf), ["排队内容 a", "插入内容 b"]);
  const badges = collectElements(tree, (node) => hasClass(node, "queue-dock-item-mode"));
  assert.deepEqual(badges.map((badge) => badge.props.className), ["queue-dock-item-mode queued", "queue-dock-item-mode steering"]);
  assert.deepEqual(badges.map(textOf), ["排队", "插入"]);
});
