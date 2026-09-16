// 提示词注入插件自带设置面板的契约测试。
//
// 这条路径把「插件自己拥有设置界面」跑通到真实运行时：客户端模块经 bundled 表
// 激活，再通过 scoped settings 读写自己的命名空间，主程序不再出现该命名空间。
// 因此这里断言用户可见的几件事：面板渲染插件自带的本地化文案、保存只发送真实
// 变化的路径操作并带上 revision、未改动时不写、宿主拒绝该命名空间时显示不可用，
// 以及停用运行时后贡献随之消失。

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { DesktopUiRuntime } from "./client-runtime.ts";

const require = createRequire(import.meta.url);

/** 等待 describe()/mutate() 这类请求穿过运行时的请求队列后落定。 */
async function flush() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * 只实现本面板用到的两个 hook。effects 在 render 内同步跑完，因此配合 flush()
 * 就能观察 describe() 的结果落进 state 后的那一帧。
 */
function createHookRenderer() {
  const hooks = [];
  let index = 0;
  const effects = [];
  const react = {
    useState(initial) {
      const at = index++;
      if (!hooks[at]) hooks[at] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[at].value, (next) => {
        hooks[at].value = typeof next === "function" ? next(hooks[at].value) : next;
      }];
    },
    useEffect(effect, dependencies) {
      const at = index++;
      const previous = hooks[at];
      const same = previous
        && previous.dependencies?.length === dependencies?.length
        && previous.dependencies.every((value, i) => Object.is(value, dependencies[i]));
      if (!same) effects.push(effect);
      hooks[at] = { dependencies };
    },
  };
  return {
    react,
    render(Component, props) {
      index = 0;
      effects.length = 0;
      // 只渲染一次并返回这一帧：effects 里的 setState 由下一次 render 体现，
      // 否则第二次调用会从错位的 hook 下标读出一份与 state 无关的快照。
      const tree = Component(props);
      for (const effect of effects.splice(0)) effect();
      return tree;
    },
  };
}

function jsx(type, props, key) {
  return { type, key, props: props ?? {} };
}

/** 递归渲染函数组件，得到最终的宿主元素树。 */
function renderTree(renderer, node) {
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return renderTree(renderer, renderer.render(node.type, node.props));
  const children = node.props?.children;
  return {
    ...node,
    props: { ...node.props, children: Array.isArray(children) ? children.map((child) => renderTree(renderer, child)) : renderTree(renderer, children) },
  };
}

/** 深度优先收集所有指定类型的元素。 */
function findAll(node, type, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node.type === type) found.push(node);
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) findAll(child, type, found);
  return found;
}

function findElement(node, type) {
  return findAll(node, type)[0] ?? null;
}

function collectText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const children = node.props?.children;
  return (Array.isArray(children) ? children : [children]).map(collectText).join("");
}

/** 渲染面板并在 flush 后返回反映异步读结果的元素树。 */
async function renderPanel(renderer, contribution, context) {
  renderTree(renderer, contribution.render(context));
  await flush();
  return renderTree(renderer, contribution.render(context));
}

/** 用测试的 react 实例编译客户端模块，保证 hooks 与断言共享同一份实现。 */
async function loadClientModule(react) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./prompt-injection-client.tsx", import.meta.url))],
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
    pluginId: "deeptop.prompt-injection",
    version: "0.1.0",
    displayName: "Prompt injection",
    status: "available",
    client: { entryId: "deeptop.prompt-injection/client", format: "esm", sdkVersion: "^1.0.0" },
    slots: ["settings.sections"],
    capabilities: { remotes: [], settings: ["deeptop-prompt-injection"] },
    contributions: [],
  };
}

function namespace(text, revision = 1) {
  return {
    ns: "deeptop-prompt-injection",
    schema: {},
    value: { text },
    user: { text },
    applies: "live",
    secrets: [],
    revision,
  };
}

/** 激活模块并返回真实运行时、贡献项与渲染上下文。 */
async function activate(renderer, { locale = "zh", describe = async () => namespace("总是先跑测试") } = {}) {
  const module = await loadClientModule(renderer.react);
  const calls = [];
  const notifications = [];
  const runtime = new DesktopUiRuntime({
    request: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "ui.plugin.list") return { items: [descriptor()] };
      if (method === "ui.plugin.settings.describe") return { value: await describe() };
      if (method === "ui.plugin.settings.mutate") return { value: namespace(payload.ops[0].value, 2) };
      throw new Error(`unexpected request: ${method}`);
    },
    listen: () => () => undefined,
    bundledModules: { "deeptop.prompt-injection/client": async () => module },
    locale,
    hostActions: { prompt: async () => null, notify: (message, kind) => notifications.push({ message, kind }) },
  });
  await runtime.start();
  const [contribution] = runtime.slots.snapshot("settings.sections");
  assert.ok(contribution, "the plugin must contribute one settings panel");
  const context = {
    session: null,
    activeSessionId: null,
    sessionGeneration: 0,
    locale,
    host: runtime["hostActions"],
  };
  return { runtime, contribution, calls, notifications, context };
}

test("contributes exactly one settings.sections panel with a locale-resolved label", async () => {
  const renderer = createHookRenderer();
  const { runtime, contribution } = await activate(renderer, { locale: "en" });
  try {
    assert.equal(contribution.kind, "panel");
    assert.equal(contribution.pluginId, "deeptop.prompt-injection");
    assert.equal(runtime.slots.snapshot("settings.sections").length, 1);
    // activate() 只跑一次：标签必须是函数，切换语言时导航才会跟着翻译。
    assert.equal(typeof contribution.label, "function");
    assert.equal(contribution.label("en"), "Global prompt injection");
    assert.equal(contribution.label("zh"), "全局提示词注入");
  } finally {
    await runtime.stop();
  }
});

test("renders the plugin's own localized card instead of a raw namespace row", async () => {
  const renderer = createHookRenderer();
  const { runtime, contribution, context } = await activate(renderer, { locale: "zh" });
  try {
    const tree = await renderPanel(renderer, contribution, context);
    const text = collectText(tree);
    assert.match(text, /全局提示词注入/);
    assert.match(text, /注入内容/);
    const editor = findElement(tree, "textarea");
    assert.ok(editor, "the panel must expose the multi-line editor");
    assert.equal(editor.props.value, "总是先跑测试");
    // 非空草稿显示「立即生效」提示，空草稿显示「留空即关闭」提示。
    assert.match(text, /改动会立即影响之后的所有请求/);
    // 通用命名空间列表会显示原始 ns；自带面板不该泄露它。
    assert.doesNotMatch(text, /deeptop-prompt-injection/);
  } finally {
    await runtime.stop();
  }
});

test("reads through the scoped facade and never writes while rendering", async () => {
  const renderer = createHookRenderer();
  const { runtime, contribution, context, calls } = await activate(renderer);
  try {
    await renderPanel(renderer, contribution, context);
    const describe = calls.find((call) => call.method === "ui.plugin.settings.describe");
    assert.deepEqual(describe?.payload, { pluginId: "deeptop.prompt-injection", ns: "deeptop-prompt-injection" });
    assert.equal(calls.some((call) => call.method === "ui.plugin.settings.mutate"), false);
  } finally {
    await runtime.stop();
  }
});

test("saving sends only the changed path op with the revision it read", async () => {
  const renderer = createHookRenderer();
  const { runtime, contribution, context, calls, notifications } = await activate(renderer);
  try {
    let tree = await renderPanel(renderer, contribution, context);
    const confirm = () => findAll(tree, "button").find((button) => button.props.className === "confirm");
    assert.equal(confirm().props.disabled, true, "an unchanged draft must not be savable");

    findElement(tree, "textarea").props.onChange({ target: { value: "改动后的文本" } });
    tree = await renderPanel(renderer, contribution, context);
    assert.equal(confirm().props.disabled, false);

    confirm().props.onClick();
    await flush();

    const mutate = calls.find((call) => call.method === "ui.plugin.settings.mutate");
    assert.deepEqual(mutate?.payload, {
      pluginId: "deeptop.prompt-injection",
      ns: "deeptop-prompt-injection",
      ops: [{ op: "set", path: ["text"], value: "改动后的文本" }],
      expectedRevision: 1,
    });
    assert.equal(notifications.at(-1)?.message, "全局提示词已保存");
  } finally {
    await runtime.stop();
  }
});

test("an unavailable namespace renders the localized fallback", async () => {
  const renderer = createHookRenderer();
  const { runtime, contribution, context } = await activate(renderer, {
    locale: "en",
    describe: async () => { throw new Error("settings namespace is not registered"); },
  });
  try {
    const tree = await renderPanel(renderer, contribution, context);
    assert.match(collectText(tree), /cannot be configured/);
  } finally {
    await runtime.stop();
  }
});

test("deactivation removes the panel contribution", async () => {
  const renderer = createHookRenderer();
  const { runtime } = await activate(renderer);
  await runtime.stop();
  assert.equal(runtime.slots.snapshot("settings.sections").length, 0);
});
