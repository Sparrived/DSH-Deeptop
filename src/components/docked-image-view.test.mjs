// 停靠标签图片预览的行为检查：读取期间的状态、缩放按钮的取值范围与重置、
// 单图时不出现翻页入口。缩放换算与导航序列由 image-preview-model.test.mjs 钉住，
// 这里只验证「按钮接到了哪个模型函数、什么时候禁用」这类接线。
//
// 渲染方式与 deliverables-panel.test.mjs 相同：轻量 hooks 渲染器，不驱动 effect，
// 因此读取始终停在 loading，缩放按钮的初始状态是确定的。
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
    // 不驱动 effect：原生读取、目录列举与滚轮监听都不在本次断言范围内。
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

const LUCIDE_STUBS = {
  AlertTriangle: "AlertTriangle",
  ChevronLeft: "ChevronLeft",
  ChevronRight: "ChevronRight",
  RefreshCw: "RefreshCw",
  Rows3: "Rows3",
  ZoomIn: "ZoomIn",
  ZoomOut: "ZoomOut",
};

async function loadDockedImageView(react) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./DockedImageView.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    external: ["react", "react-dom", "react/jsx-runtime", "lucide-react", "@tauri-apps/api/core", "@tauri-apps/api/event", "@tauri-apps/api/webview"],
    loader: { ".css": "empty" },
  });
  const module = { exports: {} };
  const requireFromTest = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled.outputFiles[0].text)((id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: Symbol.for("react.fragment") };
    if (id === "lucide-react") return LUCIDE_STUBS;
    // 桥接在测试里不参与：组件不会在 effect 中调用它们。
    if (id.startsWith("@tauri-apps/api/")) return { invoke: () => Promise.reject(new Error("test")), listen: () => Promise.resolve(() => undefined), getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => undefined) }) };
    return requireFromTest(id);
  }, module, module.exports);
  return module.exports.DockedImageView;
}

const baseProps = { path: "shots/card.png", cwd: "C:\\work", locale: "zh" };

const buttonsWith = (tree, className) => collectElements(tree, (node) => node.type === "button" && node.props.className === className);
const zoomInButton = (tree) => buttonsWith(tree, "dock-image-zoom")[1];
const zoomOutButton = (tree) => buttonsWith(tree, "dock-image-zoom")[0];
const zoomValueButton = (tree) => buttonsWith(tree, "dock-image-zoom-value")[0];

test("shows the reading state with a fitted zoom while the image loads", async () => {
  const renderer = createHookRenderer();
  const DockedImageView = await loadDockedImageView(renderer.react);
  const tree = renderer.render(DockedImageView, baseProps);

  // 面板标题是文件名，副标题在图片到达前说明正在读取。
  const section = collectElements(tree, (node) => node.props?.className?.includes("dock-image-view"))[0];
  assert.equal(section.props["aria-label"], "图片预览：C:\\work\\shots\\card.png");
  assert.equal(textOf(collectElements(tree, (node) => node.props?.className === "dock-file-copy")[0]), "card.png正在读取图片…");
  assert.equal(textOf(collectElements(tree, (node) => node.props?.role === "status")[0]), "正在读取图片…");
  // 还没读到图片：没有 img，也没有可放大的内容。
  assert.deepEqual(collectElements(tree, (node) => node.type === "img"), []);
  assert.equal(textOf(zoomValueButton(tree)), "100%");
  // 只有一张图片时不出现翻页入口。
  assert.deepEqual(buttonsWith(tree, "dock-image-step is-previous"), []);
  assert.deepEqual(buttonsWith(tree, "dock-image-step is-next"), []);
});

test("steps the zoom by the button factor and resets to fit", async () => {
  const renderer = createHookRenderer();
  const DockedImageView = await loadDockedImageView(renderer.react);
  let tree = renderer.render(DockedImageView, baseProps);

  zoomInButton(tree).props.onClick();
  tree = renderer.render(DockedImageView, baseProps);
  assert.equal(textOf(zoomValueButton(tree)), "160%");
  // 缩放百分比同时进无障碍名称，读屏用户听得到当前比例。
  assert.equal(zoomValueButton(tree).props["aria-label"], "适应面板（当前 160%）");

  zoomInButton(tree).props.onClick();
  tree = renderer.render(DockedImageView, baseProps);
  assert.equal(textOf(zoomValueButton(tree)), "256%");

  zoomOutButton(tree).props.onClick();
  tree = renderer.render(DockedImageView, baseProps);
  assert.equal(textOf(zoomValueButton(tree)), "160%");

  zoomValueButton(tree).props.onClick();
  tree = renderer.render(DockedImageView, baseProps);
  assert.equal(textOf(zoomValueButton(tree)), "100%");
});

test("disables each zoom bound at the ends of the range", async () => {
  const renderer = createHookRenderer();
  const DockedImageView = await loadDockedImageView(renderer.react);
  let tree = renderer.render(DockedImageView, baseProps);

  // 适应面板时两端都还能动（下限 25%，上限 800%）。
  assert.equal(zoomOutButton(tree).props.disabled, false);
  assert.equal(zoomInButton(tree).props.disabled, false);

  while (!zoomInButton(tree).props.disabled) {
    zoomInButton(tree).props.onClick();
    tree = renderer.render(DockedImageView, baseProps);
  }
  assert.equal(textOf(zoomValueButton(tree)), "800%");
  assert.equal(zoomInButton(tree).props.disabled, true);

  while (!zoomOutButton(tree).props.disabled) {
    zoomOutButton(tree).props.onClick();
    tree = renderer.render(DockedImageView, baseProps);
  }
  assert.equal(textOf(zoomValueButton(tree)), "25%");
  assert.equal(zoomOutButton(tree).props.disabled, true);
});

test("localizes the panel chrome", async () => {
  const renderer = createHookRenderer();
  const DockedImageView = await loadDockedImageView(renderer.react);
  const tree = renderer.render(DockedImageView, { ...baseProps, locale: "en" });

  const section = collectElements(tree, (node) => node.props?.className?.includes("dock-image-view"))[0];
  assert.equal(section.props["aria-label"], "Image preview: C:\\work\\shots\\card.png");
  assert.equal(textOf(collectElements(tree, (node) => node.props?.role === "status")[0]), "Loading image…");
  assert.equal(zoomInButton(tree).props.title, "Zoom in");
  assert.equal(zoomValueButton(tree).props["aria-label"], "Fit to panel (currently 100%)");
});
