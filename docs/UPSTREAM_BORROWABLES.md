# 上游可借鉴项清单

本清单登记官方 DSH 已经具备、Deeptop 尚未对齐的做法，以及对齐后能解决的具体问题。每一条都给出上游机制位置与 Deeptop 当前实现位置，便于直接判断改动范围。

收录判据：能落到桌面端，且不需要复制上游设计系统、上游传输层或浏览器专属能力。纯 Web 生命周期的内容见 [WEBUI_PARITY.md](../WEBUI_PARITY.md) 的排除项。

状态：`[x]` 已对齐，`[~]` 部分具备，`[ ]` 待做，`[-]` 明确不做。

## 一、界面与交互

### 1. 可停靠右栏 `[x]`

上游 `packages/client/ui-dockkit` 把右栏建模成一棵通用布局树：

- `contract/types.ts:36` 定义五个拖放落点 `DockZone = 'center' | 'top' | 'right' | 'bottom' | 'left'`；`center` 并入目标面板的标签组，其余在对应侧开出分栏。
- 叶子是 `PaneNode`（标签列表 + 至多一个激活项），内部节点是 `SplitNode`（沿 `row`/`column` 轴、按分数比例分配尺寸），`PaneHost` 区分停靠与浮动，浮动面板只多带一个视口矩形 `FloatRect`。
- 整份布局是一个不可变 `LayoutState`（`nodes`/`tabs`/`rootId`/`floats`/`activePaneId`/`expanded`/`mode`）。每次改动是一个自带新 id 的操作对象，因此从同一初始状态重放操作序列能复现完全相同的布局——撤销、重做与持久化都建立在这条性质上。
- `PaneAttachment` 记录面板原来的位置（作为既有分栏的子节点、复建一个塌缩分栏、或回到浮动层的某个 z 序），所以关闭再打开能回到原处。

Deeptop 已对齐：

- `src/app/dock-layout.ts` 是同一套状态机的纯实现：`DockZone`/`DockPaneNode`/`DockSplitNode`/`DockLayout` 与上游同构，五个落点、`row`/`column` 轴、分数尺寸、同轴分栏合流、空面板折叠与单孩子分栏提升都在这里，且全部是不修改入参、返回新对象的纯函数（新 id 由调用方传入）。`dockZoneAt` 是落点命中测试，`normalizeDockLayout` 负责持久化输入的归一化。
- 标签身份是「内容 id」而不是面板实例：同一类面板只保留一个标签，文件标签按路径去重，因此重复打开是复用并定位（`openDockTab`），与上游 `(kind, contentId)` 去重的语义一致。
- `src/components/DockRail.tsx` 渲染这棵树（标签组 + 分栏 + 分栏比例拖拽 + 落点高亮），`src/app/dock-settings.tsx` 承载布局、拖拽会话与挂载点登记，并持久化到 Tauri（`set_dock_settings`，`src-tauri/src/dock_settings.rs`），不使用浏览器存储。
- 取消钉住按钮后，固定完全靠拖拽：把浮动面板的标题栏拖进右栏即为停靠（`DockFrame` 的标题栏拖拽同时驱动卡片位移与落点解析），在右栏内拖动标签可以并入标签组或在上/下/左/右开分栏，拖出右栏即取消停靠回到浮动卡片。
- 停靠面板的正文由 `DockFrame` 挂进右栏的标签宿主，容器是 `DockFrame` 自持的游离节点，因此「浮动 ↔ 停靠」不会卸载重建内容（终端会话与 xterm 回滚缓冲、文件树展开状态都保留）。

未做：浮动面板仍是窗内浮层（复用原有浮动卡片与按面板记忆的位置），不是真实 Tauri 窗口；布局是单一全局布局，没有按会话区分；没有撤销/重做栈（模型本身支持重放，缺的是操作历史 UI）；`FloatRect` 级的位置恢复沿用原有按面板记忆。`UtilityDockShelf` 的任务/待办/交付/子 Agent 仍是 composer 内的固定标签，没有作为右栏标签类型接入——但标签类型已是数据（`DockTab.kind`），新增一种内容类型只需在渲染层登记，不再需要改硬编码白名单。

### 2. 文件在停靠标签中按行打开 `[x]`

上游删掉了 `ui-chat` 的 `DetailsPanel` 与 `ui-tool` 的 `ToolDetails`，改为在右栏开标签并定位到行：点工具行里的路径调用 `onOpenFile(path, { line })`；行号从 read 调用的 1-based `offset` 推出（读取尚未落盘时也成立）；打开时按 `(kind, contentId)` 去重，重复点击是复用并 reveal，而不是开出第二个标签。

Deeptop 已对齐：

- `src-tauri/src/main.rs` 新增 `read_workspace_file(path, line, contextLines)`，按行返回一段窗口（`startLine`/`lines`/`totalLines`/`truncated`/`binary`/`size`/`lineOutOfRange`）：字节上限 2 MiB、行数上限 2000、前 8 KiB 出现 NUL 判为二进制、CRLF 归一、越界行回退到文件末尾。读写路径与 `list_workspace_files`、`read_theme_css` 一致，都走 Tauri 原生命令而不新增 Host 路由：本地文件读取是原生系统能力，Host 侧没有可复用的文件服务，桌面的传输层与类型由 `src/lib/desktop.ts` 收口。
- `src/components/DockedFileView.tsx` 是停靠标签里的应用内预览：带行号装订线、定位行高亮并滚动到视口中央、刷新与「用 VSCode 打开」作为需要完整编辑器时的出口，并覆盖读取失败、二进制、超限、行越界与窗口截断五种状态。
- 工具路径的行号来自 `toolCallOpenLine`（`src/app/tool-call-display.ts`）：只对读取类工具取 1-based `offset`，因此只依赖调用参数，读取结果尚未落盘时同样成立。
- `src/components/DeliverablesPanel.tsx` 的主体点击改为在右栏打开，不再交给系统程序；「在文件夹中显示」保留为系统文件管理器动作。

### 3. 输入区统一提交模式 `[x]`

上游 `packages/client/ui-conversation/src/client/input/submission-policy.ts:30` 用纯函数把提交解析成实际投递方式：未运行或该传输不支持 steering 时一律 `queue`，否则按用户偏好（Queue 或 Steer，持久化在 Host 用户设置里），加速键手势取偏好的反面。普通 Enter 与主发送按钮共用同一个 `enter` 手势，所以按钮行为与 Enter 严格一致。

Deeptop 已对齐的行为：`src/app/submit-mode.ts` 提供同一判定的纯函数，`src/App.tsx` 用它决定 `session.prompt` 的 `mode`，`src/components/ComposerShell.tsx` 用它决定发送按钮的文案，因此空闲会话不会再以 `steer` 投递——`agent-loop/src/agent.ts:141` 的 `steer` 走 `send(input, 'next-step', true)`，空闲时不会报错，但会把消息归为 step 级插入而非一次正常 user 轮次。

上游区分偏好与手势：模式选择器表示**偏好**，发送按钮的 title 与 `aria-label` 表示**本次点击的实际行为**。Deeptop 把这个选择收到发送按钮右侧的上拉菜单里（`ComposerShell.tsx` 的 `mode-picker`）：只有会话运行中且草稿不是 `/` 命令行时，按钮才在图标旁显示本轮投递方式（排队/插入），箭头触发键挂在按钮右侧、菜单向上展开，空闲会话不渲染这一组，只留普通发送按钮。同一投递方式也标注在待处理消息上（`QueueDock.tsx` 按 `placement` 显示「排队」或「插入」徽标），因此队列里的消息不用点开就能看出是排队还是插入。

### 4. 统计改为图标胶囊 `[x]`

上游 `packages/client/ui-chat/src/client/chat/StatsPills.tsx` 把 composer 下方一行密集文本换成两个图标按钮（仪表盘胶囊打开时间与速度弹窗、数据库胶囊打开 token 用量弹窗），共用同一个锚定并钳制在视口内的弹窗座位。

Deeptop 已对齐：

- `src/components/StatsPills.tsx` 取代了 `ComposerShell` 下方那行文本：两个胶囊按钮分别表示时间与速度、Token 用量，共用同一个弹窗座位；座位复用 `useFloatingMenuPosition`，锚在按钮上方并在视口内钳制，弹窗挂到 `document.body`，因此不会被输入区裁切。
- 弹窗的行由 `src/app/session-metrics.ts` 推导（运行时间、模型耗时、工具耗时、首 Token、解码速度；上下文占用、输入、输出、缓存命中率、轮次与步骤），与会话看板共用同一套时长、速度与上下文百分比口径——看板里原先的三个格式化函数已收敛到这里，两处不会再各算一套。
- 弹窗底部保留「打开会话看板」出口，完整分析能力仍由 `SessionDashboard` 提供；点击同时收起轨迹面板。

量级：小。`context-meter` 与那行密集文本的样式已随之删除。

### 5. Markdown 与代码块细节 `[x]`

上游 `packages/client/ui-primitives/src/markdown/CodeBlock.tsx` 的行号用 CSS `counter(source-line)` 画在装订线上、不进入 DOM 文本，所以复制代码不会带出行号；代码块滚动容器有稳定的 `data-code-block-content` 句柄，流式更新时保持滚动位置；Markdown 图片加载失败时回退渲染作者写的 `alt` 或目标文本，并按来源作 key，使被修正的来源能够重挂载。

Deeptop 已对齐：

- 代码块渲染抽到 `src/lib/markdown-code-block.tsx`，逐行输出 `.md-code-line`，行号由 `src/styles/09-workbench-messages.css` 的 `.md-code-line::before` 用 CSS 计数器生成，因此数字不在 DOM 文本中，选中或复制得到的是源码本身；复制按钮与整块文本共用同一份行数据（`src/lib/code-block.ts` 的 `codeBlockLines()`），二者不会各算一套。
- `<pre>` 是滚动容器（`overflow: auto`），带上 `data-code-block-content` 句柄，并在每次重渲染后用 `useLayoutEffect` 恢复上一次的横向偏移——流式消息逐帧重解析 Markdown 时，代码块不会跳回左端。
- Markdown 图片改用 `MarkdownImage`（`src/lib/markdown.tsx`）：加载失败或来源缺失时渲染 `alt` 或来源文本，并记录**失败的来源**而非布尔值，使来源被修正后重新尝试加载。

量级：小。行内代码里的路径已可点（`MessageEntityLink`），消息级复制与复制菜单已有（`src/components/ConversationTranscript.tsx`）。

未做：本地路径图片的解析。浏览器无法直接读取任意本地文件，上游为此有一套本地路径图片词汇表；Deeptop 现在已有「按行/按路径读取文件内容」的原生通道（见第 2 条），但仍未接本地图片词汇表，因此 Markdown 里的本地图片路径仍落到失败回退文本。

### 6. 逐消息反馈界面 `[-]`

上游存在两套反馈：`command-feedback` 拥有会话级 `/feedback` 命令与 `feedback/record` 事件；`message-feedback` 拥有逐消息 Like/Dislike、分类与备注，通过 `messageFeedback` 一元 Remote 提供给产品界面。两者都只写会话日志、不进入模型上下文。

Deeptop 现状：会话级 `/feedback` **已经可用**——它由 `command-feedback` 提供，该插件位于 `packages/bundle/base/cordis.patch.yml:289-290` 的 base bundle 中，而 Deeptop 已经接好官方 `commands/list` 与 `commands/execute`。同处 `:187` 的 OTel 配置默认 `DSH_TELEMETRY_MODE=FEEDBACK_ONLY`，注释说明只有在用户显式反馈后才释放会话日志前缀，因此 `/feedback` 就是"把问题反馈给 DSH"的官方通道。

逐消息界面未接线：`cordis/cordis.patch.yml:20-23` 装载了 `message-feedback` Host 插件，但 `src/lib/desktop.ts:772` 只有 `DshMessageFeedbackItem` 类型，`src/` 与 `cordis/` 中没有调用点，也没有 Like/Dislike 组件。该界面记录的是本地评分，对桌面端使用价值有限，因此明确不做。

### 7. 共享文件类型分类 `[x]`

上游 `packages/client/ui-primitives/src/FileTypeIcon.tsx` 定义一份 `FileType` 联合与 `classifyFileType(path)`，附件卡片、链接字形、交付卡片与文件树共用，并由穷尽性检查兜底。

Deeptop 已对齐：`src/app/file-type.ts` 定义同一份分类表——`FileType` 联合、`fileExtension(path)`、`classifyFileType(path)` 与类别徽标 `fileTypeLabel(path)`。判定顺序与上游一致：文件名规则（`readme`/`changelog`/`contributing`）先于扩展名规则，扩展名大小写不敏感，无法识别的落到 `other`。交付卡片徽标与工作区文件树图标都读这份表，不再各写一份扩展名 switch。

未做：上游那套 28px 图形与 `CodeFileType` 细分（按工程上下文换图标，例如 Flutter）没有搬。桌面端对磁盘文件继续用现有 lucide 图标，消息里的文件链接仍是单一 `FileText` 字形，附件也只有图片一种类型，因此这两处不接分类表。

### 8. Presented 文件卡片 `[x]`

上游交付卡片主体是应用内预览，旁挂一个 chevron 菜单（用默认应用打开、在文件管理器中显示），按阶段显示状态并据此禁用菜单项，执行动作后把焦点还给预览按钮；文件管理器名称显式建模为 `finder | explorer`，不从浏览器推断操作系统。

Deeptop 已对齐：

- `src/components/PresentedFileCard.tsx` 是每条交付一行的卡片：主体按钮在右栏停靠标签中预览（第 2 条），旁挂 chevron 菜单提供「用默认应用打开」（复用 Host 的 `host.openPath`）与「在文件管理器中显示」（原生命令 `reveal_in_explorer`）。两个按钮平级，动作按钮不嵌套在可点击卡片里。
- 阶段状态建模在 `src/app/presented-file.ts`：`opening`/`opened`/`revealing`/`revealed`/`error`/`revealError` 按 `presentedPhaseKey(会话, 路径)` 记账，因此切换会话不会把上一个会话的状态带到同名路径上；进行中禁用菜单并在副标题位置显示进度，失败保留成可重试的错误色状态，执行动作后焦点回到主体按钮。
- 文件管理器名称由原生侧声明：`src-tauri/src/main.rs` 新增 `presented_host` 命令，按编译目标返回 `finder | explorer | directory`，前端不读 `navigator` 推断操作系统；只有 `directory` 时文案退化为「已打开所在文件夹」，不假装有具名文件管理器。

量级：小。底部保留的是工作目录级的「在文件夹中显示」（打开工作区本身），逐文件动作已上移到卡片菜单。

## 二、正确性教训

这些不是功能，而是上游在同期修掉的真实缺陷，实现同类逻辑时应避免重犯。

- **v3 envelope 头部顺序**：官方用例钉死 `turn/start → step/start → system/message → user/message → session/title` 的顺序、每个会话恰好一个 `system/message`，以及 `tool/result.sourceEventSeqs === [call.seq]` 且 `call.seq < result.seq`。Deeptop 只读日志不写日志，风险较低；若将来实现日志重放或重写，不得重排或丢弃这些关系。
- **`tool/ptc-dispatch*`**：嵌套子调用记录在该事件上。Deeptop 目前完全不订阅它，因此 `run_code` 内部的子调用不会显示——这是既有缺口，不是版本回归。订阅旧名 `tool/code-dispatch*` 的消费者会静默丢失这些调用。
- **作用于正在查看的会话**：上游为此专门修过一次（用被查看会话的作用域打开交付文件，而不是全局活跃会话）。Deeptop 以 `activeSessionRef` 为约定，新增跨会话异步逻辑时应复核。
- **Markdown 图片**：加载失败要回退渲染作者写的 alt 或目标文本，且 `img` 按来源作 key，源被修正后才能重挂载。
- **纯空白草稿不得提交**：`src/components/ComposerShell.tsx:281` 已按 `composer.trim()` 判断，符合预期。
- **被禁用的动作要收起 hover 提示**：发送与停止按钮直接 `disabled`，禁用瞬间正在显示的 tooltip 不会自动关闭。
- **异步导航竞态**：await 之后要重读取消状态，只保留最新的面板与会话意图；滚动恢复要跟随当前挂载的滚动容器而不是缓存节点。

## 三、上游桌面侧

### A. 启动子进程时清洗环境变量 `[x]`

上游 `apps/desktop/src/host-process.ts:109-110` 在 spawn 前过滤 `NODE_OPTIONS`、`DSH_DESKTOP_*` 以及不区分大小写的 `npm_*`/`pnpm_*`/`corepack_*`。

原因：这些变量能实质改变被监管 Node 进程的启动方式——`NODE_OPTIONS` 可以注入 `--require`、替换 loader 或直接让进程起不来；包管理器变量能改动 registry、凭据与脚本策略。父进程的环境属于"调用方的环境"，不应决定宿主如何启动。

Deeptop 已对齐：`src-tauri/src/main.rs` 的 `bundled_dsh_launch` 在设置 `DSH_HOME` 与 `DEEPTOP_DSH_RUNTIME_ROOT` 之外，按同一份名单移除上述变量；`DSH_*` 的业务变量（例如 `DSH_TOOLS_MODE`、`DSH_TELEMETRY_MODE`）不受影响。

### B. 优雅关停阶梯 `[ ]`

上游 `apps/desktop/src/host-process.ts:206-214` 的顺序是：发送 `{ type: 'shutdown' }` → 关闭父进程持有的写端 → 等待 10 秒 → `SIGTERM` → 等待 5 秒 → `SIGKILL`。其中关闭父方写端是 Windows 专有的一步，注释写明"关闭父方持有的写端才能释放 Host 正在等待的 Windows 管道读"，也就是说在 Windows 上杀掉进程不等于 IPC 干净收尾。

Deeptop 现状：`src-tauri/src/main.rs:2184-2187` 的 `terminate_process_tree` 直接调用 `taskkill /T /F`，依靠 generation 校验兜底。直接结束整棵进程树会让 Host 来不及 flush 会话日志与释放锁与句柄。

更稳的兜底是 Windows Job Object 配合 `KILL_ON_JOB_CLOSE`：它按内核对象所有权生效，而不是按 PID，因此不受 PID 复用与子进程再派生影响。

量级：中，需要改动 Rust 生命周期。相关约束：不要在子进程仍持有目录句柄时替换目录（`project-manager` 的激活流程同样遵守此点）。

### C. 原生目录选择器的前台焦点 `[-]`

上游 `packages/host/directory-picker-native/src/win32-dialog-logic.ts:84-95` 在弹出对话框前合成一次 Alt 按下与抬起：Windows 只把激活权交给前台进程，由后台进程弹出的选择器会开在所有窗口之后；若本进程已是前台，这次按键是无害的。文档标注仅在 Windows 11 验证。

Deeptop 现状：目录选择由 Tauri 主进程经 `rfd` 直接弹出，主进程即前台，不受影响。仅在将来改由被监管进程代弹原生对话框时才需要采用，因此只作记录。

## 排除项

以下内容不进入桌面端兼容目标，理由见 [WEBUI_PARITY.md](../WEBUI_PARITY.md)：

- 上游停靠库的样式与设计系统（只借状态机与几何约束）。
- 上游传输层与 HTTP 路由（`present.open`、workspaceFiles RPC 等），桌面端一律走自有 Bridge。
- 浏览器专属能力：下载、Web Storage、IndexedDB、Service Worker、`beforeunload`、浏览器权限弹窗、Blob iframe 预览运行时。
- WebUI 的 ModuleLoader、Cordis client runner、slot registry 与客户端插件动态生命周期。
