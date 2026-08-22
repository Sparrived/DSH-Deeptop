# WebUI Parity 工程清单

## 基线

- 对比对象：官方 `deepseek-ai/deepseek-harness` WebUI。
- 对比版本：`9270fce86d6a068e00b1cae955273220ceffa1a5`（`dsh-v0.1.1-rc.2`，基于官方 `dsh-v0.1.1-rc.2` 并保留 Deeptop 的 preset fork 迁移与 pi-ai 思考 tokens 补丁）。
- 运行时版本：`@deepseek-ai/dsh@0.1.1-rc.2`，由 `vendor/dsh` 子模块源码构建。
- 定位：Deeptop 是纯桌面端运行框架；WebUI 仅作为领域能力和契约参考，不把纯 WebUI Client runtime、界面和生命周期列为桌面兼容目标。
- 原则：复用现有 DSH ApiProxy、Host/Cordis 插件、Remote、Projection 和事件契约；只有桌面传输和原生 UI 边界做必要适配。

详细兼容边界和待改造清单见 [PLUGIN_COMPATIBILITY.md](PLUGIN_COMPATIBILITY.md)。

## 当前已具备

- 会话创建、打开、历史恢复、重命名、整会话分叉、归档和事件流更新。
- 基础会话搜索、模型/思考程度选择、发送、排队、Steer、停止和删除队列项。
- 原生工作区选择与注册、通用工具审批、通用问题回答。
- 基础轨迹、Skill 目录、Subagent 历史/追问/中断、Goal 生命周期、Preset 和运行时设置面板。
- 工作区分组/平铺、折叠、工作区排序、会话拖拽排序、全文搜索摘要和侧栏宽度持久化。
- assistant/chunk 文本与 reasoning 流式拼装、历史向前分页、尾部跟随暂停、消息复制/分叉、图片附件和图片渲染。
- 队列编辑、后台 Job 状态菜单、Workflow 成员卡、生成文件卡片、JSON 会话导出。
- Provider 凭据安全写入/清除、自定义 Provider 创建/移除、Base URL/协议/模型列表编辑和模型发现。
- Light/Dark/System 本地主题切换，并可导入/加载外部 CSS 主题、自定义背景与文字。
- 输入区 GoalBar 与常驻 Goal 摘要条，与 Goal 管理面板互操作。
- Agent Preset 完整管理：新建、复制、删除、查看/打开文件、默认值与新会话 chip，缺失 Preset 的迁移副本流程。
- 可持久化的右栏 Dock：队列、终端（原生 PTY）、子 Agent 书签与 Git 提交图谱。
- 每消息统计条与 Token/上下文仪表盘：输入/输出、缓存命中、TTFT、Decode 速度、turns/steps 与上下文窗口。
- 消息内路径/连接识别为桌面卡片，支持复制路径、打开位置与安全打开连接；Diff 统计卡片与文件看板。
- 工作区会话置顶、后台托盘快照、更新检查与安装、关于页与快捷键设置。
- Typert Remote 兼容桥：Host 侧使用官方 Gateway 校验 `namespace/method/args`，桌面端通过 `desktopClientRuntime.remote` 调用并订阅 `host/remote-event`。

## 缺口清单

状态：`[ ]` 未实现，`[~]` 部分实现，`[x]` 已完成，`[-]` 明确排除在纯桌面兼容目标之外。

### P0：核心会话体验

- [x] Workspace/Session 树：工作区分组、折叠、平铺模式、排序、拖拽重排。
- [x] 工作区管理：选择、创建、重命名、删除、归档、会话移动和目录浏览器。
- [x] 会话搜索：防抖全文搜索、摘要片段、Host 排序和 Host 限定的结果上限。
- [x] 可调整布局：侧栏拖拽和宽度持久化、可持久化的右栏 Dock（队列/终端/子 Agent/Git、含显示与位置偏好）已完成；DockFrame 钉住模式已实现，钉住的展开面板固定为轨道旁的稳定分栏并使对话内容自动让位（未钉住 Todo 沿用既有让位规则）；WebUI 的可拖拽三栏布局明确以桌面端可拖拽 Dock 范式替代，不作为对齐目标，设置与运行时诊断仍走弹出模态 Inspector。
- [x] 对话流：`assistant/chunk` 文本/reasoning 流式拼装、Think 折叠行和实时尾部更新。
- [~] 历史分页：`load older`、尾部跟随暂停和完整导出已完成；未做长会话虚拟化。
- [x] 消息操作：复制、按 `atSeq` 分叉、assistant Like/Dislike/反馈备注，以及用户消息“重试”（从最近已完成回合分支后重发当前提示词）已完成。
- [~] 工具视图：通用 call/result、Workflow、Produced Files、Diff 统计、路径/连接卡片和文件看板已完成；终端以原生 PTY Dock 提供，Todo 有 Inspector 面板；搜索、Web、Skill 专用卡片仍未全部复刻。
- [~] Markdown/媒体：GFM、图片展示、粘贴/拖放上传和图片点击放大已完成；缺少数学公式和更完整的附件画廊。

### P1：输入和运行交互

- [x] `/` 命令菜单、通用命令目录、Skill 快捷候选、`@` Subagent 候选和键盘导航：官方 `commands/list`、`commands/execute` 已接入运行台和输入候选。
- [x] 队列：排队、Steer、编辑、删除和队列 dock 已完成。
- [~] Plan 模式、`/plan` 和运行台状态切换已接入；Plan chip 与结构化 Plan Review 仍未复刻。
- [x] 用户问题：单选/多选、自定义文本、推荐标记和 Markdown detail 已完成；逐题导航和 Plan Review intent 未由当前问题 RPC 提供。
- [~] 当前会话 Permission preset、权限投影、`/permission` 与危险权限保留确认已接入，新会话默认权限（模型/权限/工作目录/Preset）也已具备；全局设置弹窗和逐工具命令级权限 UI 仍未复刻。
- [~] Subagent：已有直接子 Agent 与 `@` 候选引用；缺少递归树、任意深度导航和懒加载。
- [x] Goal：运行台生命周期操作与输入区 GoalBar 集成均已具备（常驻 Goal 摘要条可与管理面板互操作）。
- [x] Background Jobs 列表和运行状态菜单。
- [~] Workflow Run 成员/进度卡片：状态、阶段和成员已展示，尚未支持从成员卡直接打开子会话。
- [x] Produced Files 文件卡片和“在文件夹中显示”。

### P1：设置和模型管理

- [~] Provider/模型设置：已有新增/移除、API Key 写入/清除、Base URL/协议、模型发现和模型增删；未完成官方的 schema 驱动表单和全部适配器专用字段。
- [~] Light/Dark/System 主题及持久化：桌面端本地主题及外部 CSS/背景/文字自定义已完成，尚未与 Host `ui-theme` 设置双向同步。
- [ ] 中英文语言切换和本地化资源。
- [~] 插件设置：已有原生安装流程（来源/名称/Entry 校验、安装与取消）、原始 JSON 编辑和只读清单；缺少 schema 驱动表单及插件管理卡片。
- [x] Agent Preset：选择、默认值、新建、复制、删除、查看和打开文件，以及新会话 chip 与缺失 Preset 迁移。
- [x] 消息 Like/Dislike 及反馈备注：复用官方 `messageFeedback` Remote，使用版本号做并发冲突对账。
- [~] 会话日志导出、ZIP 下载和完整会话统计：复用 RC8 的 `session-log-download` Host endpoint 与 `session-stats` projection；完整 token 统计（输入/输出/缓存/上下文窗口）、每消息 TTFT/Decode 速度与 turns/steps 已展示，会话统计条基本达到官方字段；ZIP 仍经 Bridge JSONL 路由以 Base64 缓冲交给 Tauri 原生另存为，未做原生流式/临时文件转移，也未加载 WebUI 浏览器下载插件。

### 插件兼容边界

- [x] Host/Cordis 插件：桌面 Profile 与 DSH Host 共用同一套 Service、Provider、Session 和 ApiProxy；新增插件可以继续通过 Profile 注入。
- [~] Client/Remote 插件：Remote 方法和官方转发事件已具备 loopback transport；插件需要通过 `src/lib/desktop-client-runtime.ts` 适配，不能直接把 WebUI 的 `dsh.client` bundle 当作 Vite 模块加载。
- [-] WebUI client bundle：`window.__ModuleLoader__`、Cordis client runner、slot registry、动态客户端插件生命周期和纯 WebUI 界面不属于纯桌面端兼容目标。

## 本轮实施

- [x] 建立本工程清单。
- [x] 消息级复制、按 `atSeq` 分叉和用户消息重试；重试使用新的分支会话，原会话保留且工作区/外部副作用不回滚。当前上游没有原地 truncate/retryFrom，严格删除原会话后续事件仍需上游原子 API。
- [x] 输入框 `/Skill` 和 `@Subagent` 快捷候选。
- [x] Workspace/Session 树、全文搜索、历史分页、流式 reasoning 和尾部跟随。
- [x] 队列编辑、用户问题自定义回答、后台 Jobs、Workflow、Produced Files、图片附件。
- [x] Provider 凭据、连接参数、模型发现/编辑、自定义 Provider 和本地主题。

### 本轮同步（文档与代码对齐）

- [x] 输入区 GoalBar 与常驻 Goal 摘要条（`CurrentGoalBar`）。
- [x] Agent Preset 完整管理：新建、复制、删除、查看/打开、新会话 chip 与缺失 Preset 迁移。
- [x] 可持久化右栏 Dock：队列、终端（原生 PTY）、子 Agent 书签与 Git 提交图谱。
- [x] 每消息统计条（TTFT/Decode 速度）与 Token/上下文仪表盘，`sessionStats` 完整字段接入（turns/steps/llmMs/toolMs/ttft/decode）。
- [x] 消息内路径/连接识别卡片、Diff 统计卡片与文件看板；当前会话权限弹窗与新会话默认权限。
- [x] 明确未推进，保留为缺口：Plan chip/Review、Subagent 递归树、Provider/插件 Schema 表单、数学公式/附件画廊、i18n 本地化、`ui-theme` 双向同步、ZIP 原生流传输。

## 后续顺序

1. 优先补齐非 WebUI 专属官方能力的 Remote、Projection、错误、取消和持久化恢复语义。
2. 完善已有官方能力的原生入口：Plan、Permission、完整 Session Stats 和 ZIP 原生流传输。
3. 深化 Provider/插件设置、Preset、Subagent、Goal、Workflow、Tool/Trajectory 等领域功能的原生适配。
4. 仅在明确需要 WebUI 兼容模式时，另行设计 Client runtime；不把 ModuleLoader、slot 和 WebUI 生命周期混入当前桌面架构。

## 验证要求

- `npm run build` 通过。
- 消息复制不改变会话状态；按消息分叉发送 `session.fork({ sessionId, atSeq })`。
- `/` 和 `@` 候选支持鼠标选择、Enter 选择、Escape 关闭，并保留前缀输入文本。

## 本轮实现记录

- `src/App.tsx` 为转录项保留事件 `seq`，消息级分叉调用 `session.fork({ sessionId, atSeq })`。
- `src/App.tsx` 在活动会话切换时加载 Skill，并基于当前输入 token 提供 `/`、`@` 候选。
- `src/styles.css` 增加消息操作栏和 composer 候选层；候选层不抢 textarea 焦点。
- `src/App.tsx` 接入 workspace/session 排序、历史分页、assistant/chunk 拼装、reasoning、Jobs、Workflow、Produced Files、图片附件和 JSON 导出。
- `src/App.tsx` 接入 `credentials.*`、`llm.discoverModels`、字段级 `settings.mutate`，Provider 支持自定义连接和模型写回。
- `deeptop-bridge/cordis.patch.yml` 注入官方 `message-feedback`、`session-log-download`、`session-stats` Host 插件；`standard` preset 继续提供 Windows PowerShell、文件、搜索和 Job 工具，避免 Host 重复挂载。桌面端对消息反馈、导出和统计优先复用 RC8 Host/Projection；仅保留 Tauri 原生保存对话框和 Bridge 取消适配，不加载 WebUI 浏览器下载流程。
- `src/lib/desktop-client-runtime.ts` 暴露 loopback `remote.invoke/on`，桌面端接入官方 commands、messageFeedback、permissions、plan、sessionStats 以及 ZIP 导出。
- `src/styles.css` 增加侧栏拖拽宽度、Job/Workflow/Produced Files/Provider 编辑/深色主题样式。
- 验证：`npm run build` 通过（TypeScript 与 Vite）。
- 不覆盖已有未提交改动。

## 对齐结论

当前桌面端已经覆盖 WebUI 的核心会话、工作区、输入、运行状态、Provider、媒体工作流，以及本轮选定的官方命令、反馈、权限、Plan、统计和 ZIP Host 能力；进一步补齐了输入区 GoalBar、Agent Preset 管理、右栏 Dock（终端/子 Agent/队列/Git）与完整统计条。Plan chip/Review、Schema 设置、完整本地化、Subagent 递归树、更多领域卡片和 ZIP 原生流传输仍需原生实现或优化；WebUI ModuleLoader、Client runner、slot registry 和客户端生命周期则是明确排除项。整体策略是复用官方 Host/Remote contract，在原生界面完成功能兼容，而不是加载整套 WebUI client bundle。

界面结构同理：右侧工具区由可拖拽、可持久化的 Dock 体系承载，不复刻 WebUI 三栏布局；Inspector 保持设置与诊断的模态入口。Dock 钉住模式已实现：钉住的展开面板固定为不遮挡对话流的固定分栏，钉住状态经桌面桥接持久化。
