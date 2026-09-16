// 待发送图片的位置与快速预览检查：胶囊排在输入框上方的工作台首行（横跨
// 输入框与工具列），胶囊主体点开快速预览、再点一次收起，移除按钮只移除该张。
// 轻量 hooks 渲染器与 composer-send-mode.test.mjs 相同：直接调用组件函数，
// 在没有 DOM 的环境里检查返回的元素树。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// 预览弹窗通过 createPortal 挂到 document.body；测试只需要一个占位目标。
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

const attachment = (id) => ({ id, name: `图 ${id}.png`, mediaType: "image/png", data: `payload-${id}` });
const byClass = (tree, className) => collectElements(tree, (node) => node.props?.className === className)[0];
const hasClass = (node, name) => String(node.props?.className ?? "").split(" ").includes(name);
const pillsOf = (tree) => collectElements(tree, (node) => hasClass(node, "composer-attachment"));
const previewOf = (tree) => collectElements(tree, (node) => hasClass(node, "attachment-preview"))[0] ?? null;
const click = (node) => node.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 12, top: 40 }) } });

test("keeps the pending images above the input box, not inside it", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const tree = renderer.render(ComposerShell, { ...composerProps, attachments: [attachment("a")] });
  const workbench = byClass(tree, "composer-workbench");
  const shell = byClass(tree, "composer-shell");
  const row = byClass(tree, "composer-attachments");

  // 工作台首行是附件行，输入框紧随其后：胶囊在发送框之上，而不是塞在框内。
  assert.deepEqual(workbench.props.children.filter(Boolean).slice(0, 2), [row, shell]);
  assert.equal(collectElements(shell, (node) => hasClass(node, "composer-attachment")).length, 0);
  // 横跨输入框与右侧工具列，不受工具列宽度挤压。
  assert.equal(row.props.role, "group");
  assert.equal(row.props["aria-label"], "待发送图片");
});

test("shows no attachment row without pending images", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const tree = renderer.render(ComposerShell, composerProps);
  assert.equal(byClass(tree, "composer-attachments"), undefined);
  assert.equal(previewOf(tree), null);
});

test("renders each pending image as a capsule with its thumbnail and name", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const tree = renderer.render(ComposerShell, { ...composerProps, attachments: [attachment("a"), attachment("b")] });
  const pills = pillsOf(tree);

  assert.equal(pills.length, 2);
  assert.deepEqual(pills.map(textOf), ["图 a.png", "图 b.png"]);
  const images = collectElements(tree, (node) => node.type === "img");
  assert.deepEqual(images.map((image) => image.props.src), ["data:image/png;base64,payload-a", "data:image/png;base64,payload-b"]);
  assert.deepEqual(images.map((image) => image.props.alt), ["图 a.png", "图 b.png"]);
});

test("removes exactly the capsule whose close button was pressed", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const removed = [];
  const props = { ...composerProps, attachments: [attachment("a"), attachment("b")], onRemoveAttachment: (id) => removed.push(id) };
  const tree = renderer.render(ComposerShell, props);

  const buttons = collectElements(tree, (node) => node.type === "button" && hasClass(node, "composer-attachment-remove"));
  assert.deepEqual(buttons.map((button) => button.props["aria-label"]), ["移除 图 a.png", "移除 图 b.png"]);
  buttons[1].props.onClick();
  assert.deepEqual(removed, ["b"]);
});

test("opens a quick preview from the capsule and closes it on the second press", async () => {
  const renderer = createHookRenderer();
  const { ComposerShell } = await loadModule(renderer.react, "./ComposerShell.tsx");

  const props = { ...composerProps, attachments: [attachment("a"), attachment("b")] };
  let tree = renderer.render(ComposerShell, props);
  assert.equal(previewOf(tree), null);

  const openers = collectElements(tree, (node) => node.type === "button" && hasClass(node, "composer-attachment-open"));
  assert.deepEqual(openers.map((button) => button.props["aria-expanded"]), [false, false]);
  assert.ok(openers.every((button) => button.props["aria-haspopup"] === "dialog"));

  click(openers[1]);
  tree = renderer.render(ComposerShell, props);
  const preview = previewOf(tree);
  assert.equal(preview.props.role, "dialog");
  assert.equal(preview.props["aria-label"], "预览 图 b.png");
  assert.equal(collectElements(preview, (node) => node.type === "img")[0].props.src, "data:image/png;base64,payload-b");
  assert.equal(textOf(byClass(preview, "attachment-preview-name")), "图 b.png");
  // 打开的那张标记自身，方便面板给出选中态。
  assert.equal(pillsOf(tree)[1].props.className, "composer-attachment composer-attachment-previewing");
  assert.deepEqual(collectElements(tree, (node) => node.type === "button" && hasClass(node, "composer-attachment-open")).map((button) => button.props["aria-expanded"]), [false, true]);

  // 同一个胶囊再点一次收起预览。
  click(collectElements(tree, (node) => node.type === "button" && hasClass(node, "composer-attachment-open"))[1]);
  tree = renderer.render(ComposerShell, props);
  assert.equal(previewOf(tree), null);

  // 关闭出口同样有效。
  click(collectElements(tree, (node) => node.type === "button" && hasClass(node, "composer-attachment-open"))[0]);
  tree = renderer.render(ComposerShell, props);
  click(byClass(previewOf(tree), "attachment-preview-close"));
  tree = renderer.render(ComposerShell, props);
  assert.equal(previewOf(tree), null);
});
