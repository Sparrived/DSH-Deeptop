// 交付卡片的行为检查：菜单可用性、两个原生动作、动作后焦点回到主体按钮，
// 以及阶段状态取代副标题。用与 git-tree-graph.test.mjs 相同的轻量 hooks 渲染器，
// 在没有 DOM 的环境里直接调用组件函数并检查返回的元素树。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// 菜单通过 createPortal 挂到 document.body；测试只需要一个占位目标。
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
    // 测试不驱动 effect：卡片的外部点击/Escape 监听与测量定位不属于本次断言范围。
    useEffect() {},
    useLayoutEffect() {},
  };

  return {
    react,
    render(Component, props, focusLog = []) {
      hookIndex = 0;
      const tree = Component(props);
      attachRefs(tree, focusLog);
      return tree;
    },
  };
}

/** 把元素树上的 ref 换成可记录焦点的替身：卡片只通过 ref 归还焦点。 */
function attachRefs(node, focusLog) {
  if (Array.isArray(node)) {
    for (const child of node) attachRefs(child, focusLog);
    return;
  }
  if (!node || typeof node !== "object") return;
  const ref = node.props?.ref;
  if (ref && typeof ref === "object") ref.current = { focus: () => focusLog.push(node.props.className) };
  attachRefs(node.props?.children, focusLog);
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
  ChevronDown: "ChevronDown",
  ExternalLink: "ExternalLink",
  FolderOpen: "FolderOpen",
  SquareArrowOutUpRight: "SquareArrowOutUpRight",
};

async function loadPresentedFileCard(react) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./PresentedFileCard.tsx", import.meta.url))],
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
  return module.exports.PresentedFileCard;
}

const baseProps = {
  path: "src/app/main.ts",
  detail: "src/app",
  locale: "zh",
  host: { fileManager: "explorer" },
  onPreview() {},
  onAction() {},
};

const buttonWith = (tree, className) => collectElements(tree, (node) => node.type === "button" && node.props.className === className)[0];

test("offers the two native actions only through the chevron menu", async () => {
  const renderer = createHookRenderer();
  const PresentedFileCard = await loadPresentedFileCard(renderer.react);
  const actions = [];
  let tree = renderer.render(PresentedFileCard, { ...baseProps, onAction: (path, action) => actions.push([path, action]) });

  const preview = buttonWith(tree, "deliverable-file");
  assert.ok(preview.props["aria-label"].includes("src/app/main.ts"));
  const chevron = buttonWith(tree, "deliverable-file-menu");
  assert.equal(chevron.props["aria-haspopup"], "menu");
  assert.equal(chevron.props["aria-expanded"], false);
  assert.equal(chevron.props.disabled, false);
  assert.deepEqual(collectElements(tree, (node) => node.props.role === "menuitem"), []);

  // 打开菜单：锚点来自 chevron 的视口矩形，条目文案取自宿主声明的文件管理器。
  chevron.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 40, bottom: 20 }) } });
  const focusLog = [];
  tree = renderer.render(PresentedFileCard, { ...baseProps, onAction: (path, action) => actions.push([path, action]) }, focusLog);
  assert.equal(buttonWith(tree, "deliverable-file-menu").props["aria-expanded"], true);
  const items = collectElements(tree, (node) => node.props?.role === "menuitem");
  assert.deepEqual(items.map(textOf), ["用默认应用打开", "在资源管理器中显示"]);

  items[1].props.onClick();
  assert.deepEqual(actions, [["src/app/main.ts", "reveal"]]);
  // 动作后焦点回到主体预览按钮，菜单关闭。
  assert.deepEqual(focusLog, ["deliverable-file"]);
  tree = renderer.render(PresentedFileCard, { ...baseProps, onAction: (path, action) => actions.push([path, action]) });
  assert.equal(buttonWith(tree, "deliverable-file-menu").props["aria-expanded"], false);
  assert.deepEqual(collectElements(tree, (node) => node.props.role === "menuitem"), []);
});

test("disables the menu without a native host and while an action runs", async () => {
  const renderer = createHookRenderer();
  const PresentedFileCard = await loadPresentedFileCard(renderer.react);

  for (const [host, phase, expected] of [
    [null, undefined, true],
    [{ fileManager: "finder" }, "opening", true],
    [{ fileManager: "finder" }, "revealing", true],
    [{ fileManager: "finder" }, "revealed", false],
    [{ fileManager: "finder" }, "error", false],
  ]) {
    const tree = renderer.render(PresentedFileCard, { ...baseProps, host, phase });
    assert.equal(buttonWith(tree, "deliverable-file-menu").props.disabled, expected, `${host}/${phase}`);
    // 阶段状态取代目录副标题，失败阶段标错误色。
    const status = collectElements(tree, (node) => node.props?.className === "deliverable-file-status")[0];
    assert.equal(status.props["data-error"], phase === "error" || phase === "revealError" ? true : undefined);
  }
});

test("replaces the directory detail with the localized phase status", async () => {
  const renderer = createHookRenderer();
  const PresentedFileCard = await loadPresentedFileCard(renderer.react);
  const statusOf = (props) => {
    const tree = renderer.render(PresentedFileCard, { ...baseProps, ...props });
    return collectElements(tree, (node) => node.props?.className === "deliverable-file-status")[0];
  };

  assert.equal(textOf(statusOf({})), "src/app");
  assert.equal(textOf(statusOf({ phase: "opening" })), "正在用默认应用打开…");
  assert.equal(textOf(statusOf({ phase: "revealing" })), "正在资源管理器中定位…");
  assert.equal(textOf(statusOf({ phase: "revealed" })), "已在资源管理器中显示");
  // 只能打开所在文件夹的宿主不假装有具名文件管理器。
  assert.equal(textOf(statusOf({ host: { fileManager: "directory" }, phase: "revealed" })), "已打开所在文件夹");
  assert.equal(statusOf({}).props.role, undefined);
  assert.equal(statusOf({ phase: "opened" }).props.role, "status");
});
