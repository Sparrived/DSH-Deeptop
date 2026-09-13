// 统计胶囊的行为检查：两个入口、共享弹窗座位、明细行与看板出口。
// 轻量 hooks 渲染器与 deliverables-panel.test.mjs 相同：直接调用组件函数，
// 在没有 DOM 的环境里检查返回的元素树。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// 弹窗通过 createPortal 挂到 document.body；测试只需要一个占位目标。
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
    // 测试不驱动 effect：外部点击/Escape 关闭与定位测量不属于本次断言范围。
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

async function loadStatsPills(react) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./StatsPills.tsx", import.meta.url))],
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
    if (id === "lucide-react") return { ChartNoAxesColumn: "ChartNoAxesColumn", Database: "Database" };
    return requireFromTest(id);
  }, module, module.exports);
  return module.exports.StatsPills;
}

const sessionStats = {
  inputTokens: 12_000,
  outputTokens: 3_400,
  totalTokens: 15_400,
  reasoningTokens: 900,
  uncachedInputTokens: 4_000,
  cacheReadTokens: 8_000,
  cacheWriteTokens: 0,
  contextTokens: 90_000,
  contextLimit: 200_000,
  contextTokensAvailable: true,
  cacheHitRate: 66.6,
  messages: 12,
  turns: 4,
  steps: 9,
  llmMs: 41_000,
  toolMs: 6_000,
  ttftMs: 820,
  ttftSteps: 3,
  decodeMs: 12_000,
  decodeTokens: 2_400,
};

const props = { sessionStats, sessionRunningMs: 125_000, locale: "zh" };
const pillsOf = (tree) => collectElements(tree, (node) => node.type === "button" && node.props.className?.startsWith("stats-pill"));
const popupOf = (tree) => collectElements(tree, (node) => node.props?.className === "stats-popup")[0] ?? null;
const click = (node) => node.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 12, top: 40 }) } });

test("renders two closed capsules until one is opened", async () => {
  const renderer = createHookRenderer();
  const StatsPills = await loadStatsPills(renderer.react);
  const tree = renderer.render(StatsPills, props);

  const pills = pillsOf(tree);
  assert.deepEqual(pills.map((pill) => pill.props["aria-label"]), ["时间与速度", "Token 用量"]);
  assert.deepEqual(pills.map((pill) => pill.props["aria-expanded"]), [false, false]);
  assert.ok(pills.every((pill) => pill.props["aria-haspopup"] === "dialog"));
  assert.equal(popupOf(tree), null);
});

test("opens the timing seat with the run, model, tool, ttft and decode rows", async () => {
  const renderer = createHookRenderer();
  const StatsPills = await loadStatsPills(renderer.react);
  let tree = renderer.render(StatsPills, props);
  click(pillsOf(tree)[0]);
  tree = renderer.render(StatsPills, props);

  const popup = popupOf(tree);
  assert.equal(popup.props.role, "dialog");
  assert.equal(popup.props["aria-label"], "时间与速度");
  const rows = collectElements(popup, (node) => node.props?.className === "stats-popup-row");
  assert.deepEqual(rows.map((row) => textOf(collectElements(row, (node) => node.props?.className === "stats-popup-label")[0])), [
    "会话运行时间", "LLM 耗时", "工具耗时", "首 Token", "解码耗时",
  ]);
  // 同一个胶囊再点一次收起弹窗。
  click(pillsOf(renderer.render(StatsPills, props))[0]);
  assert.equal(popupOf(renderer.render(StatsPills, props)), null);
});

test("shares one seat between both capsules and offers the dashboard", async () => {
  const renderer = createHookRenderer();
  const StatsPills = await loadStatsPills(renderer.react);
  let opened = 0;
  let tree = renderer.render(StatsPills, { ...props, onOpenDashboard: () => { opened += 1; } });

  click(pillsOf(tree)[1]);
  tree = renderer.render(StatsPills, { ...props, onOpenDashboard: () => { opened += 1; } });
  assert.equal(popupOf(tree).props["aria-label"], "Token 用量");
  assert.deepEqual(pillsOf(tree).map((pill) => pill.props["aria-expanded"]), [false, true]);
  const rows = collectElements(popupOf(tree), (node) => node.props?.className === "stats-popup-row");
  assert.equal(rows.length, 5);
  // 上下文行是唯一带进度条的行。
  assert.equal(collectElements(popupOf(tree), (node) => node.props?.className === "stats-popup-meter").length, 1);

  const more = collectElements(popupOf(tree), (node) => node.props?.className === "stats-popup-more")[0];
  assert.equal(textOf(more), "打开会话看板");
  more.props.onClick();
  assert.equal(opened, 1);
  assert.equal(popupOf(renderer.render(StatsPills, { ...props, onOpenDashboard: () => { opened += 1; } })), null);
});
