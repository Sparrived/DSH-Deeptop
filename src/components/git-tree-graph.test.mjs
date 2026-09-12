import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

function dependenciesMatch(left, right) {
  return left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
}

/** 与 conversation-transcript.test.mjs 相同的轻量 hooks 渲染器：直接调用组件函数，
 * 用假 hooks 保存状态，从而在没有 DOM 的环境里检查返回的元素树。 */
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
    // 假渲染器不做 pre-paint 语义，layout effect 与普通 effect 一样收集后由 flushEffects 执行
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

/** 深度优先收集所有指定类型的元素。 */
function collectElements(node, type, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, type, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  if (node.type === type) found.push(node);
  collectElements(node.props?.children, type, found);
  return found;
}

/** 悬浮卡片现在挂在列表层，从整棵树里找。 */
function tooltipOf(tree) {
  return collectElements(tree, "div").find((node) => node.props.className === "git-graph-tooltip") ?? null;
}
async function loadGitTreeGraphExports(react) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./GitTreeGraph.tsx", import.meta.url))],
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

function sha(index) {
  return index.toString(16).padStart(40, "0");
}

function commit(index, parents = [], refs = [], subject = `subject ${index}`) {
  return {
    hash: sha(index),
    shortHash: sha(index).slice(0, 7),
    author: "tester",
    email: "tester@example.com",
    timestamp: 1_700_000_000 + index,
    refs,
    parents: parents.map(sha),
    subject,
  };
}

test("only mounts the rows inside the virtual window", async () => {
  const renderer = createHookRenderer();
  const { GitTreeGraph } = await loadGitTreeGraphExports(renderer.react);
  const lines = Array.from({ length: 500 }, (_, index) => commit(index, index === 499 ? [] : [index + 1]));
  const tree = renderer.render(GitTreeGraph, {
    lines,
    selectedHash: null,
    onSelect() {},
    onLoadMore() {},
    hasMore: true,
    locale: "zh",
  });

  const rows = collectElements(tree, "button");
  assert.ok(rows.length > 0 && rows.length < 32, `虚拟化后只应挂载少量行，实际 ${rows.length}`);
  // 可见窗口之外用等高占位撑起滚动高度：16 行高度 + 其余行高度 = 500 行
  const spacers = collectElements(tree, "div").filter((node) => node.props.className === "git-graph-spacer");
  const spacerHeight = spacers.reduce((total, node) => total + node.props.style.height, 0);
  assert.equal(spacerHeight + rows.length * 24, 500 * 24);
});

test("draws a straight lane, a merge arc, a converging shift and a HEAD ring", async () => {
  const renderer = createHookRenderer();
  const { GitTreeGraph } = await loadGitTreeGraphExports(renderer.react);
  const lines = [
    commit(0, [1, 2], ["HEAD -> main"]),
    commit(1, [3]),
    commit(2, [3]),
    commit(3, []),
  ];
  const tree = renderer.render(GitTreeGraph, {
    lines,
    selectedHash: null,
    onSelect() {},
    locale: "zh",
  });

  const [head, first, second, root] = collectElements(tree, "button");
  // HEAD 行：命中区 + 圆环 + 打孔的圆（悬浮只在节点上触发，所以命中区比可见圆略大）
  const headCircles = collectElements(head, "circle");
  assert.equal(headCircles.length, 3);
  assert.ok(headCircles.some((node) => node.props.className === "git-graph-node-hole"));
  // 合并线：从圆点平拉到目标列左缘，再用圆弧落进目标列底部
  assert.ok(collectElements(head, "path").some((node) => node.props.d === "M 18 12 A 12 12 0 0 1 24 24 M 18 12 H 12"));
  // 分支链在本行是同列竖线，不换道、不带圆弧
  const firstPaths = collectElements(first, "path").map((node) => node.props.d);
  assert.ok(firstPaths.includes("M 24 0 V 24"));
  assert.ok(!firstPaths.some((d) => d.includes("A 12 12")));
  // 汇合行：节点自己的线在本行内斜向并入已有泳道（不跨行追父提交）
  assert.ok(collectElements(second, "path").some((node) => node.props.d === "M 24 12 H 17 A 5 5 0 0 0 12 17 V 24"));
  // 根提交：没有双亲，不再向下延伸
  assert.equal(collectElements(root, "path").some((node) => node.props.d.endsWith("V 24")), false);
});

test("shows reference chips and opens the commit tooltip on hover", async () => {
  const renderer = createHookRenderer();
  const { GitTreeGraph } = await loadGitTreeGraphExports(renderer.react);
  const props = {
    lines: [commit(0, [1], ["HEAD -> main", "tag: v1.0"], "tip commit"), commit(1, [])],
    selectedHash: null,
    onSelect() {},
    locale: "zh",
  };

  let tree = renderer.render(GitTreeGraph, props);
  let first = collectElements(tree, "button")[0];
  assert.deepEqual(
    collectElements(first, "span").filter((node) => node.props.className?.startsWith("git-graph-ref git-ref-")).map((node) => node.props.title),
    ["HEAD -> main", "tag: v1.0"],
  );
  assert.equal(tooltipOf(tree), null);
  // 行内文字悬浮不弹卡片：行按钮上没有悬浮处理
  assert.equal(first.props.onMouseEnter, undefined);
  assert.equal(first.props.onMouseLeave, undefined);

  // 只有悬浮到提交节点上才出现详情卡片
  const node = collectElements(first, "g").find((element) => element.props.className === "git-graph-node");
  assert.ok(node, "每行都应有一个节点分组");
  assert.equal(typeof node.props.onMouseEnter, "function");
  node.props.onMouseEnter();
  tree = renderer.render(GitTreeGraph, props);
  const tooltip = tooltipOf(tree);
  assert.ok(tooltip, "悬浮节点后应出现提交详情提示");
  assert.ok(
    collectElements(tooltip, "div").some((node) => node.props.className === "git-graph-tooltip-subject" && node.props.children === "tip commit"),
  );
  assert.ok(tooltip.props.style.left > 0);
  // 卡片挂在列表层并由行偏移定位（不是塞进行按钮里，否则会被行高裁掉）
  assert.equal(tooltip.type, "div");
  // 首行贴顶展开：否则按节点垂直居中的卡片会被滚动容器上沿切掉
  assert.equal(tooltip.props.style.top, 0);
  assert.equal(tooltip.props.style.transform, "none");

  // 靠下的行仍然是"以节点为中心"的默认定位
  const deeper = renderer.render(GitTreeGraph, {
    ...props,
    lines: [commit(0, [1]), commit(1, [2]), commit(2, [3]), commit(3, [4]), commit(4, [])],
  });
  const deeperNode = collectElements(collectElements(deeper, "button")[4], "g")
    .find((element) => element.props.className === "git-graph-node");
  assert.equal(typeof deeperNode?.props.onMouseEnter, "function");
  deeperNode.props.onMouseEnter();
  const deeperTooltip = tooltipOf(renderer.render(GitTreeGraph, {
    ...props,
    lines: [commit(0, [1]), commit(1, [2]), commit(2, [3]), commit(3, [4]), commit(4, [])],
  }));
  assert.ok(deeperTooltip, "靠下的行也应出现卡片");
  assert.ok(deeperTooltip.props.style.top > 0);
  assert.equal(deeperTooltip.props.style.transform, undefined);
});

test("renders the tail lane placeholder while more history can be loaded", async () => {
  const renderer = createHookRenderer();
  const { GitTreeGraph } = await loadGitTreeGraphExports(renderer.react);
  // 历史被截断：最后一行的双亲还没加载，因此底部有泳道要接住
  const lines = [commit(0, [1]), commit(1, [2])];
  const withMore = renderer.render(GitTreeGraph, {
    lines,
    selectedHash: null,
    onSelect() {},
    onLoadMore() {},
    hasMore: true,
    loadingMore: false,
    locale: "zh",
  });
  const placeholder = collectElements(withMore, "div").find((node) => node.props.className === "git-graph-placeholder");
  assert.ok(placeholder, "还有更早历史时应渲染泳道占位");
  assert.ok(collectElements(placeholder, "path").length >= 1);
  assert.equal(collectElements(withMore, "div").find((node) => node.props.className === "git-graph-sentinel").props.children, "继续滚动加载更早的提交");

  const withoutMore = renderer.render(GitTreeGraph, {
    lines,
    selectedHash: null,
    onSelect() {},
    onLoadMore() {},
    hasMore: false,
    locale: "zh",
  });
  assert.equal(collectElements(withoutMore, "div").some((node) => node.props.className === "git-graph-placeholder"), false);
  assert.equal(collectElements(withoutMore, "div").find((node) => node.props.className === "git-graph-sentinel").props.children, "已展示到仓库最早的历史");
});

test("returns nothing when there is no history", async () => {
  const renderer = createHookRenderer();
  const { GitTreeGraph } = await loadGitTreeGraphExports(renderer.react);
  assert.equal(renderer.render(GitTreeGraph, { lines: [], selectedHash: null, onSelect() {}, locale: "zh" }), null);
});
