# Cordis 与 UI Runtime 重构计划

## 当前基线

`master` 已合并 `feature/desktop-ui-runtime`，合并提交为 `a9177bd53a`。当前运行时由一个 DSH Host/Cordis 进程、`deeptop-bridge`、Tauri Bridge Manager 和 React 桌面 UI 组成。UI Runtime 已提供 `deeptop-ui-registry`、受限 `ui.plugin.*` 路由、Scoped Remote/Storage/Settings、Client Module 生命周期、错误隔离和受控 `deeptop-plugin://` Bundle 加载。

当前真正挂载到主界面的 Slot 包括 `session.context-menu`、`conversation.message.actions` 和 `settings.sections`；后者由 `SettingsPluginSectionNav`/`SettingsPluginSectionPanel` 承载，一个 `panel` 贡献同时成为设置导航项和内容面板，主程序不再需要为每个插件设置面板写代码。其它 Slot 仍需要宿主组件逐步接入。没有 UI Plugin 时，核心会话流程必须保持不变。

## 重构目标

1. 让 DSH 领域状态、持久化、Remote 和事件由 Cordis Host Plugin 所有。
2. 让 React 只负责 Projection 映射、交互和 Slot 宿主，不在 `App.tsx` 中维护可复用领域决策。
3. 让 `deeptop-bridge` 只负责已登记的桌面协议、参数校验和原生边界适配。
4. 让 UI Plugin 只能通过固定 Slot、声明的 Remote、声明的事件和命名空间 Storage 扩展界面。
5. 保持旧 Profile 数据可恢复，插件缺失、重启、取消和失败不能伪造成功状态。

## 第一批：会话置顶

### 现状问题

会话置顶原先由平铺的 Bridge `routes.mjs` 私有读写 `$DSH_HOME/profiles/deeptop/session-pins.json`，并在 Bridge 路由中维护串行写入、工作区清理和会话清理。这样持久化领域逻辑与路由、工作区 API 装饰耦合，不能被其它 Host Consumer 复用。

### 已采用的目标结构

```text
cordis/session-pins/
  index.mjs -> SessionPinsService
    storageDomain: session_pins
    workspaceRegistry: workspaceRegistry
    legacy JSON one-time import
    ordered per-workspace pin records
    mutation queue and cleanup
        |
        +-- ../desktop-bridge/routes.mjs: workspace list/mutation decoration and request forwarding
        +-- UI Runtime: future session row Badge/context-menu contribution
```

`SessionPinsService` 使用 `session_pins` domain。每个工作区对应一条 `{ sessionIds }` 记录，global 标记 `legacyImported` 保证旧 JSON 只导入一次。旧文件中的未知工作区或未归属会话不会在读取时被伪造成有效置顶；列表投影仍按当前工作区的 `sessionIds` 过滤。

现有 `workspace.setSessionPinned` 路由和前端返回字段保持不变，因此本批重构不改变 React 的排序、拖拽、搜索和置顶行为。Bridge 只通过 `ctx.get('sessionPins')` 调用服务，工作区删除、会话迁移和归档删除仍在成功提交后调用服务清理。

### 验收

- Deeptop Profile 启动并挂载 `deeptop-bridge/session-pins`。
- Tauri 物化所有 Bridge exports，旧 Profile 首次启动时导入 `session-pins.json`。
- 置顶/取消置顶、工作区列表装饰、会话迁移和删除清理保持原有结果。
- 置顶写入在服务缺失或初始化失败时明确失败；列表读取可以按无置顶降级，不伪造写入成功。
- 服务销毁前关闭新的 mutation，等待已接受写入并关闭 domain。
- 根目录测试覆盖旧数据解析、重复数据过滤和有效成员过滤；Bridge 测试覆盖服务委托、列表装饰和路由兼容。真实 Service 初始化、domain 持久化和销毁由 Deeptop Profile 的 DSH 运行时验证。

## 第二批：消息注记 UI Consumer（已完成）

Host Service `message-annotations.mjs` 保持注记的 compare-and-set、Session identity 检查和持久化顺序。内置 `message-annotations-ui` Host Plugin 已登记 `conversation.message.actions`，内置 Client Module 通过受限 `messageAnnotations` Remote 读取和修改注记；`ConversationTranscript` 只提供最小消息 context 与 App-owned Popup/notice facade。

组件级专项测试已补齐：`message-annotations-client.test.mjs` 验证 Action/Badge 的激活、渲染、停用清理、Popup 取消，以及 list 在首次 render 与订阅建立之间完成时的 mounted Badge 重渲染；`message-annotation-store.test.mjs` 验证 Session 代际保护、同代慢 list 不覆盖较新 mutation、A → B → A 的迟到读取、Host 版本冲突回填和 store dispose。Store 的 Session listener、cache 与订阅由 `dispose()` 清理，并绑定 Client Module 的 `AbortSignal`。`desktop-ui-runtime.test.mjs` 还覆盖 Host down 时在慢插件 teardown 前同步撤销 Slot、事件、Session listener、Remote/Storage、声明式 invoke 与 Host prompt；module load、activate、deactivate 及迟到 cleanup 均有界，异步 event/Session handler 失败不会阻断 sibling。Host lifecycle 使用 availability epoch、listener-first 状态补种与 listener 注册退避，覆盖快速 down/up/down、共享 Runtime stale owner 及 disabled → enabled 重启。`message-annotations-host.test.mjs` 使用当前 Tauri 内嵌运行时和 Deeptop Profile 真实启动 DSH，验证 A → B → A 后释放旧 A 响应、Host 重启后的持久注记重新加载、空 Session 和插件缺失降级；该验收同时确保 Tauri 物化 Bridge 的所有本地 ESM 依赖。外部 UI Plugin 不能通过该 facade 访问 Tauri、Node 或任意 App 状态。

## 第三批：官方领域 UI Consumer

按风险顺序接入以下 Slot：

| Slot | 首批 Consumer | Host 依赖 |
| --- | --- | --- |
| `conversation.message.actions` | Message Feedback、Message Annotations | `messageFeedback`、`messageAnnotations` Remote |
| `conversation.header.actions` | Plan、Session Stats、Goal | Projection、Plan/Goal Remote |
| `settings.sections` | Provider、Agent Preset、Skill、插件设置 | Settings、Credentials、LLM、Preset、Skill；已挂载 |
| `inspector.tabs` | Permission、Goal、Subagent、Runtime diagnostics | Projection、Remote、事件 |
| `composer.actions` | Commands、Plan、Skill、引用候选 | Commands、Session、Skill、Reference Remote |

每个 Consumer 先复用官方 Host/Remote/Projection，不把 WebUI Client Runner、ModuleLoader 或 slot 生命周期引入主应用。

## 明确保留在桌面内置层

Terminal PTY、Git 命令、Workspace Files、文件保存、目录选择、剪贴板、外链、通知、托盘、窗口行为、更新、Dock 布局和桌宠依赖 Tauri 或主窗口所有权。它们可以拥有独立的桌面扩展接口，但不应通过 Cordis UI Plugin 直接取得任意 Tauri API。

## 每批变更的检查

代码变更至少运行对应的 Node 测试、`npm run test:bridge`、`npm run build` 和 `git diff --check`。涉及 Tauri 物化、ACL 或 Rust 命令时追加 `cargo fmt --all -- --check`、`cargo check --locked` 和相关 `cargo test --locked`。文档、Profile、Bridge export 和前端能力键必须同步更新。
