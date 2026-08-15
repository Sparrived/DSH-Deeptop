# Deeptop UI Runtime 实现设计

> 状态：提案 / 实施蓝图
>
> 本文定义如何在 Deeptop 中实现一套类似 DSH WebUI 原生 Client Runtime 的桌面 UI 插件运行时，使插件可以复用同一棵 DSH Cordis 树，并通过 Host/Cordis 插件为 Deeptop 添加 React 组件、菜单项、Badge、设置页和 Inspector 面板。
>
> 本文不是对当前仓库已有能力的描述。当前 Deeptop 已有 DSH Host/Cordis、Bridge、Remote、Projection、事件和 React 原生 UI，但还没有动态 Client Module、Slot Registry 或客户端插件生命周期。本文中的接口、路由和目录是拟议实现，落地时必须以锁定的 DSH 版本、Tauri 版本和实际 Cordis API 重新核对。

---

## 1. 摘要

Deeptop 不应把 DSH WebUI 的浏览器运行时原样搬进 Tauri，也不应让 Cordis Host 进程直接操作 React DOM。推荐实现一个**桌面端 Client Runtime**，复用 DSH 的原生分层思想：

```text
DSH Cordis Host Plugin
  ├─ Service
  ├─ Storage
  ├─ Remote
  ├─ Projection / Event
  └─ Desktop UI contribution descriptor
          │
          │  deeptop Bridge / capability protocol
          ▼
Deeptop Client Runtime
  ├─ Client Module Loader
  ├─ Client Plugin Runner
  ├─ Slot Registry
  ├─ Remote / Event / Storage client
  ├─ lifecycle and error isolation
  └─ React Slot Outlet
          │
          ▼
Deeptop React UI
```

最终，一个插件可以同时包含：

```text
session-pins/
├─ host/                 # 运行在 DSH Cordis 树中
│  └─ index.mjs
├─ client/               # 运行在 Deeptop WebView 中
│  └─ index.mjs
├─ manifest.json
└─ package.json
```

Host 部分负责真正的领域能力，例如会话置顶状态、持久化、权限和 Remote；Client 部分负责 React 组件和 Slot 注册。两部分使用同一个 `pluginId`，但运行在不同的 JavaScript Realm 中，只通过受控协议交流。

核心结论：

1. Deeptop 可以继续复用当前 DSH Host 进程和同一棵 Cordis 树。
2. Cordis 插件可以声明并提供 Deeptop UI 扩展，但不能直接把 React component function 传过 Bridge。
3. 自定义 React 组件需要 Client Module；纯 Host 插件可以使用声明式 UI，但不能直接渲染任意 React。
4. UI Runtime 必须使用固定的 Slot、受限的 Remote、命名空间 Storage 和插件生命周期，不能暴露整个 `apiProxy`、`window` 或任意 Tauri API。
5. 首个版本应优先支持受信任的本地 ESM Client Bundle；不要一开始就承诺任意第三方 npm 包或无改动加载所有 DSH WebUI bundle。

---

## 2. 背景与当前边界

### 2.1 当前 Deeptop 运行时

当前项目的真实边界是：

```text
Tauri Window + React
        │
        │ Tauri invoke / event
        ▼
Rust Bridge Manager
        │
        │ deeptop/1 JSONL
        ▼
DSH Host Process
        │
        ▼
Desktop Profile + deeptop-bridge
        │
        ▼
One Cordis Tree
```

- DSH 负责 Session、Agent、Tool、Model、Storage、Workspace、Skill、Goal、Provider、Projection、事件和持久化。
- `deeptop-bridge` 运行在 DSH Cordis 树内，负责 JSONL 协议、API allowlist、Remote 转发和桌面边界适配。
- Tauri/Rust 负责进程启动、停止、重启、stdin/stdout、请求超时和系统能力。
- React 负责原生桌面交互和状态展示。

当前 `src/lib/desktop-client-runtime.ts` 已提供 loopback `remote.invoke` 和 Remote event 订阅，但这不是完整的 Client Runtime：它没有动态模块发现、Client Plugin 生命周期、Slot Registry 或外部组件加载。

### 2.2 当前明确不直接复用的 WebUI 基础设施

DSH WebUI Client 通常假设存在：

- `window.__ModuleLoader__`；
- Cordis Client Runner 和 Client Context；
- WebUI Connection、Session/Conversation 对象；
- WebUI Slot Registry；
- WebUI layout/primitives、客户端生命周期和浏览器页面环境。

这些假设不能直接套用到当前 Vite + React + Tauri 结构中。当前兼容策略文件已经把 WebUI Client Runtime、slot registry 和动态 Client bundle 列为纯桌面目标之外的内容。

本提案不是修改这个边界，而是增加一个独立的可选层：

```text
当前默认模式：
  DSH Host/Cordis -> Bridge -> 原生 React

新增可选模式：
  DSH Host/Cordis -> Bridge -> Deeptop Client Runtime -> 原生 React Slots
```

如果未来要支持“无改动运行官方 WebUI Client bundle”，仍应另设 WebUI Compatibility Mode，不应把两种 runtime 混为一谈。

---

## 3. 目标与非目标

### 3.1 目标

第一版 UI Runtime 应达到以下目标：

- 复用现有 DSH Cordis 树，不创建第二个 Agent、Session 或 Storage runtime；
- 复用官方 Host Service、ApiProxy、Remote、Projection 和事件语义；
- 允许 Host/Cordis 插件声明一个 Deeptop Client Module；
- 允许 Client Module 在指定 Slot 注册 React component；
- 支持菜单项、行尾操作、Badge、Conversation Header action、Inspector tab、Settings section；
- 支持插件启用、禁用、激活、停用、重载和 DSH 重启后的重新激活；
- 对每个插件提供能力受限的 Remote、Event、Storage 和日志 API；
- 插件加载错误、渲染错误和 Remote 错误不能使主应用崩溃；
- Session 切换时不产生旧会话状态串写；
- 在插件缺失、Host 重启、版本不兼容和模块加载失败时显示可诊断状态；
- 允许先以受信任本地插件落地，再逐步扩展到第三方插件生态。

### 3.2 非目标

第一版不做：

- 把 Node/Cordis `Context` 或 Service 对象直接暴露到 WebView；
- 让 Host 插件直接访问 React DOM、Window、Tauri API 或浏览器 Storage；
- 将整个 `apiProxy` 或任意 Typert namespace 暴露给 UI 插件；
- 兼容所有官方 WebUI Client bundle 的无修改加载；
- 支持插件在运行时安装任意 npm 依赖；
- 允许 Client Module 执行任意 Node.js 代码；
- 允许插件修改 React 主应用的任意组件树；
- 允许 Slot contribution 绕过主应用的视觉、无障碍和错误边界约束；
- 用 UI Runtime 复制 DSH 的 Session、权限、Agent 或持久化决策。

---

## 4. 设计原则

### 4.1 Cordis 负责领域，React 负责呈现

```text
需要改变 DSH 领域语义       -> Cordis Host Plugin
需要暴露官方能力             -> deeptop-bridge / Remote / Projection
需要渲染桌面组件             -> Deeptop Client Module / React
需要启动子进程或系统调用     -> Tauri/Rust 或 Bridge 边界
```

UI Runtime 只能把 Host 的状态和命令映射成桌面交互，不能在 React 中重新定义权限、Session 顺序、持久化冲突或 Agent 行为。

### 4.2 只传输可序列化协议

Cordis Realm 和 WebView Realm 之间只传：

- JSON-compatible data；
- 模块描述符；
- Slot contribution metadata；
- Remote request/response；
- Projection snapshot；
- 事件 frame；
- 错误码和诊断信息。

不能传递：

- React component function；
- Node `Context`；
- Service 实例；
- AbortController 实例；
- DOM Node；
- 任意闭包或函数引用。

### 4.3 能力显式声明

插件先声明自己需要什么，再由 Bridge 和 Client Runtime 授权：

```text
module -> requested slots
module -> requested remotes
module -> requested events
module -> storage namespace
module -> optional native capabilities
```

声明外的调用应失败，而不是依赖“插件自己保证不滥用”。

### 4.4 运行时可选，主应用可用

如果 UI Registry、某个插件或某个 Client Module 不存在：

- Agent 对话、Session 和其他核心 UI 继续工作；
- 对应 Slot 不渲染该插件；
- Inspector 显示缺失/失败原因；
- 不返回伪造的成功状态；
- 不因为一个插件失败而拒绝整个桌面启动。

### 4.5 版本和生命周期优先于热更新

先保证以下行为正确：

```text
DSH start -> UI discover -> module load -> activate -> render
DSH restart -> dispose old client state -> rediscover -> activate again
plugin disable -> deactivate -> unregister slots/events
session switch -> update scoped context -> reject stale writes
```

热更新、运行时下载和跨版本兼容应在基础生命周期稳定后再做。

---

## 5. 总体架构

### 5.1 逻辑分层

```text
┌───────────────────────────────────────────────────────────┐
│ Deeptop React Application                                 │
│                                                           │
│  App orchestration                                        │
│    ├─ SlotOutlet                                           │
│    ├─ SessionSidebar / SessionRow                          │
│    ├─ ConversationHeader                                   │
│    ├─ Inspector                                            │
│    └─ Settings                                             │
│                                                           │
│  Deeptop Client Runtime                                   │
│    ├─ ModuleLoader                                         │
│    ├─ ClientPluginRunner                                   │
│    ├─ SlotRegistry                                         │
│    ├─ PluginContext                                        │
│    ├─ ErrorBoundary                                        │
│    └─ Capability clients                                   │
└───────────────────────────────────────────────────────────┘
                         │
                  Tauri invoke/events
                         │
┌───────────────────────────────────────────────────────────┐
│ deeptop-bridge                                             │
│  ├─ ui.plugin.list                                         │
│  ├─ ui.plugin.module                                       │
│  ├─ ui.plugin.invoke                                       │
│  ├─ ui.plugin.event                                        │
│  └─ existing session/remote/projection routes              │
└───────────────────────────────────────────────────────────┘
                         │
                   Cordis Context
                         │
┌───────────────────────────────────────────────────────────┐
│ DSH Host / Cordis Tree                                    │
│  ├─ deeptop-ui-registry Service                            │
│  ├─ user Host plugins                                      │
│  ├─ Session / Agent / Workspace / Storage                  │
│  ├─ ApiProxy / Typert Gateway                              │
│  └─ Projection / Event streams                             │
└───────────────────────────────────────────────────────────┘
```

### 5.2 同一棵 Cordis 树的复用方式

UI Runtime 不在 React 侧重新初始化 Cordis。它复用当前已经运行的 DSH 子进程：

```text
DSH Child Process
  └─ one Cordis tree
      ├─ official Host services
      ├─ user Host plugins
      ├─ deeptop-bridge
      └─ deeptop-ui-registry
```

React 只通过 Bridge 访问这些服务。换句话说：

- `Session` 仍然只有 Host 的一个来源；
- Storage 仍然由 DSH Storage service 管理；
- Remote 仍然经过官方 Typert Gateway；
- Projection 仍然来自 DSH 事件和持久化语义；
- Deeptop UI Runtime 只是这些能力的 Client consumer。

### 5.3 Realm 边界

```text
Cordis Node.js Realm                 Tauri WebView Realm
────────────────────                 ───────────────────
Context                              React component
Service                              Client plugin context
Storage backend                      Client storage facade
Typert Remote                        scoped remote client
Host event stream                    client event subscription
UI contribution descriptor    --->  React Slot Registry
```

任何需要跨 Realm 的对象都必须转换为协议对象。不要尝试将 Cordis context 通过 `globalThis`、IPC 或序列化传给 WebView。

---

## 6. 插件模型

### 6.1 插件包结构

推荐的双层插件包：

```text
my-plugin/
├─ package.json
├─ manifest.json
├─ host/
│  ├─ index.mjs
│  ├─ service.mjs
│  └─ remote.mjs
├─ client/
│  ├─ index.mjs
│  ├─ components/
│  │  └─ ExampleAction.tsx
│  └─ style.css              # 可选，第一版建议由主应用主题控制
└─ dist/
   └─ client.mjs             # 发布后的单文件 Client Bundle
```

`host/index.mjs` 通过 `cordis.patch.yml` 挂载；`client/dist/client.mjs` 由 UI Registry 描述并由 Client Runtime 加载。开发时可以让 Host 和 Client 位于同一个仓库，发布时也可以拆成两个 npm package，但必须保持相同的 `pluginId`。

### 6.2 manifest

建议使用明确的、可版本化的 manifest。示例：

```json
{
  "schemaVersion": 1,
  "pluginId": "example.session-pins",
  "version": "0.1.0",
  "displayName": "Session Pins",
  "host": {
    "package": "@example/session-pins-host"
  },
  "client": {
    "entry": "dist/client.mjs",
    "format": "esm",
    "sdkVersion": "^1.0.0",
    "integrity": "sha256-..."
  },
  "ui": {
    "slots": [
      "session.context-menu",
      "session.row.trailing"
    ]
  },
  "capabilities": {
    "remotes": [
      {
        "namespace": "sessionPins",
        "methods": ["list", "toggle"]
      }
    ],
    "events": ["sessionPins/changed"],
    "storage": "session-pins"
  }
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | UI Runtime 协议版本，不能用插件版本替代 |
| `pluginId` | 全局稳定 ID，Host 和 Client 必须一致 |
| `version` | 插件自身版本，用于诊断和兼容检查 |
| `client.entry` | Client Bundle 入口，不应直接暴露任意本地路径给 React |
| `client.format` | 第一版固定为单文件 ESM |
| `client.sdkVersion` | Client SDK 主版本范围 |
| `ui.slots` | 允许插件注册的 Slot 白名单 |
| `capabilities.remotes` | 允许访问的 namespace/method 白名单 |
| `capabilities.events` | 允许订阅的事件白名单 |
| `capabilities.storage` | Host 或 Client 的命名空间标识 |
| `integrity` | 可选但推荐，用于校验外部 Bundle 未被替换 |

Manifest 是声明，不是授权本身。Bridge 仍需根据插件来源和 Profile 重新验证；Client Runtime 也需要在注册 Slot 时再次检查。

### 6.3 Host 插件声明 UI 能力

推荐新增一个 Host Service，例如 `deeptop-ui-registry`。它不是 React renderer，而是运行在 Cordis 树中的**声明和能力登记服务**。

概念接口：

```ts
interface DeeptopUiRegistry {
  registerContribution(input: UiContributionRegistration): Dispose;
  registerClientModule(input: ClientModuleRegistration): Dispose;
  list(signal?: AbortSignal): Promise<UiPluginDescriptor[]>;
  getModule(pluginId: string, signal?: AbortSignal): Promise<ClientModuleDescriptor>;
}
```

Host 插件在 `apply(ctx)` 中做的事情应该类似：

```ts
export const name = "session-pins";
export const inject = ["deeptopUiRegistry", "storageDomain", "typertGateway"];

export function apply(ctx) {
  const ui = ctx.get("deeptopUiRegistry");

  const dispose = ui.registerClientModule({
    pluginId: "example.session-pins",
    manifest: sessionPinsManifest,
    clientEntry: resolvedClientEntry,
  });

  return () => dispose();
}
```

实际注册方法应以 Cordis Service Definition 和当前 DSH 生命周期为准。上述代码表达的是职责，不是可直接复制的最终 API。

### 6.4 为什么需要 Host Registry

不能让 React 自己扫描任意目录并猜测 Host 插件对应的 Client Bundle，原因包括：

- Profile 可能启用/禁用了插件；
- Host 插件可能因为依赖失败而没有加载；
- Client Bundle 可能与 Host 版本不匹配；
- 插件可能没有获得 UI 权限；
- 需要让 DSH 重启、Plugin Inventory 和 UI Runtime 看到同一份事实；
- 需要避免从未被 Profile 启用的目录加载代码。

Registry 的意义是把“当前 Cordis 树实际提供的 UI 能力”变成一个可查询的 Host projection，而不是把文件系统当作授权源。

---

## 7. Client Runtime API

### 7.1 Client Plugin 生命周期

Client Module 采用与 DSH Client Plugin 类似的最小生命周期：

```ts
export interface DeeptopClientPlugin {
  activate(context: DeeptopClientContext): void | Promise<void>;
  deactivate?(reason?: DeactivateReason): void | Promise<void>;
}
```

生命周期状态：

```text
unseen
  -> discovered
  -> checking
  -> loading
  -> activating
  -> active
  -> deactivating
  -> disposed
```

失败状态：

```text
check-failed
load-failed
activate-failed
render-failed
remote-failed
incompatible
```

`deactivate` 必须是幂等的。任何插件注册的 Slot、事件监听、定时器和资源都应通过 `PluginScope` 自动清理；插件作者不应依赖 React unmount 才释放 Host 订阅。

### 7.2 Client Context

```ts
export interface DeeptopClientContext {
  plugin: {
    id: string;
    version: string;
    manifest: Readonly<UiPluginDescriptor>;
  };
  ui: {
    register(
      slot: DeeptopSlot,
      contribution: UiContribution,
    ): Disposable;
  };
  remote: ScopedRemoteClient;
  events: ScopedEventClient;
  storage: ScopedStorage;
  session: SessionClientContext;
  theme: ThemeContext;
  logger: PluginLogger;
  signal: AbortSignal;
}
```

Context 不应包含：

- `window` 的完整引用；
- Tauri `invoke` 原函数；
- Node `process`、`fs`、`child_process`；
- React root 或主应用 store；
- 未经筛选的 session 全量内部对象；
- 未经授权的 Remote namespace。

### 7.3 Session Context

Slot 的 context 必须是可序列化且最小的：

```ts
export interface SessionUiContext {
  sessionId: string;
  title: string;
  cwd?: string;
  running: boolean;
  blank: boolean;
  agentPreset?: string;
}
```

不同 Slot 可以有不同 context：

```ts
interface SlotContextMap {
  "session.context-menu": {
    session: SessionUiContext;
  };
  "session.row.trailing": {
    session: SessionUiContext;
    active: boolean;
  };
  "conversation.header.actions": {
    session: SessionUiContext | null;
  };
  "inspector.tabs": {
    activeSessionId: string | null;
  };
  "settings.sections": {
    settingsVersion: string;
  };
}
```

组件不应捕获旧的 `sessionId` 后在异步完成时无条件写入全局状态。Remote response 必须携带 session ID，或者由 Runtime 检查当前上下文版本。

### 7.4 Slot 类型

第一版建议只开放固定 Slot：

```text
session.sidebar.header
session.context-menu
session.row.leading
session.row.trailing
conversation.header.actions
conversation.message.actions
inspector.tabs
settings.sections
composer.actions
```

Slot 应有稳定的语义和渲染位置，不应把任意 CSS selector 或 DOM query 作为公共 API。

### 7.5 Contribution 类型

```ts
export type UiContribution =
  | {
      kind: "action";
      id: string;
      order?: number;
      label: string;
      icon?: string;
      disabled?: (context: unknown) => boolean;
      render: React.ComponentType<any>;
    }
  | {
      kind: "badge";
      id: string;
      order?: number;
      render: React.ComponentType<any>;
    }
  | {
      kind: "panel";
      id: string;
      order?: number;
      title: string;
      render: React.ComponentType<any>;
    };
```

第一版应限制 contribution kind，避免插件任意替换主应用布局。推荐优先实现：

1. `action`；
2. `badge`；
3. `panel`；
4. 后续再考虑 `form`、`command` 和 `route`。

### 7.6 Slot 注册

Client Module 激活后注册组件：

```tsx
export async function activate(ctx: DeeptopClientContext) {
  const disposeMenu = ctx.ui.register("session.context-menu", {
    kind: "action",
    id: "session-pins.toggle",
    order: 30,
    label: "置顶会话",
    render: PinSessionAction,
  });

  const disposeBadge = ctx.ui.register("session.row.trailing", {
    kind: "badge",
    id: "session-pins.badge",
    order: 10,
    render: PinnedBadge,
  });

  return () => {
    disposeMenu();
    disposeBadge();
  };
}
```

Runtime 必须执行：

- `pluginId + contribution.id` 唯一性检查；
- manifest Slot 白名单检查；
- Slot context 类型边界检查；
- order 范围和稳定排序；
- 插件停用时自动注销；
- React Error Boundary 隔离。

### 7.7 Scoped Remote

不能直接把现有任意 namespace 的 `remote.invoke` 原样交给第三方 UI 插件。推荐暴露插件范围代理：

```ts
interface ScopedRemoteClient {
  invoke<T>(method: string, args?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: (args: unknown[]) => void): Promise<Disposable>;
}
```

Runtime 自动补充 `pluginId`、namespace，并向 Bridge 请求：

```json
{
  "pluginId": "example.session-pins",
  "namespace": "sessionPins",
  "method": "toggle",
  "args": {
    "sessionId": "session-123"
  }
}
```

Bridge 根据 Host Registry 的 manifest 验证：

```text
pluginId 已注册？
namespace 是否为该插件声明？
method 是否在声明列表？
args 是否为对象？
插件是否启用？
```

验证失败必须返回稳定错误码，而不是调用 Gateway 后再依赖异常：

```text
ui-plugin-not-found
ui-plugin-disabled
ui-capability-denied
ui-remote-method-not-declared
ui-remote-invalid-args
ui-host-unavailable
```

现有的 `remote.invoke` 可以继续用于 Deeptop 内置、经过明确 allowlist 的官方 Remote；UI Plugin Runtime 应使用更窄的 `ui.plugin.invoke` 或等价受限入口。

### 7.8 Scoped Events

事件订阅同样按插件和 manifest 限制：

```ts
const dispose = await ctx.events.on(
  "sessionPins/changed",
  (args) => {
    // update plugin-local cache
  },
);
```

Runtime 不应把所有 `mux` 和 `host` 原始事件直接发给每个插件。插件只能订阅：

- manifest 声明的 Remote event；
- 为 UI Runtime 定义的稳定领域事件；
- 必要且经过脱敏的 Session event。

原始 DSH 事件仍由主应用的 `bridge-event-handler.ts` 处理，插件不应依赖内部事件名称，除非该名称被纳入正式契约。

### 7.9 Scoped Storage

Client Storage 不能直接操作 DSH 文件系统。可以提供一个命名空间客户端：

```ts
interface ScopedStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}
```

推荐：

- UI 偏好、折叠状态和临时缓存放 Client Storage；
- Session 语义、置顶 ID、标注和领域数据放 Host/Cordis Storage；
- 两者不能混用来“绕开” Host 领域服务；
- key 必须自动加上 `pluginId` 前缀；
- 值限制为 JSON；
- 设置大小和单值大小需要上限。

---

## 8. Bridge 协议与路由

### 8.1 新增路由

建议在现有 `deeptop/1` JSONL 协议上新增显式路由：

```text
ui.plugin.list
ui.plugin.module
ui.plugin.invoke
ui.plugin.event.subscribe     # 如果采用显式订阅协议
ui.plugin.storage.get
ui.plugin.storage.set
ui.plugin.storage.delete
```

第一版可以将事件复用已有 `host` event stream，减少协议变化；但仍应对 UI Plugin event 做明确过滤和类型定义。

### 8.2 `ui.plugin.list`

请求：

```json
{
  "id": "ui-1",
  "method": "ui.plugin.list",
  "payload": {}
}
```

响应：

```json
{
  "type": "response",
  "id": "ui-1",
  "response": {
    "items": [
      {
        "pluginId": "example.session-pins",
        "version": "0.1.0",
        "status": "available",
        "client": {
          "entryId": "example.session-pins/client",
          "format": "esm",
          "sdkVersion": "^1.0.0"
        },
        "slots": ["session.context-menu", "session.row.trailing"],
        "capabilities": {
          "remotes": [
            {"namespace": "sessionPins", "methods": ["list", "toggle"]}
          ],
          "events": ["sessionPins/changed"]
        }
      }
    ]
  }
}
```

`entry` 不应直接作为未经校验的绝对文件路径返回给 React。应返回 `entryId` 或由 Tauri 侧解析的受控资源 URL。

### 8.3 `ui.plugin.module`

请求：

```json
{
  "pluginId": "example.session-pins"
}
```

响应建议只返回模块元数据：

```json
{
  "pluginId": "example.session-pins",
  "entryId": "example.session-pins/client",
  "source": "deeptop-plugin://example.session-pins/client.mjs",
  "format": "esm",
  "integrity": "sha256-...",
  "sdkVersion": "^1.0.0"
}
```

不要通过 JSONL 把大型 JavaScript 源文件作为普通 RPC 字符串返回。模块资源应由 Tauri 受控资源协议提供，或在第一阶段由 Vite 静态构建进主包。

### 8.4 `ui.plugin.invoke`

请求：

```json
{
  "pluginId": "example.session-pins",
  "namespace": "sessionPins",
  "method": "toggle",
  "args": {
    "sessionId": "session-123"
  }
}
```

Bridge 路由流程：

```text
1. 校验 payload 是 object
2. 查 registry 中 pluginId
3. 检查插件状态为 active/available
4. 检查 namespace + method 声明
5. 校验 args 是 plain object
6. 调用官方 Typert Gateway
7. 保留官方错误和取消语义
8. 返回结构化结果
```

不能因为方便而将此路由实现为：

```js
return ctx.get('typertGateway').invoke(payload)
```

没有 Registry 校验的通用转发会把 UI Runtime 变成任意 Host API 执行入口。

### 8.5 事件转发

现有 Bridge 已经转发 `mux` 和 `host` 事件。新增 UI Runtime 后推荐在 Bridge 层进行二次过滤：

```text
DSH host event
  -> bridge-event-handler / UI event mux
  -> 只提取已注册的 UI plugin event
  -> host event frame
  -> Client Runtime event dispatcher
  -> 对应 plugin scope
```

事件必须带上：

```ts
interface UiPluginEventFrame {
  pluginId: string;
  event: string;
  args: unknown[];
  time: number;
  version?: number;
  sessionId?: string;
}
```

---

## 9. Client Module 加载策略

### 9.1 三种加载方式

| 方式 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| Vite 静态内置 | 最稳定、类型安全、CSP 简单 | 修改插件需要重建 Deeptop | 第一阶段 |
| Tauri 受控资源协议 | 可动态发现和加载、无需重新构建主应用 | 需要设计 URL、CSP、签名和依赖规则 | 第二阶段 |
| iframe/独立 WebView | 隔离最好 | Slot、主题、交互和性能复杂 | 第三方生态阶段 |

### 9.2 第一阶段：静态 Client Module Registry

第一阶段不做任意动态加载。插件 Client entry 通过主应用的构建注册：

```ts
const bundledClientModules = {
  "example.session-pins/client": () => import("./plugins/session-pins/client"),
};
```

Cordis Registry 返回 `entryId`，Client Runtime 使用本地 registry 找到模块。这样可以先验证：

- manifest；
- lifecycle；
- Slot；
- Remote；
- Event；
- 错误边界；
- Session 切换；

而不同时引入动态模块安全问题。

### 9.3 第二阶段：Tauri 受控插件资源协议

如果需要用户在 `$DSH_HOME` 下安装第三方 UI 插件，建议新增受控资源协议，例如：

```text
deeptop-plugin://example.session-pins/client.mjs
```

Rust/Tauri 只服务：

- 已被当前 DSH Profile 注册的 `pluginId`；
- manifest 中声明的 entry；
- manifest integrity 校验通过的文件；
- 允许的静态资源目录；
- 单文件 ESM 或明确的相对模块依赖。

WebView 的 CSP、URL 解析和 Tauri 协议 API 必须以实际 Tauri 版本验证。不能把 `file://` 绝对路径直接拼进 `import()`，也不能假设浏览器会安全地加载任意 Windows 路径。

第二阶段建议的 Bundle 约束：

- 发布为单文件 ESM；
- 依赖 `@deeptop/ui-runtime-sdk` 的稳定 external API；
- 禁止 Node built-in import；
- 禁止未经授权的动态 import；
- 资源路径只能落在插件目录；
- 加载前检查 SHA-256 integrity；
- 每个插件设置大小和加载时间上限；
- CSP 只允许 Deeptop 受控插件协议。

### 9.4 第三阶段：隔离插件

不信任的第三方插件不应使用主 React Realm 的直接组件挂载。可以采用 iframe 或独立 WebView，通过 `postMessage` / RPC 提供：

```text
render request
context update
command invoke
event delivery
theme update
unmount
```

隔离模式的 Slot 只能支持远程视图协议，不应让 iframe 直接操作主应用 DOM。它适合作为未来生态方案，不适合作为会话置顶的首个实现。

---

## 10. Slot Host 设计

### 10.1 `SlotOutlet`

主应用需要一个通用 Slot 宿主：

```tsx
<SlotOutlet
  slot="session.context-menu"
  context={{ session: toSessionUiContext(session) }}
/>
```

`SlotOutlet` 负责：

1. 从 `SlotRegistry` 读取当前 Slot contributions；
2. 按 `order`、`pluginId`、`contributionId` 稳定排序；
3. 给每个 contribution 建立 Error Boundary；
4. 注入只读 context；
5. 在插件停用或 Session 变化时重新渲染；
6. 不让一个插件异常影响同 Slot 的其他插件。

### 10.2 组件异常边界

```tsx
function SafeContribution({ contribution, context }: Props) {
  return (
    <PluginErrorBoundary
      pluginId={contribution.pluginId}
      contributionId={contribution.id}
    >
      <contribution.Component {...context} />
    </PluginErrorBoundary>
  );
}
```

错误边界应：

- 记录插件 ID、Slot、错误和当前 Session ID；
- 显示简短的“插件组件不可用”；
- 提供重新加载插件操作；
- 不显示敏感 args；
- 不吞掉主应用状态错误。

### 10.3 Slot 位置的第一批接入点

当前代码中推荐的落点：

| Slot | 宿主组件 | 用途 |
| --- | --- | --- |
| `session.context-menu` | `SessionSidebar` | 置顶、收藏、外部打开等菜单项 |
| `session.row.trailing` | `SessionRow` | 图钉、标签、插件状态 Badge |
| `session.sidebar.header` | `SessionSidebar` | 第三方筛选或统计入口 |
| `conversation.header.actions` | `ConversationHeader` | 会话级操作 |
| `conversation.message.actions` | 消息行组件 | 标注、导出、外部处理 |
| `inspector.tabs` | Inspector | 插件诊断和领域面板 |
| `settings.sections` | Settings | 插件设置 |
| `composer.actions` | Composer | 输入区辅助能力 |

不要一开始为每个 DOM 细节开放 Slot。Slot 一旦发布，后续需要长期维护兼容性。

---

## 11. 生命周期与状态机

### 11.1 Deeptop 启动

```text
Tauri setup
  -> start DSH child
  -> receive ready deeptop/1
  -> React core runtime loads
  -> ui.plugin.list
  -> validate runtime SDK versions
  -> load eligible modules
  -> activate modules
  -> mount SlotOutlet
  -> subscribe plugin events
```

UI Runtime 启动失败不能阻塞核心 Session 初始化。建议使用独立状态：

```ts
uiRuntimeStatus: "disabled" | "loading" | "ready" | "partial" | "failed"
```

### 11.2 DSH 重启

当前 DSH 重启时：

1. 停止所有 Client Plugin event subscription；
2. 调用每个插件的 `deactivate("host-restarted")`；
3. 清空 Slot Registry 中的运行时 contribution；
4. 作废旧 Remote client generation；
5. 等待新的 `ready`；
6. 重新读取 `ui.plugin.list`；
7. 重新加载并激活；
8. 重新恢复必要的 host projection。

旧 generation 的 Remote response 即使晚到，也不能写入新 Runtime。

### 11.3 插件启用/禁用

Profile 改变并不能假设 UI Runtime 自动知道所有细节。最小实现支持“刷新 DSH 后重新发现”：

```text
Profile change
  -> user refreshes/restarts DSH
  -> registry state changes
  -> ui.plugin.list returns new list
  -> removed plugin deactivates
  -> new plugin activates
```

后续可增加 `ui/plugins-changed` event，但不能省略重新校验和旧模块清理。

### 11.4 Session 切换

Slot context 的 Session 变化必须遵循：

```text
currentSessionGeneration += 1
old session scoped tasks are aborted or ignored
SlotOutlet receives new immutable context
plugin-local cache may remain, but writes are session-keyed
```

插件需要主动处理：

```ts
ctx.session.onChange((session) => {
  // clear or re-read session-specific cache
});
```

Runtime 不应让插件持有一个永久可变的“当前 Session”对象。使用 `sessionId` 和 generation 更容易检测过期操作。

---

## 12. 权限与安全模型

### 12.1 威胁模型

UI Plugin 是在主 WebView 中加载的 JavaScript。即使它来自用户自己的 DSH Profile，也必须假设：

- Bundle 可能被替换；
- 插件可能调用未声明的 Remote；
- 插件可能泄露 Session 内容；
- 插件可能阻塞或破坏 React 渲染；
- 插件可能尝试访问 Tauri 内部命令；
- 插件可能在卸载后继续持有事件监听。

直接挂载主 Realm 的 Client Bundle 只能用于“受信任插件”模式。面向不受信任生态时必须改用 iframe/独立 WebView 或更强的进程隔离。

### 12.2 必须限制的能力

| 能力 | 第一版策略 |
| --- | --- |
| Remote | manifest namespace/method 白名单 |
| Host Event | 只发送声明事件，不发全量原始流 |
| Storage | pluginId 命名空间、JSON、大小限制 |
| Tauri command | 不直接提供；通过经过审计的 UI API |
| 文件系统 | 不直接提供，使用 Host/Bridge 领域 API |
| 外链打开 | 统一经过主应用确认/安全函数 |
| 模块加载 | 受信任 Bundle + integrity + 资源白名单 |
| CSS | 主题变量和 plugin scope，禁止全局覆盖 |
| DOM | 只允许 Slot Renderer，不允许 query 主应用 DOM |

### 12.3 Remote 白名单

现有 `remote.invoke` 是桌面内部适配入口。UI Runtime 不能把它当作第三方插件的万能 API。落地时应该：

- 保留现有内置功能的显式调用；
- 增加 plugin-scoped invoke；
- 在 Bridge 根据 Registry 校验；
- 对 namespace、method、args、取消和超时进行审计；
- 将 Host 错误转换为稳定的 `DshApiError` / UI Plugin error。

### 12.4 UI 权限

可以定义：

```text
ui.slot.session.read
ui.slot.session.context-menu
ui.slot.inspector
ui.remote.declared
ui.storage.scoped
ui.external.open
```

第一版可将受信任本地插件默认设为允许，但仍保存声明和审计信息。未来设置页应显示：

```text
插件名称
来源 / 路径
版本
Host 是否启用
Client 是否兼容
可以挂载的 Slot
可以调用的 Remote
最近错误
```

---

## 13. 会话置顶参考实现

会话置顶是第一个适合验证完整链路的插件，因为它同时覆盖 Host 状态、Remote、事件、Slot、Session context 和列表排序。

### 13.1 Host 部分

Host 插件负责：

- 使用 DSH Storage 持久化 `pinnedSessionIds`；
- 提供 `sessionPins.list`；
- 提供 `sessionPins.toggle`；
- 对不存在、已删除或归档的 Session 清理状态；
- 发出 `sessionPins/changed`；
- 不直接修改 React 列表。

概念数据：

```ts
interface SessionPinsState {
  version: number;
  pinnedSessionIds: string[];
  updatedAt: number;
}
```

Remote：

```text
sessionPins.list({})
  -> { pinnedSessionIds: string[], version: number }

sessionPins.toggle({ sessionId })
  -> { sessionId, pinned: boolean, version: number }
```

### 13.2 Client 部分

Client 插件注册：

```text
session.context-menu
  -> 置顶 / 取消置顶 action

session.row.trailing
  -> 图钉 Badge
```

需要通过 `sessionPins.list` 获取初始状态，通过 `sessionPins/changed` 更新本地 Set。组件只在当前 Session context 下读取和写入。

### 13.3 排序策略

有两种策略：

#### 策略 A：主应用排序

主应用读取插件公开的 pin projection，然后在 `SessionSidebar` 中排序：

```text
pinned sessions
  -> workspace order
  -> unpinned sessions
```

优点：排序稳定、可以跨 Slot 协调；缺点：主应用需要理解该领域 projection。

#### 策略 B：插件贡献排序器

UI Runtime 提供 `session.list.sorters` 扩展点，由插件声明排序函数或返回排序权重。

第一版不建议采用任意排序函数，因为它会让多个插件的顺序、搜索结果、工作区拖拽和归档行为变得难以定义。更稳妥的第一版是：

- Host 提供 `pinnedSessionIds` projection；
- 主应用原生识别这个稳定的通用 projection；或
- 置顶先只作为 Badge/菜单，不改变主列表排序；
- 排序协议稳定后再开放。

这体现一个重要原则：UI Runtime 不等于所有业务都必须通过动态组件实现。对核心列表排序这类主应用结构语义，可以保留一个受审计的原生扩展点。

### 13.4 失败处理

- Host 插件不存在：菜单隐藏或显示“置顶功能不可用”；
- `toggle` 失败：保持原状态，显示错误提示；
- Session 被删除：事件或下次 list 时清理；
- DSH 重启：Client 缓存失效并重新 list；
- 快速点击：按 Session ID 串行化或使用 version 冲突处理；
- Session 切换：旧 toggle response 不得改变新 Session 的 Badge。

---

## 14. 推荐代码落点

以下是和当前仓库一致的拟议目录，不代表现在已经存在：

```text
src/
├─ app/
│  └─ ui-plugin-model.ts                 # 纯数据、状态和错误模型
├─ components/
│  ├─ SlotOutlet.tsx                     # Slot 宿主
│  └─ PluginErrorBoundary.tsx            # 插件组件隔离
└─ lib/
   ├─ desktop.ts                         # UI Plugin RPC 类型
   ├─ desktop-client-runtime.ts           # 现有 Remote loopback
   └─ desktop-ui-runtime/
      ├─ client-runtime.ts               # discover/load/activate/dispose
      ├─ module-loader.ts                # bundled / protocol loader
      ├─ plugin-runner.ts                # 生命周期
      ├─ plugin-context.ts               # scoped APIs
      ├─ slot-registry.ts                # contribution 注册
      ├─ capability-client.ts            # remote/event/storage
      ├─ plugin-error.ts                 # 错误归一化
      └─ types.ts                        # manifest/context/slot types

deeptop-bridge/
├─ index.mjs                             # 增加 registry 注入
├─ ui-registry.mjs                       # Cordis Host registry adapter
├─ ui-routes.mjs                         # list/module/scoped invoke
├─ routes.mjs                             # allowlist 接线
├─ bridge.mjs                             # 必要时增加 UI event filtering
└─ routes.test.mjs                        # 路由和能力校验

src-tauri/src/
└─ main.rs                               # 第二阶段受控资源协议

docs/
└─ DEEPTOP_UI_RUNTIME.md                 # 本文
```

### 14.1 Bridge 注入顺序

拟议 Profile 结构：

```yaml
- insert:
    - id: deeptop-ui-registry
      name: 'deeptop-bridge/ui-registry'

    - id: desktop-bridge
      name: 'deeptop-bridge'
```

如果 UI Registry 作为 `deeptop-bridge` 内部服务而不是单独插件，也必须保证它在用户 Host 插件调用前完成注册。实际注入顺序要根据 Cordis 的 Service Definition / Provider 规则验证，不能只依赖 YAML 文本顺序。

`deeptop-bridge/index.mjs` 可能增加：

```js
export const inject = [
  'apiProxy',
  'pluginInventory',
  'llm',
  'typertGateway',
  'workspaceRegistry',
  'sessionPersistence',
  'sessions',
  'messageAnnotations',
  'deeptopUiRegistry',
]
```

只有确认当前 DSH 能提供该 service，且缺失时有明确降级行为后，才应将依赖加入必需 `inject`。否则应采用可选依赖或能力探测，避免旧 Profile 无法启动。

### 14.2 TypeScript 契约

`src/lib/desktop.ts` 应定义最小协议：

```ts
export type UiPluginStatus =
  | "available"
  | "disabled"
  | "incompatible"
  | "load-failed"
  | "host-unavailable";

export interface DshUiPluginDescriptor {
  pluginId: string;
  version: string;
  displayName?: string;
  status: UiPluginStatus;
  entryId?: string;
  format?: "esm";
  sdkVersion?: string;
  slots: string[];
  capabilities: {
    remotes: Array<{ namespace: string; methods: string[] }>;
    events: string[];
    storage?: string;
  };
  diagnostic?: string;
}
```

不要在 React 组件中到处使用 `unknown` 猜测 manifest 字段。契约变化要同时更新 Bridge route、类型和测试。

### 14.3 App 启动集成

`App.tsx` 不应直接承担全部 ModuleLoader 逻辑。建议通过 hook 或 runtime controller：

```ts
const uiRuntime = useDeeptopUiRuntime({
  clientRuntime: desktopClientRuntime,
  enabled: settings.uiPluginsEnabled,
});
```

App 只需要提供：

- 当前 Session context；
- Slot host 所需的状态；
- Runtime status 和诊断入口；
- DSH 重启时的 generation notification。

---

## 15. 实施阶段

### Phase 0：契约冻结和 Spike

目标：不改变用户默认行为，只确认技术可行性。

任务：

- 固定 Node、DSH、Tauri 和 TypeScript 版本；
- 从当前 DSH 源码核对 Client Modules、UI Slots 和 Host Plugin API；
- 定义 `DshUiPluginDescriptor`、Slot 名称和错误码；
- 创建内存版 `SlotRegistry`；
- 创建一个内置 bundled Client Module；
- 在测试组件中渲染 `SlotOutlet`；
- 验证 DSH 重启和 React unmount 的清理。

验收：

- 不引入动态文件加载；
- 一个 Client Module 可以 activate/deactivate；
- 一个 contribution 可以注册、渲染、注销；
- 插件抛错不会破坏主应用。

### Phase 1：内置受信任插件

目标：实现端到端双层插件，但 Client Module 随 Deeptop 构建。

任务：

- 新增 `deeptop-ui-registry` Host service；
- Bridge 增加 `ui.plugin.list` 和 scoped invoke；
- `desktop-client-runtime.ts` 增加 UI Plugin client；
- 实现 `SlotOutlet` 和 Error Boundary；
- 实现 `session-pins` 示例插件；
- 接入 `session.context-menu` 和 `session.row.trailing`；
- 完成 Session generation、Host restart 和 disable 状态；
- 增加 Inspector 插件状态页面。

验收：

- Cordis Profile 挂载 Host 后，React 能发现对应 Client module；
- Remote 只能调用声明的方法；
- DSH 重启后插件能重新激活；
- 插件异常不影响 Session 对话；
- `npm run build`、Bridge tests 和 UI runtime tests 通过。

### Phase 2：动态受控 Client Bundle

目标：允许受信任用户插件无需重建 Deeptop。

任务：

- 设计 `deeptop-plugin://` 受控资源协议；
- 设计 Bundle 目录、entry、integrity 和版本校验；
- 配置 WebView CSP；
- 限制单文件 ESM 和依赖范围；
- 增加安装/启用/禁用/卸载状态；
- 在设置页展示来源和权限；
- 对加载失败和恶意路径做测试。

验收：

- 不能加载未注册 pluginId；
- 不能穿越插件目录；
- integrity 不匹配时拒绝加载；
- 插件禁用后资源和 Slot 都不可用；
- 不依赖 `file://` 绝对路径；
- Windows 和 Unix-like 路径行为一致。

### Phase 3：生态和隔离

目标：支持更广泛的第三方插件。

任务：

- iframe/独立 WebView 隔离模式；
- 插件签名或来源信任模型；
- SDK 文档和脚手架；
- API compatibility matrix；
- 性能预算和资源回收；
- 插件诊断、日志导出和崩溃恢复。

Phase 3 之前，不应把主 WebView Client Realm 视为不受信任插件沙箱。

---

## 16. 测试计划

### 16.1 Host / Bridge 测试

需要覆盖：

- UI Registry 不存在时 Bridge 的能力探测；
- `ui.plugin.list` 返回已启用插件；
- 未注册 pluginId 被拒绝；
- 未声明 namespace 被拒绝；
- 未声明 method 被拒绝；
- 非 object args 被拒绝；
- Host Remote 错误原样保留；
- AbortSignal 继续传到 Gateway；
- 插件禁用后不能 invoke；
- Profile 重载后的清单变化；
- Bridge dispose 后不再发送 UI event。

### 16.2 Client Runtime 测试

需要覆盖：

- manifest SDK 兼容；
- Client module load 成功和失败；
- activate 抛错；
- deactivate 幂等；
- Slot 注册重复 ID；
- 非 manifest Slot 注册；
- 插件注销后 contribution 消失；
- 一个组件 Error Boundary 不影响其他插件；
- event listener 自动释放；
- old generation response 被丢弃；
- DSH restart 后重新 discover/activate。

### 16.3 React Slot 测试

需要覆盖：

- Slot 无 contribution 时不改变当前布局；
- 多插件按稳定顺序渲染；
- Session context 更新；
- 活跃 Session 和非活跃 Session 的 context 正确；
- context menu 关闭后 contribution 不残留；
- Inspector/Settings 插件失败时主页面仍可操作；
- 键盘焦点、aria label 和主题变量。

### 16.4 安全测试

需要覆盖：

- 目录穿越；
- 未知协议；
- integrity mismatch；
- 超大 manifest；
- 超大 Storage value；
- 远程 namespace/method fuzz；
- 非 JSON args；
- 插件尝试调用未声明 Tauri command；
- 插件卸载后旧事件回调仍被调用；
- CSP 拒绝未授权模块。

### 16.5 手工验收矩阵

| 场景 | 预期 |
| --- | --- |
| 无 UI 插件的旧 Profile | Deeptop 核心功能不变 |
| 只有 Host、没有 Client | Host 能工作，UI contribution 显示 unavailable |
| Client 版本不兼容 | 插件不激活，主应用可用 |
| DSH 启动失败 | 不进入 UI plugin loading 假成功 |
| DSH 运行中重启 | 旧插件清理，新 Host ready 后重新激活 |
| Session 快速切换 | 旧插件响应不覆盖当前 Session |
| 插件组件抛异常 | 只显示该插件错误边界 |
| Remote 超时 | 保留错误状态，可重试 |
| 禁用插件 | Slot、事件和 Remote 都失效 |
| 插件被删除 | 清单刷新后正确卸载 |

---

## 17. 兼容和迁移策略

### 17.1 与现有 `remote.invoke` 的关系

现有 `desktop-client-runtime.ts` 的 `remote.invoke` 继续保留，用于 Deeptop 核心功能适配和已审计的官方 Remote。UI Runtime 新增 scoped client，不应要求现有业务全部迁移：

```text
核心 Deeptop UI
  -> desktopClientRuntime.remote.invoke(namespace, method, args)

第三方/动态 UI Plugin
  -> pluginContext.remote.invoke(method, args)
  -> ui.plugin.invoke(pluginId, declared namespace/method, args)
```

### 17.2 与当前原生 React 入口的关系

UI Runtime 不要求把现有 Settings、SessionSidebar、ConversationHeader 重写成插件。现有核心 UI 仍由 Deeptop 自己维护，Slot 作为增量扩展：

```text
核心 UI = 稳定、受控、内置
插件 UI = 固定 Slot、可卸载、能力受限
```

如果某项功能最终成为桌面核心（例如所有用户都需要的会话置顶），可以先通过插件验证，再把稳定的领域契约和 UI 入口提升为原生功能；不必永久保留动态层。

### 17.3 与官方 DSH WebUI 的关系

可复用的概念：

- Client Module；
- Client Plugin lifecycle；
- Slot registration；
- Remote/Event/Projection client；
- Profile 与 Host Plugin 的组合。

不直接承诺复用的实现：

- `window.__ModuleLoader__`；
- 官方 WebUI Connection/Session 对象；
- 官方 Client Context 实例；
- 官方 WebUI layout/primitives；
- 官方 WebUI bundle 的任意动态依赖；
- WebUI 专属 slot 名称和 DOM 假设。

版本说明、实际包名和官方接口必须在 DSH 版本升级时重新对照官方文档和源码：

- [DSH Client Modules](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.md)
- [Client Modules 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md)
- [DSH UI Slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-slots/README.md)
- [DSH Client README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/README.md)

---

## 18. 开发者插件示例

下面是目标形态的伪代码。它表达最终 API 方向，不能在当前仓库直接运行。

### 18.1 Host 入口

```ts
export const name = "session-pins";
export const inject = [
  "storageDomain",
  "sessions",
  "typertGateway",
  "deeptopUiRegistry",
];

export function apply(ctx) {
  const service = createSessionPinsService(ctx);

  const disposeUi = ctx.get("deeptopUiRegistry").registerClientModule({
    pluginId: "example.session-pins",
    manifest,
    clientEntry: resolveClientBundle(),
  });

  return () => {
    disposeUi();
    service.dispose();
  };
}
```

### 18.2 Client 入口

```tsx
import { createElement } from "react";

export async function activate(ctx) {
  const menu = ctx.ui.register("session.context-menu", {
    kind: "action",
    id: "session-pins.toggle",
    order: 30,
    label: "置顶会话",
    render: PinAction,
  });

  const badge = ctx.ui.register("session.row.trailing", {
    kind: "badge",
    id: "session-pins.badge",
    order: 10,
    render: PinnedBadge,
  });

  return () => {
    menu();
    badge();
  };
}

function PinAction({ session, runtime }) {
  const [pinned, setPinned] = runtime.react.useState(() => false);

  runtime.react.useEffect(() => {
    let disposed = false;
    void runtime.remote.invoke("list", {})
      .then((result) => {
        if (!disposed) {
          setPinned(result.pinnedSessionIds.includes(session.sessionId));
        }
      });
    return () => { disposed = true; };
  }, [session.sessionId]);

  return (
    <button
      type="button"
      onClick={() => void runtime.remote.invoke("toggle", {
        sessionId: session.sessionId,
      })}
    >
      {pinned ? "取消置顶" : "置顶会话"}
    </button>
  );
}
```

实际 SDK 不应把 React hooks 作为运行时对象的动态属性暴露。更合理的正式 API 是 Client Bundle 与 Deeptop 使用同一套 React peer dependency，并由 `PinAction` 直接 import React。上面的 `runtime.react` 只是为了强调：组件必须在 Deeptop 支持的 React Runtime 中运行，不能携带第二套 React root。

### 18.3 manifest

```ts
export const manifest = {
  schemaVersion: 1,
  pluginId: "example.session-pins",
  version: "0.1.0",
  client: {
    entry: "dist/client.mjs",
    format: "esm",
    sdkVersion: "^1.0.0",
  },
  ui: {
    slots: ["session.context-menu", "session.row.trailing"],
  },
  capabilities: {
    remotes: [
      { namespace: "sessionPins", methods: ["list", "toggle"] },
    ],
    events: ["sessionPins/changed"],
    storage: "session-pins",
  },
};
```

---

## 19. 完成标准

只有满足以下条件，才可以宣称 Deeptop 已实现第一版 UI Runtime：

### 架构

- [ ] Host Plugin、Bridge、Client Runtime 和 React Slot 的职责分层明确；
- [ ] UI Runtime 与当前 DSH Host 共用同一子进程和 Cordis 树；
- [ ] 没有在 React/Rust 中复制 Session、Agent、权限或持久化决策；
- [ ] 没有直接加载未审计的 WebUI Client bundle。

### 协议

- [ ] UI Plugin manifest 有版本、来源、Slot 和能力声明；
- [ ] `ui.plugin.list`、module metadata 和 scoped invoke 有显式契约；
- [ ] Bridge 对 pluginId、namespace、method、args 和状态做校验；
- [ ] 事件、Remote、取消和错误可测试；
- [ ] DSH 重启时旧 generation 不会写入新状态。

### UI

- [ ] 至少两个 Slot 可用；
- [ ] Slot contribution 可排序、注销和错误隔离；
- [ ] Session context 和 Session switching 正确；
- [ ] 插件组件不会覆盖主应用全局布局；
- [ ] 无插件时当前 UI 完全可用。

### 安全

- [ ] 第一阶段明确采用受信任内置 Bundle；
- [ ] 动态加载前有来源、路径、格式和 integrity 规则；
- [ ] UI 插件没有任意 Tauri、Node 或文件系统权限；
- [ ] Storage 和 Remote 都是 scoped；
- [ ] 未声明能力调用会失败。

### 工程

- [ ] 有 Bridge、Client Runtime、Slot 和安全测试；
- [ ] 有一个完整示例插件，例如 Session Pins；
- [ ] DSH、Tauri 和 SDK 版本兼容范围已记录；
- [ ] `PROJECT_GUIDE.md`、`DSH_NATIVE_COORDINATION.md`、`DEEPTOP_UI_RUNTIME.md`、`PLUGIN_COMPATIBILITY.md` 和 `WEBUI_PARITY.md` 已同步；
- [ ] `npm run build`、`npm run test:bridge` 和新增测试通过。

---

## 20. 建议的实际起步顺序

不要先实现动态加载器。建议按以下顺序落地：

1. 在 `src/lib/desktop-ui-runtime` 建立纯内存 Slot Registry 和生命周期测试；
2. 在 React 中接入一个 `SlotOutlet`，先放在 `SessionSidebar` 的 context menu；
3. 写一个完全内置的 `session-pins` Client Module；
4. 将 `session-pins` 的 Host 状态放进 Cordis Storage，并通过受限 Remote 访问；
5. 增加 `deeptop-ui-registry` 和 `ui.plugin.list`，让清单来源变成 Cordis；
6. 增加 `ui.plugin.invoke`，严格限制 manifest 声明的方法；
7. 覆盖 DSH restart、Session switching、plugin failure 和 disable；
8. 只有这些行为稳定后，才实现受控资源协议和外部 Client Bundle；
9. 如果未来需要不信任插件，再设计 iframe/独立 WebView 隔离，而不是继续扩大主 WebView 权限。

这条路线可以最大限度复用当前 Deeptop 的 Cordis、Bridge、Remote、Projection 和 React 架构，同时避免把 WebUI 的浏览器运行时假设直接带入桌面端。
