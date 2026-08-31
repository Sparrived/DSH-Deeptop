# Cordis/UI Runtime 重构交接文档

## 文档用途

本文用于在新会话中继续 Deeptop 的 Cordis/UI Runtime 重构。新会话应先阅读本文，再阅读 [重构计划](REFACTORING_CORDIS_UI_RUNTIME.md)、[UI Runtime 实现设计](DEEPTOP_UI_RUNTIME.md) 和 [原生协调关系](DSH_NATIVE_COORDINATION.md)。本文描述当前仓库已经落地的实现、未完成事项、不可破坏的约束和推荐执行顺序。

## 当前快照

- 工作分支：`master`。
- 最近合并提交：`a9177bd53a`，合并 `feature/desktop-ui-runtime`。
- 会话置顶 Host Plugin 提交：`d94c1e8739`。
- 消息注记 UI Consumer 提交：`ac3be1b564`。
- 本轮 Runtime 生命周期加固：`56d660c5a3`；消息注记缓存隔离：`e17b5ece93`；真实 Host 验收：`93eb0d2ac7`。最新文档提交以 `git log -5 --oneline` 为准。
- 最新分支领先数量和工作区状态以 `git status --short --branch` 为准。
- 必须保留的四个用户未提交文件：`src/App.tsx`、`src/app/tool-args-render.tsx`、`src/styles/15-final-overrides.css`、`src/styles/18-session-dashboard.css`。
- `docs/requirements/theming-pluggable.md` 另有不属于本模块的未提交改动；同样不要重置、暂存或提交。

前四个文件包含用户已有的会话看板、工具参数渲染和样式改动；后续操作不得重置、覆盖、丢弃、rebase、squash 或把这些改动错误地带入无关提交。涉及 `src/App.tsx` 时必须使用选择性暂存，并在提交前分别检查 `git diff` 和 `git diff --cached`。本轮新增文件和 UI Runtime 文件也必须按模块选择性暂存，不要用全量 `git add .`。

## 已完成的迁移

### 1. UI Runtime 分支合并

`feature/desktop-ui-runtime` 已合并到 `master`。冲突集中在 `package.json`、`deeptop-bridge/package.json`、能力标签、`SessionSidebar` 和 `SettingsPluginsPanel`。合并结果保留了主分支的完整测试清单、i18n key、Schema 设置表单和用户界面逻辑，也保留了 UI Runtime 的 `ui.plugin.*` 路由、Slot Registry、Client Module 生命周期、受控 Bundle 协议和 UI 插件状态面板。

运行时接线已补齐 `resolve_ui_plugin_bundle` 的 Tauri ACL，以及 `ui-plugin-manifest.mjs`、`ui-registry.mjs`、`ui-routes.mjs` 的 Bridge Bundle 物化。`materializes_every_local_bridge_dependency` 不仅检查 package exports，也扫描已物化模块的静态、side-effect 和动态本地 ESM import；新增或修改 Bridge 文件时必须同步检查 Rust `include_str!` 常量和 `bundled_bridge_files()` 数组。

### 2. 会话置顶迁移到 Cordis Host Plugin

`deeptop-bridge/session-pins.mjs` 提供 `SessionPinsService`，服务名为 `sessionPins`，使用 `session_pins` Storage Domain 保存工作区到有序会话 ID 的映射。服务依赖 `storageDomain` 和 `workspaceRegistry`，负责成员校验、串行 mutation、工作区清理、会话清理和服务销毁时的写入排空。

旧版 `$DSH_HOME/profiles/desktop/session-pins.json` 只在新 Domain 的 `legacyImported` 标记为 false 时导入一次。旧 JSON 的解析和成员过滤位于无依赖的 `session-pins-model.mjs`，根目录测试可以直接覆盖；真正的 Cordis Service 初始化、Domain 持久化和销毁需要通过 DSH Profile 或内嵌运行时验证。

`routes.mjs` 不再拥有置顶文件的读写和 mutation queue，只通过 `ctx.get('sessionPins')` 调用服务。`workspace.list`、工作区 mutation 返回值仍包含 `pinnedSessionIds`，所以 React 的搜索、拖拽、排序和现有置顶入口保持不变。服务缺失时列表可以按无置顶降级，但写入必须明确失败。

这是 Deeptop 自有 Host Plugin，不是 DSH 官方插件。当前置顶 UI 仍主要是主应用内置入口；后续如迁移到 Client Plugin，应先使用现有 `session.context-menu` 和 `session.row.trailing` Slot 验证，再删除内置重复逻辑。

### 3. 消息注记 UI Consumer 迁移

`deeptop-bridge/message-annotations.mjs` 继续拥有注记的持久化、目标消息校验、Session identity 检查、compare-and-set 版本冲突和 durability barrier。新增的 `message-annotations-ui.mjs` 是 Host Plugin，向 `deeptopUiRegistry` 登记插件 `deeptop.message-annotations`，声明 `conversation.message.actions` 和 `messageAnnotations.list/put/delete`。

`deeptop-bridge/ui-registry.mjs` 支持 Host-owned `remoteHandlers`。handler 只保存在 Host Registry 的私有记录中，不进入 `ui.plugin.list` 响应；`ui-routes.mjs` 仍先执行 pluginId、插件状态、namespace、method 和 JSON args 校验，校验成功后才调用 Host handler。没有 handler 时才回退到通用 `typertGateway`，因此内置注记调用不必绕行通用 Gateway。

`src/lib/desktop-ui-runtime/message-annotation-store.ts` 负责 Client 侧的按 Session 缓存、订阅、读取、修改和删除。它使用 `sessionId + generation`、per-Session load token 与 mutation revision 检查迟到结果：旧会话的成功结果可以返回给调用方并显示“保存期间会话已切换”，但不会写入当前会话的 Client cache；同一代中较慢的 list 也不能覆盖较新的 put/remove。版本冲突会先把 Host 返回的当前版本写入缓存，再把带错误码的失败交给 UI。

`src/lib/desktop-ui-runtime/message-annotations-client.tsx` 是静态内置 Client Module，通过两个 component contribution 注册注记 Badge 和编辑 Action。它只使用受限 `messageAnnotations` Remote、`context.host.prompt()` 和 `context.host.notify()`，不能访问 Tauri、Node、window 或 App 全局 store。Badge 使用 `useSyncExternalStore` 订阅 Client cache，因此 list 在首次渲染与 effect 订阅之间完成时也不会丢失更新。

`ConversationTranscript` 现在只负责在消息行和消息操作区域挂载 `SlotOutlet`，并向 `conversation.message.actions` 提供最小消息信息：`sessionId`、`messageId`、`role`、可选 `seq`。消息正文不通过通用 UI Context 暴露。`App.tsx` 中的注记 state、读取函数、版本冲突处理和 CRUD 函数已删除，原有 PopupDialog、通知、Session 切换保护由宿主 facade 复用。

## 当前 UI Runtime 接口

### Host 侧

- `deeptopUiRegistry.registerUiPlugin()`：注册经过 manifest 校验的 UI 插件描述。
- `remoteHandlers`：仅允许 manifest 已声明的 namespace/method，且只能是函数；它们是 Host 私有实现，不会序列化到 WebView。
- `ui.plugin.list`：返回插件清单和声明式 contribution。
- `ui.plugin.module`：返回 Client Module 元数据。
- `ui.plugin.invoke`：先做完整 manifest 校验，再调用 Host handler 或通用 Typert Gateway。
- `ui.plugin.storage.get/set/delete`：提供带 namespace 的 JSON Storage。

### Client 侧

`DeeptopClientContext` 暴露以下能力：

- `plugin`：当前插件 ID、版本和只读 descriptor。
- `ui.register(slot, contribution)`：通过 `PluginScope` 自动注销。
- `locale`：当前 `zh` 或 `en`，以 getter 形式读取最新值。
- `host.prompt()`：复用应用内 PopupDialog 的受控文本输入，并绑定插件及调用方 `AbortSignal`。停用后立即本地拒绝迟到结果；取消先于排队动作时不会打开 Popup，已经打开的宿主 Popup 则由主应用队列继续收尾但结果不再返回旧插件。
- `host.notify()`：复用 App 的普通提示或错误提示；context 停用后成为 no-op。
- `remote`：只允许 manifest 声明的 namespace/method，并绑定插件 `AbortSignal`；已停用 context 的调用在本地拒绝，不会到达新 Host。
- `events`：只允许 manifest 声明的事件；同步异常、异步 rejection 和错误 reporter 自身失败都与健康 sibling 隔离。
- `storage`：只允许插件声明的 namespace Storage，并绑定同一 `AbortSignal`。
- `session.current`、`session.generation`、`session.onChange()`：提供最小 Session 视图和代际保护；已停用 context 不会再次订阅或读取新 generation。
- `signal`：插件生命周期的 AbortSignal。

`SlotRenderContext` 包含 `session`、`activeSessionId`、`sessionGeneration`、可选 `message`、`locale` 和 `host`。`message` 只存在于消息操作 Slot，包含 `sessionId`、`messageId`、`role` 和可选 `seq`。

当前 `SlotOutlet` 支持 `menu-item`、`inline`、`message-actions` 和 `message-badge` 四种渲染变体。`message-actions` 只渲染 `kind: action`，`message-badge` 只渲染 `kind: badge`；声明式 contribution 在这两个消息变体中被跳过，避免把不能访问消息 context 的 Host-only action 错放入消息行。

`DesktopUiRuntime.updateSession()` 在 Session ID 变化时递增 generation；同一 Session 的 running、title 或 Projection 更新不会重新触发插件的 Session reload，但会通知 Slot 重新渲染。`onSessionChange()` 注册后会立即收到当前 Session，便于异步激活的插件补上初始化读取；插件 Session handler 的同步异常与异步 rejection 不会阻断 sibling。DSH restart 会同步撤销旧插件的 Slot、事件、Host 请求和 Session listener，清空私有 cache、递增 generation，并在 bounded teardown 完成后重新发现插件；App-owned 的最新 Session projection 会保留，让新插件在激活时立即从新 Host 重新读取。Host lifecycle coordinator 用 availability epoch 丢弃过期的 start/recovery/refresh，不会让 stale StrictMode owner 的 `stop()` 关闭新 generation。React 接线采用 listener-first + status revision：listener 建立后才以 `checkDsh()` 补种，查询期间有更新事件时丢弃旧快照；listener 注册失败会继续初始 discovery，并以 250ms 起步、5 秒封顶的可取消退避重试。`enabled` master switch 由 layout effect 先同步，禁用立即撤销能力，重新启用后从新清单完整启动。

## 不可破坏的职责边界

| 需求 | 所属层 | 迁移时的要求 |
| --- | --- | --- |
| Agent、Session、Tool、Model、Workspace、Skill、Goal、Provider、Permission、Projection、事件和领域持久化 | DSH Host/Cordis | 优先复用官方服务；新增领域语义先进入 Profile 或 Host Plugin |
| UI 插件清单、受限 Remote、Client Module 生命周期、Slot 注册 | UI Runtime/Bridge | 保持 manifest 白名单、错误隔离、注销和 DSH restart generation 保护 |
| JSONL 协议、Bridge allowlist、Host Remote 转换和协议取消 | `deeptop-bridge` | 不复制领域决策；每个新路由必须有参数校验和测试 |
| DSH 启停、窗口、托盘、PTY、文件保存、目录选择、外链、通知和系统 API | Tauri/Rust | 不让 Client Bundle 直接取得任意 Tauri 命令 |
| React 布局、输入、状态展示、原生弹窗和 Slot 宿主 | React | 只传最小 view/context；不在组件中复制 Host 的持久化和权限决策 |
| Projection 到显示模型的纯转换 | `src/app/*-model.ts` | 不调用 React、Tauri 或 Bridge |

明确保持桌面内置的功能包括 Terminal PTY、Git Dock、Workspace Files、Dock 布局、窗口行为、托盘、更新、桌宠、原生文件保存、目录选择、剪贴板和外链。它们可以有受控桌面扩展接口，但不应通过 Cordis UI Plugin 暴露任意系统能力。

## 迁移注意事项

### 工作区保护

新会话开始必须先执行 `git status --short --branch` 和 `git diff --stat`。当前四个用户文件以及 `docs/requirements/theming-pluggable.md` 都有本模块之外的未提交改动，不要使用 `git reset --hard`、`git checkout --`、`git restore`、`git clean`、rebase、squash 或全量 stash 覆盖它们。若必须修改 `App.tsx`，先读取当前文件，再使用选择性暂存；提交前确认外部改动仍位于 unstaged 区域。

不要切换到 `feature/desktop-ui-runtime`，也不要为了比较代码改动当前分支。使用 `git show feature/desktop-ui-runtime:<path>` 读取历史分支内容即可。

### DSH 与根目录测试平面

根目录没有可直接解析的 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-storage-domain` Node 包；这些依赖位于 Tauri 缓存的内嵌 DSH 运行时中。不要为了运行单测临时复制或修改 `node_modules`、`src-tauri/target` 或 `vendor/dsh`。

可无依赖测试的内容放在纯 `.ts`/`.mjs` 模块中，例如 `session-pins-model.mjs` 和 `message-annotation-store.ts`。依赖 Cordis、Storage Domain 或 DSH Service 的代码通过 Bridge 路由替身测试，并在真实 DSH Profile 启动路径中验证。

### UI Plugin 安全

Host handler 必须同时满足“代码已登记”和“manifest 已声明”两个条件。不能在 `ui.plugin.invoke` 中加入按 pluginId 的无校验任意函数表，也不能把 `clientPath`、Node 文件路径、Tauri 命令名或未过滤的 `apiProxy` 对象送到 WebView。

静态内置 Bundle 可以使用主 WebView Realm，但仍只能使用 `DeeptopClientContext`。受控资源协议加载的外部 Bundle 目前属于受信任插件模式；不要把它描述为不受信任隔离。未来第三方生态必须采用 iframe、独立 WebView 或进程隔离，不能逐步扩大主 WebView 权限。

### Session 与异步操作

所有按 Session 保存的 Client cache 都必须按 `sessionId + generation` 判断结果是否仍然有效。切换 Session 时清空当前 Session 的可见 cache，旧请求的结果不能覆盖新 Session。Host 侧的版本冲突必须保留 `current` 数据，不能简单吞掉错误或覆盖远端新版本。

插件监听、Timer、Remote 任务和 Slot contribution 必须通过运行时生命周期或 `PluginScope` 清理。停用首先同步 abort Scope；旧 context 的 `ui`、events、Session 订阅、Remote、Storage、声明式 invoke 和 Host prompt 都不得重新获得新 Host/新 Session 能力。插件 module load、activate 和 deactivate 都有 deadline，且 Host down 会主动 abort 挂起 load/activate，避免阻塞新的 recovery。若 raw load 在 timeout 后才返回，或 activate 在首轮 cleanup 后才完成，Runner 会额外执行一次独立、有界的 late cleanup；插件 `deactivate()` 因此必须幂等。禁止只依赖 React unmount；DSH restart、插件禁用、插件清单变化和 StrictMode 重复挂载都必须可重复处理。

### Host Plugin 写法

Host function plugin 使用命名导出 `name`、`inject`、`apply`，不要添加会改变 Loader 判定的 default export。所有 registry 注册、事件监听和资源拥有关系都要使用 `ctx.effect()` 或返回 disposer。Host Service 使用 `Service` 生命周期，并在 `Service.init` 中打开自己的 Domain，在 disposer 中停止接收新 mutation、等待已接受操作并关闭 Domain。

### Tauri Bridge Bundle 接线

新增 Bridge `.mjs` 时至少同步以下位置：`deeptop-bridge/package.json` 的 exports、`src-tauri/src/main.rs` 的 `include_str!` 常量、`bundled_bridge_files()` 数组、Profile patch（如果是内置插件）和 Rust 的物化测试。数组长度必须与实际数组项一致；Bridge export 的目标文件必须被物化，否则运行时启动后才会失败。

### 文档和兼容矩阵

新增或迁移 Host Plugin 后更新 `PLUGIN_COMPATIBILITY.md`；新增 Slot、Client Context 或生命周期规则后更新 `DEEPTOP_UI_RUNTIME.md`；改变层职责或物化流程后更新 `ARCHITECTURE.md`、`DSH_NATIVE_COORDINATION.md` 和 `PROJECT_GUIDE.md`。`WEBUI_PARITY.md` 只记录功能兼容，不要把 Deeptop Client Module 误写成已兼容官方 WebUI Client Runtime。

## 推荐的下一步

### P0：完成消息注记迁移（已完成）

1. ✅ `message-annotations-client.test.mjs` 覆盖 Client Module 激活后 `conversation.message.actions` 的 Action、Badge 渲染、停用后两个 contribution 消失，以及 list 在首次 render 与订阅建立之间完成时的 mounted Badge 重渲染。
2. ✅ `message-annotation-store.test.mjs` 覆盖 Host 返回当前注记后的版本冲突、同一 generation 的慢 list 不覆盖较新 mutation，以及 A(gen1) → B → A(gen3) 的迟到读取；旧编辑以稳定错误码失败，当前注记进入 Client cache，Badge 不被旧内容覆盖。
3. ✅ 已覆盖 Popup 取消：取消输入不调用 Host Remote，也不显示保存成功/保存中通知。Store 通过 `dispose()` 和 Client `AbortSignal` 清理 Session listener、cache 与订阅。
4. ✅ `desktop-ui-runtime.test.mjs` 覆盖 Host down 时在慢插件 teardown 前同步撤销 Slot、bridge event、Session listener 与 Session generation；Host coordinator 还覆盖快速 down/up、初始 catalog 失败重试、初始不可用快照和 unmount 期间的过期恢复抑制。
5. ✅ `message-annotations-host.test.mjs` 从当前 Tauri 内嵌 `0.1.1-rc.2` 归档启动隔离的 desktop Profile，覆盖真实 `ui.plugin.list`/受限 Remote、A → B → A 后才释放旧 A 响应、空 Session 不读取且不渲染、Host 进程重启后的注记重新加载，以及禁用 `message-annotations-ui` 后清单、Slot 和 Remote 同时失效。
6. ✅ 真实启动发现并修复 `ui-routes.mjs` 未被 Tauri 物化的问题；Rust 测试现在检查所有已物化 Bridge 模块的本地 ESM 依赖。行内注记 CSS 暂不单独拆分，继续复用主应用样式。

### P1：按 Slot 扩展官方领域 UI

1. `conversation.header.actions`：先迁移 Session Stats 和 Plan 的只读状态入口；Remote 写操作仍通过官方命令/Projection。
2. `settings.sections`：迁移 Provider、Agent Preset、Skill 和插件设置的独立入口；凭据继续由 Host 保管，React 不读取密钥。
3. `composer.actions`：迁移 Commands、Skill 和引用候选辅助入口；输入文本、附件和发送模式仍由 Composer 核心拥有。
4. `inspector.tabs`：迁移 Goal、Subagent 和 Runtime diagnostics 的可选面板；危险操作、取消和失败反馈必须使用主应用语义动作。
5. `session.row.trailing`：在置顶、标签和统计等确有独立演化需求时，再迁移会话行 Badge；不要让插件接管主列表排序和拖拽算法。

### 暂不执行

- 不加载 `dsh-cordis-client-runner`、`window.__ModuleLoader__` 或官方 WebUI Client bundle。
- 不把 Terminal、Git、Workspace Files、桌宠、托盘、窗口、更新和原生文件能力迁移到 Cordis UI Plugin。
- 不在没有组件级测试、重启测试和失败路径测试前宣称消息注记迁移已经完全完成。
- 不修改 `vendor/dsh`；如确需上游同步或兼容修复，先阅读 vendored instructions 和同步流程。

## 验证命令

在不触碰用户未提交改动的前提下，按变更范围运行：

```powershell
npm run test:ui-runtime
npm run test:ui-runtime:host
npm run test:bridge
npm test
npm run build
npm run i18n:check
npm run version:check
cargo fmt --all -- --check
cargo check --locked
cargo test --locked tests::every_registered_command_is_acl_listed_in_build_script
cargo test --locked tests::materializes_every_local_bridge_dependency
```

当前验证结果：完整 JavaScript 412/412、UI Runtime 与注记存储/组件专项 58/58、内嵌 desktop Host 集成专项 1/1、Bridge 专项 73/73 均通过；`npm run build`、`npm run i18n:check`、`npm run version:check`、`npm run dsh:verify`、`cargo fmt --all -- --check`、`cargo check --locked`、ACL 测试和 `materializes_every_local_bridge_dependency` 均通过。Vite 构建报告大于 500 kB 的已知 chunk 警告，Rust Windows linker 输出 linker stdout warning；两者均未影响命令成功。

## 新会话接手流程

1. 阅读根目录 `AGENTS.md`、本文和相关设计文档。
2. 执行 `git status --short --branch`，确认四个用户文件仍未被覆盖。
3. 阅读 `src/lib/desktop-ui-runtime/*`、`deeptop-bridge/ui-registry.mjs`、`ui-routes.mjs`、`message-annotations-ui.mjs` 和 `ConversationTranscript.tsx`。
4. 运行 `npm run test:ui-runtime`、`npm run test:bridge` 和 `npm run build`，确认新会话环境没有额外回归。
5. 消息注记的组件、冲突、取消、本地生命周期与真实 Host 集成验收均已完成；下一步按 P1 从 `conversation.header.actions` 的只读 Session Stats/Plan 入口中选择一个，不要直接开始多个领域的并行迁移。
6. 最新提交和验证状态以 `git log -5 --oneline` 与上文验证命令为准；四个用户文件和 `docs/requirements/theming-pluggable.md` 必须继续保持 unstaged，不得擅自重置。
7. 每个独立模块完成后先运行专项检查、审阅 diff，再创建一个 Conventional Commit；如果 `App.tsx` 同时包含用户改动，必须选择性暂存并在提交后再次确认工作区状态。
