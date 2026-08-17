# Deeptop 与 DSH 的原生协调关系

## 摘要

Deeptop 的原生化不是把 DSH 拆成一个“后端 API”再由桌面端重新实现业务，而是让 Tauri + React 成为 DSH 的一个原生消费面：

```text
React 原生 UI
   ⇅ Tauri invoke / event
Rust Bridge Manager
   ⇅ JSONL stdin/stdout（deeptop/1）
DSH Host 进程
   ⇄ Cordis services / ApiProxy / Remote / Projection / events
DSH desktop Profile
```

`deeptop-bridge` 运行在 DSH 的 Cordis 树内，所以它能直接访问 `apiProxy`、`typertGateway`、`llm`、`workspaceRegistry`、`sessionPersistence`、`sessions` 等 Host 服务。它不是独立 daemon，也不是第二个 Agent runtime。

## 1. 四层职责

| 层 | 主要职责 | 不应承担 |
| --- | --- | --- |
| DSH Host/Cordis | Agent、Session、Tool、Model、Storage、Workspace、Skill、Goal、Provider、Permission、Projection、事件和持久化 | 不负责桌面窗口布局 |
| `deeptop-bridge` | Profile 内插件、JSONL 协议、API allowlist、Remote 转发、桌面边界操作 | 不复制 Agent/Session 领域决策 |
| Tauri/Rust | 启动/停止/重启 DSH、物化 Profile、stdin/stdout、请求等待、超时、诊断和系统通知 | 不复制 DSH 服务或 React 状态模型 |
| React | 原生 UI、交互、状态展示、Projection 到界面模型的映射 | 不绕过 Bridge 直接启动 DSH 或实现权限决策 |

一个简单判断标准：

> 如果功能需要改变 DSH 的领域语义，应先进入 DSH Profile；如果只是把官方能力带到桌面 UI，才进入 Bridge/Tauri/React 适配层。

## 2. 启动协调

### 2.1 Profile 物化

Rust 启动器在 `src-tauri/src/main.rs` 中内嵌以下资源：

- `deeptop-bridge/package.json`；
- `deeptop-bridge/cordis.patch.yml`；
- Bridge 的 `index.mjs`、`bridge.mjs`、`routes.mjs` 及 Skill 相关模块；
- `desktop-profile.json`；
- 用户 Profile patch 模板。

启动时会：

1. 计算 `DSH_HOME`；
2. 创建 `$DSH_HOME/profiles/desktop`；
3. 合并 desktop Profile 的 Bundle 清单，确保 `@deepseek-ai/dsh-base` 和 `deeptop-bridge` 存在；
4. 保留用户添加的其他 Bundle；
5. 只在用户文件不存在时创建 `cordis.patch.yml`；
6. 将 Bridge 内容写到 `$DSH_HOME/profiles/node_modules/deeptop-bridge`。

这样桌面端可以按 Profile 解析 Bridge，同时又不会覆盖用户的 desktop Profile 扩展。运行时资源来自安装包内的固定 DSH 源码构建，资源目录只读；系统 Node.js 直接执行该资源中的 `@deepseek-ai/dsh/lib/bin.js`，不会使用 PATH、全局 npm、`$DSH_HOME` prefix、npm/npx 缓存或 registry。

### 2.2 DSH 子进程

Rust 通过 Tauri `resource_dir()` 定位 `dsh-runtime`，校验运行时清单、入口和包版本后直接启动系统 Node.js：

```text
node <resource-dir>/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js --profile desktop
```

进程环境包括：

- `DSH_HOME`：统一 DSH 配置和数据根目录；
- 当前目录 `$DSH_HOME`：让 DSH 配置、Profile 和数据根目录保持一致；
- `NO_COLOR=1`：避免结构化输出被颜色控制字符污染。

stdin、stdout、stderr 均为管道。Windows 下进程隐藏运行；Unix-like 系统使用进程组，便于停止子进程树。

## 3. `deeptop/1` JSONL 协议

Bridge 使用内部协议标识 `deeptop/1`。每行是一个 JSON frame。

### 3.1 Bridge -> Tauri

准备就绪：

```json
{"type":"ready","protocol":"deeptop/1"}
```

请求响应：

```json
{"type":"response","id":"desktop-1","response":{"result":{"ok":true}}}
```

事件：

```json
{"type":"event","channel":"mux","frame":{"rpcId":"...","payload":{}}}
```

诊断和错误：

```json
{"type":"diagnostic","level":"error","message":"..."}
{"type":"protocol-error","message":"..."}
{"type":"fatal","message":"..."}
```

### 3.2 Tauri -> Bridge

请求必须包含字符串 `id`、字符串 `method` 和对象 `payload`：

```json
{"id":"desktop-1","method":"session.history","payload":{"sessionId":"..."}}
```

Bridge 会拒绝无效 JSON、缺少字段的 frame 和未在 `routes.mjs` 中登记的 method。

### 3.3 超时与生命周期

Rust 的单次 Bridge 请求等待上限是 45 秒。超时会移除 pending request 并返回错误；它不会伪造 DSH 成功结果。DSH 退出时，等待中的请求会收到宿主退出错误，运行时状态变为失败。

## 4. 请求链路

一次会话历史读取的真实路径是：

```text
React
  -> bridgeRequest("session.history", payload)
  -> Tauri invoke("bridge_request")
  -> BridgeManager 写入 JSONL stdin
  -> deeptop-bridge.handleLine()
  -> routeDesktopRequest()
  -> ctx.apiProxy.sessions.history(request)
  -> DSH Host Session service / persistence
  -> response JSONL
  -> Rust pending sender
  -> Tauri invoke result
  -> React state
```

Bridge 路由只暴露必要的桌面方法。例如：

- Session：`list`、`search`、`create`、`history`、`fork`、`prompt`、`cancel`；
- Workspace：`list`、`create`、`attachSession`、`archiveSession`；
- Workbench：`skill.list`、`agentPreset.*`、`goal.*`、`settings.*`；
- Host：`host.pickDirectory`、`host.listDirectory`、`host.openPath`、`plugin.list`；
- Provider/Model：`credentials.*`、`llm.providers`、`llm.models`、`llm.discoverModels`；
- 契约适配：`remote.invoke`、`respond`。

完整 allowlist 以 `deeptop-bridge/routes.mjs` 为准。不要为了方便而把整个 `apiProxy` 对象暴露给 React。

## 5. 事件链路与 Session 隔离

DSH 的事件由 Bridge 订阅：

```js
api.events.mux(request, signal)
api.events.host(request, signal)
```

Bridge 将每个 frame 标记为 `mux` 或 `host` 后写到 stdout。Rust 识别 `event` frame 并发出 `deeptop-bridge-event`；React 的 `bridge-event-handler.ts` 根据事件类型更新会话、Projection、队列、审批、问题、Job、Workflow 和运行台状态。

事件处理必须遵守以下规则：

1. 事件的 Session ID 优先于当前 UI 选择；
2. 切换 Session 时，历史恢复和实时事件要汇合到同一状态模型；
3. 晚到的旧 Session 事件不能覆盖当前 Session；
4. Projection 需要记录序号或版本，避免低版本覆盖高版本；
5. 插件缺失、Host 错误和 DSH 重启都要转成可见的失败状态。

这也是为什么新增能力不能只在组件里临时读取一个 API 结果：它还必须考虑历史、实时事件、切换和重启。

## 6. ApiProxy、Remote 与 Projection 的协调

### 6.1 ApiProxy

官方 Host ApiProxy 是桌面端首选入口。Bridge 使用 `ctx.apiProxy` 访问 Session、Workspace、Skill、Goal、Settings、Credentials、LLM 等域，React 只调用 Bridge 的 allowlist。

这样做可以保留：

- 官方参数和返回值；
- 官方错误结构；
- Host 服务的权限和持久化语义；
- DSH 升级时的服务边界。

### 6.2 Typert Remote

对有 Remote 契约的插件，Bridge 使用 `typertGateway.invoke`：

```text
React desktopClientRuntime.remote.invoke(namespace, method, args)
  -> Bridge remote.invoke
  -> typertGateway.invoke({ namespace, method, args, signal })
  -> official Host Remote
```

React 的 `desktopClientRuntime.remote.on(event, handler)` 会过滤 `host/remote-event`，因此桌面端可以复用 Remote 事件，而不加载 WebUI 的 `dsh-client-runtime`。

Remote 接入要求：

- namespace、method 和 object args 必须经过校验；
- 参数、返回值、错误和取消语义遵守官方契约；
- 不把未经 allowlist 的任意 namespace 暴露为脚本执行入口；
- 为插件缺失和 Host 调用失败提供清晰状态。

### 6.3 Session Projection

Projection 是 DSH 对 Session 事件的领域视图。React 可以把 Projection 映射成原生 UI，但不能用本地状态重新定义它。例如：

- Permission Projection 驱动权限显示；
- Plan Projection 驱动 Plan 状态；
- Session Stats Projection 驱动统计摘要；
- Workspace/Session Projection 驱动侧栏和会话树。

当某个 Projection 尚未提供完整桌面字段时，应在适配层明确标记“部分接入”，不要用猜测值填充官方字段。

## 7. 为什么不直接加载 WebUI Client

官方 WebUI Client 依赖一组浏览器运行时假设：

- `window.__ModuleLoader__` 动态模块加载；
- Cordis client runner 和 client context；
- Connection、Session/Conversation 对象；
- slot registry、客户端插件生命周期和 WebUI layout/primitives。

Deeptop 的桌面运行时使用 Vite 打包的 React、Tauri event 和自己的状态模型，没有这些边界。直接混入 WebUI Client 会导致两套生命周期、传输、状态和 UI 组合系统同时存在。

正确策略是：

```text
复用官方 Host/Cordis + Remote + Projection + events
                  ↓
        用 desktop bridge 传输
                  ↓
        用原生 React 实现入口
```

只有未来明确需要“无改动运行 WebUI Client bundle”时，才应另行设计 WebUI compatibility mode，而不是逐步把 ModuleLoader、slot 和 client lifecycle 混入纯桌面层。

如果需要让受信任的 Cordis 插件向 Deeptop 增加桌面 React 组件，应采用独立的 Deeptop Client Runtime：复用同一棵 Cordis 树的 Host、Remote、Projection 和事件，但通过受控 Client Module、Slot Registry 和插件生命周期加载桌面组件。完整的拟议协议、权限、资源加载和分阶段实施方案见 [Deeptop UI Runtime 实现设计](DEEPTOP_UI_RUNTIME.md)。

## 8. 插件接入决策表

| 插件提供的内容 | Deeptop 做法 |
| --- | --- |
| Host/Cordis service | 加入 desktop Profile，直接复用 |
| Host + Remote | Host 加入 Profile，Remote 经 `desktopClientRuntime` 接入 |
| Projection/event | 复用官方字段和事件，在 `bridge-event-handler.ts` 做映射 |
| 只有 WebUI Client UI | 不加载 Client bundle，用原生 React 实现有价值的入口 |
| 只有 WebUI slot 注入 | 不接入纯桌面 runtime，除非未来定义兼容模式 |
| 桌面专用目录/下载/通知 | 放在 Bridge/Tauri 的边界层，并保留取消/错误状态 |

新增插件的推荐检查顺序：

1. 是否已有 Host 半包？
2. 依赖是否能在 desktop Profile 中解析？
3. 是否有 Remote namespace、Projection 或事件？
4. 是否存在插件缺失时的能力探测？
5. 是否覆盖持久化恢复、实时运行、失败、取消和快速切换？
6. 是否更新兼容文档，说明功能兼容范围？

## 9. 常见错误边界

### 插件不存在

Profile 没有服务时，Bridge 应返回“服务不可用”类错误；React 应禁用或隐藏对应操作，不应返回空的成功对象。

### DSH 重启

所有 pending 请求都可能失败；Session 列表和当前历史需要重新加载。UI 不能继续使用旧的运行时句柄，也不能把重启前的结果写进新 Session。

### Remote 超时或取消

Bridge 会把 AbortSignal 传给 Gateway/API。新增长任务时，必须确保 Tauri、Bridge、Host 三层的取消语义不会被 Base64 缓冲或无界等待吞掉。

### 版本冲突

反馈、注释和设置等可写域可能带 revision/version。React 应根据官方冲突结果重新读取或提示用户，而不是覆盖服务端的新版本。

## 10. 代码变更落点

| 需求 | 先看/修改 |
| --- | --- |
| 新 DSH 服务或 Agent 行为 | `deeptop-bridge/cordis.patch.yml`、desktop Profile |
| 新 API 路由 | `deeptop-bridge/routes.mjs`、`src/lib/desktop.ts`、`routes.test.mjs` |
| 新 Remote 能力 | `src/lib/desktop-client-runtime.ts`、`bridge-event-handler.ts` |
| 新 Projection/UI 状态 | `src/app/`、`src/App.tsx`、相关 component |
| 子进程或运行时生命周期 | `src-tauri/src/main.rs` |
| UI 样式或交互 | `src/components/`、`src/styles.css` |
| 兼容范围变化 | `PLUGIN_COMPATIBILITY.md`、`WEBUI_PARITY.md` |

## 11. 验收标准

一个非 WebUI 专属的 DSH 插件或能力达到原生兼容，至少应满足：

- Host 插件能随 desktop Profile 启动并满足官方依赖；
- Remote 方法的参数、返回值、错误和取消语义保持官方契约；
- Projection/事件在历史恢复和实时运行两条路径一致更新；
- React 原生界面能完成主要用户操作；
- 插件缺失或失败时桌面端不崩溃、不伪造成功状态；
- Bridge、模型或运行时测试覆盖关键状态；
- 文档说明了哪些内容是功能兼容，哪些内容仍不是 WebUI 视觉或生命周期兼容。
