# DSH 官方插件兼容策略

## 定位

Deeptop 是纯桌面端运行框架，目标是把 DSH 的运行时、Session、Agent、工具、模型和插件能力原生承载在 Tauri + React 桌面应用中。

本项目的兼容目标是：

- 复用官方 DSH Host/Cordis 插件及其运行时服务；
- 复用官方 ApiProxy、Typert Remote、Session Projection、事件和数据模型；
- 在桌面端用原生 Bridge 和 React UI 提供对应操作；
- 保证官方插件产生的会话数据、权限状态、命令结果和投影语义不被桌面端重新定义。

本项目不以复刻 WebUI 的客户端实现为目标。以下内容属于明确排除范围：

- `window.__ModuleLoader__` 及 WebUI 动态模块加载；
- Cordis client runner、WebUI client context 和客户端插件生命周期；
- slot registry、WebUI slot 注入和 WebUI 专用 UI 组合；
- 纯 WebUI 的布局、组件库、浏览器下载管理、语言资源和页面生命周期。

因此，“官方插件可用”不等于“官方 WebUI Client bundle 可以直接装入 Deeptop”。对有 Host 或 Remote 契约的插件，优先实现原生兼容；对只负责 WebUI 界面的插件，不引入其运行时，只实现项目确实需要的桌面功能。

## 兼容分层

| 层级 | 典型内容 | 处理方式 | 目标 |
| --- | --- | --- | --- |
| Host/Cordis 运行时 | Session、Agent、Workspace、Tool、Skill、Job、Goal、Subagent、Settings、Credential、LLM、Storage、Projection | 直接加入 desktop Profile，复用官方实现 | 原生兼容 |
| Host + Remote 契约 | Commands、Message Feedback、Permission、Plan、Session Stats、Session Log Export | Host 直接复用；Remote、Projection 和事件通过桌面 Bridge 接入 | 原生兼容 |
| 领域 Client UI | `dsh-client-ui-commands`、`dsh-client-ui-message-feedback`、`dsh-client-ui-plan`、`dsh-client-ui-settings` 等 | 复用官方契约、状态和交互语义；React 中实现桌面入口 | 功能兼容，界面原生 |
| WebUI Client 基础设施 | `dsh-client-runtime`、`dsh-cordis-client-runner`、`dsh-client-modules`、`dsh-client-ui-slots`、WebUI layout/primitives | 不直接加载；保留本地桌面运行边界 | 非兼容目标 |

### 直接复用的官方内容

只要插件提供 Host/Cordis 半包，且依赖能在 desktop Profile 中解析，就应优先直接复用，不在 Tauri 或 React 中复制其领域逻辑。当前适用范围包括：

- `dsh-session`、`dsh-agent`、`dsh-agent-presets`、`dsh-workspace`；
- `dsh-commands`、`dsh-message-feedback`、`dsh-permission-presets`、`dsh-plan-mode`；
- `dsh-session-stats`、`dsh-session-log-export`；
- `dsh-tool-pwsh`、`dsh-tool-fs`、`dsh-tool-fs-search`、`dsh-tool-jobs`、`dsh-tool-skill`；
- `dsh-skill`、`dsh-subagent`、`dsh-goal`、`dsh-jobs`、`dsh-user-questions`；
- `dsh-settings`、`dsh-credentials`、`dsh-llm`、`dsh-api-gateway`、`dsh-host-apiproxy`；
- Storage、Session Persistence、Session Projection、Attachment 和 Plugin Inventory 相关服务。

Windows 工具由现有 `standard` Agent Preset 提供。`deeptop-bridge/cordis.patch.yml` 对 Host 侧重复工具的禁用是挂载去重，不代表桌面端放弃这些官方能力。

ask_user_question、todo_write、web 搜索/抓取、workflow、plan 与 compaction 等模型可见能力同样由官方 `standard` preset 在会话内挂载；桌面端通过既有问题响应面板、Todo 面板和投影消费其结果。这些工具调用目前以通用工具卡呈现，按官方 render-intent 渲染领域卡片属于 P1 体验补齐。

### 复用官方契约、自己实现原生入口

这类插件的 Host 逻辑不应重写，但 WebUI Client 半包不能直接放入当前 React 应用。桌面端只承担传输、状态映射和交互入口：

| 能力 | 官方部分 | Deeptop 原生部分 | 当前状态 |
| --- | --- | --- | --- |
| Commands | `commands/list`、`commands/execute`、`commands/change` | 命令目录、候选菜单、执行反馈 | 已接入 |
| Message Feedback | `list`、`put`、`delete`、版本冲突 | 赞/踩、备注编辑、冲突对账 | 已接入 |
| Permission | `permissions` Projection、`/permission` | 当前会话权限弹窗、新会话默认权限、危险权限确认 | 部分接入（全局设置入口与逐工具权限 UI 未做） |
| Plan | `plan` Projection、`/plan` | 运行台状态和切换入口 | 部分接入 |
| Session Stats | `sessionStats` Projection | 每消息统计条（TTFT/Decode 速度）、Token/上下文仪表盘 | 部分接入（LLM 时间与工具时间未展示） |
| Session Log Export | Host 流式 ZIP、`/export` | Tauri 原生另存为、文件保存和状态提示 | 功能接入，ZIP 仍 Base64 缓冲，传输仍需优化 |
| Directory Picker | 官方 Host picker 和 ApiProxy | Tauri/React 选择目录入口 | 已接入 |

当前桌面适配边界集中在：

- [desktop-client-runtime.ts](src/lib/desktop-client-runtime.ts)：提供 loopback `remote.invoke` 和官方转发事件订阅；
- [routes.mjs](deeptop-bridge/routes.mjs)：校验并 allowlist 桌面 API，转发 Remote 和 Host 下载能力；
- [bridge-event-handler.ts](src/app/bridge-event-handler.ts)：把 Session Projection 和 Host 事件映射为 React 状态；
- [cordis.patch.yml](deeptop-bridge/cordis.patch.yml)：配置官方 Host 插件和桌面 Profile。

### 不直接复用的内容

`dsh-client-runtime` 和 `dsh-cordis-client-runner` 不是当前桌面端的可替换依赖。它们假定存在 WebUI 的模块加载器、客户端 Cordis 上下文、Connection、Session/Conversation 对象和 slot 系统。当前项目可以参考它们的类型和数据语义，但继续使用自己的桌面包装层。

同理，以下包可以作为领域行为和契约的参考，但不应直接当作 React 组件导入：

- `dsh-client-ui-trajectory`、`dsh-client-ui-tool`、`dsh-client-ui-workflow-run`；
- `dsh-client-ui-commands`、`dsh-client-ui-message-feedback`、`dsh-client-ui-permission-presets`、`dsh-client-ui-plan`；
- `dsh-client-ui-settings`、`dsh-client-ui-settings-plugins`、`dsh-client-ui-agent-preset`；
- `dsh-client-ui-subagent`、`dsh-client-ui-goal`、`dsh-client-ui-skill`、`dsh-client-ui-workspace`；
- `dsh-client-ui-layout`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-locale`。

这些包的“功能数据”可以继续复用；它们的 WebUI 组件、slot 注册和生命周期不属于当前项目的兼容目标。

## 当前仍需修改的内容

下面只列出非 WebUI 基础设施范围内仍有价值的原生适配工作。

### P0：协议和功能完整性

- [ ] 增加官方 Remote 能力的统一契约登记，减少每个功能在 `App.tsx` 中手写结果类型和错误处理。
- [~] 补齐 Remote 调用的取消、超时和断线重连语义：取消（AbortSignal）已在 Bridge/Remote 链路和长任务（导出）中透传，DSH 重启有终止旧进程与恢复流程；超时与断线重连的统一语义仍未完整覆盖。
- [~] 增加通用 Projection 缓存和 Session 切换隔离测试：现有 `session-runtime-state`、`message-retry` 与 `session-repair` 测试已覆盖 DSH 重启后的 stale 状态清理、切换保护和并发写入；通用 Projection 缓存仍未建立。
- [~] 增加官方插件存在/缺失时的能力探测：路由对缺失服务返回 `*-unavailable` 错误码并让 React 侧降级；统一、可查询的能力探测 API 未提供。
- [x] 消息重试：复用官方 `session.fork({ sessionId, atSeq })` 创建已完成回合前缀分支，再从持久化用户提示词重发；首条消息使用当前会话配置创建空白分支。当前 Bridge/上游 Session API 仍不直接暴露原地 truncate/retryFrom，因此原会话保留为可恢复分支，并对切换会话、重复点击和历史图片恢复做了保护。

### P1：已有官方能力的原生体验补齐

- [ ] Plan chip、Plan 状态在输入区的显示，以及结构化 Plan Review；不引入 WebUI Plan UI，而是使用现有问题响应和 Projection 在 React 中实现。
- [~] Permission 全局设置入口、当前会话权限弹窗和逐工具权限状态：当前会话权限弹窗和新会话默认权限已接入；继续复用官方权限服务和 `/permission`，不在桌面端复制权限决策逻辑，全局设置入口与逐工具权限状态未做。
- [~] 展示 `sessionStats` 的 LLM 时间、工具时间、TTFT、Decode 等完整字段：每消息统计条已展示 TTFT、Decode 速度、输入/输出/缓存与 tokens/s，token 仪表盘展示上下文窗口和 turns/steps；LLM 耗时与工具耗时已进入投影类型但尚未展示。
- [ ] 将 Session ZIP 下载从 Base64 缓冲改为原生文件流或临时文件转移，保持官方 Host 的流式和取消能力。
- [ ] 对 `/export`、命令执行、反馈写入等功能补充成功、失败、取消和 Session 切换后的可见状态。

### P1：已有桌面功能的官方契约深化

- [ ] Provider/模型设置改为使用官方 Schema 驱动表单，同时保留当前自定义 Provider 和本地凭据安全边界。
- [~] 插件设置增加 Schema 表单、启用状态、依赖失败和 Host/Remote 能力信息：原生安装流程（来源/名称/Entry 校验、安装与取消）已增加，原始 JSON 编辑保留为诊断后备；Schema 表单、启用/依赖状态仍未做。
- [x] Agent Preset 补齐新会话 chip、完整创建/复制/删除和默认值变更后的 Session 状态同步。
- [~] Subagent 补齐递归树、任意深度导航、懒加载和稳定的 `@` 引用：`@` 候选引用与书签面板已具备；继续复用官方子 Session API，递归树、任意深度导航和懒加载未做。
- [x] Goal 增加输入区 GoalBar（常驻摘要条可与管理面板互操作）。
- [ ] Workflow 成员卡支持打开对应子 Session。
- [~] Tool/Trajectory 对齐更多官方事件语义：终端（原生 PTY Dock）、文件/路径卡片、Diff 统计、Todo 面板和连接卡片已增加；搜索、Web、Skill 领域卡片仍未复刻。

### P2：桌面体验增强

- [ ] 长会话虚拟化和更细粒度历史分页缓存。
- [ ] 数学公式、附件画廊、Lightbox 和更完整的媒体预览。
- [ ] Host `ui-theme` 与本地主题双向同步。
- [ ] 中英文资源和语言切换。
- [ ] 在不引入 WebUI slot 系统的前提下，继续完善原生设置与 Dock 布局：为 DockFrame 提供可选钉住模式，使展开面板获得不遮挡对话流的固定分栏；设置与诊断保持模态 Inspector 入口。

## 明确不安排的工作

除非项目未来明确增加“WebUI 兼容模式”，否则不实现：

- WebUI `window.__ModuleLoader__`；
- 完整 Cordis client runner 和 WebUI client lifecycle；
- WebUI slot registry 及官方 Client UI bundle 的无改动动态安装；
- 为了视觉一致而引入 WebUI layout、primitives、locale 和浏览器专用下载控制器。

如果未来确实需要无改动加载官方 Client 插件，应单独设计一个 WebUI compatibility mode，不要把 ModuleLoader、slot 和生命周期逐步混入当前纯桌面架构。

## 新插件接入规则

1. 先检查官方包是否有 Host 半包、Remote 描述、Projection 或事件契约。
2. 有 Host 能力时，先加入 Profile 并验证依赖、注入顺序和运行时加载，不复制其领域逻辑。
3. 有 Remote/Projection 时，在 `desktop.ts` 定义最小类型，通过 `desktop-client-runtime` 或 allowlisted route 接入。
4. 只有 WebUI Client UI 时，评估该功能是否对桌面端有价值；有价值就用原生 React 实现入口，不加载 WebUI runtime。
5. 新适配必须覆盖持久化恢复、实时事件、插件缺失、错误、取消和快速切换 Session 等状态。
6. 适配完成后更新 [WEBUI_PARITY.md](WEBUI_PARITY.md)，同时说明哪些是功能兼容、哪些仍不是 WebUI 视觉或生命周期兼容。

## 验收标准

一个非 WebUI 专属官方插件达到原生兼容，至少需要：

- Host 插件能随 desktop Profile 启动并满足官方依赖；
- Remote 方法的参数、返回值、错误码和取消语义保持官方契约；
- Projection/事件能在历史恢复和实时运行两条路径中一致更新；
- 原生界面能完成该功能的主要用户操作；
- 插件缺失或失败时，桌面端不会崩溃，也不会伪造成功状态；
- 有针对性的 Bridge、模型或运行时测试，并在文档中标明与 WebUI 的差异。
