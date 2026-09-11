# 上游可借鉴项清单

本清单登记官方 DSH 已经具备、Deeptop 尚未对齐的做法，以及对齐后能解决的具体问题。每一条都给出上游机制位置与 Deeptop 当前实现位置，便于直接判断改动范围。

收录判据：能落到桌面端，且不需要复制上游设计系统、上游传输层或浏览器专属能力。纯 Web 生命周期的内容见 [WEBUI_PARITY.md](../WEBUI_PARITY.md) 的排除项。

状态：`[x]` 已对齐，`[~]` 部分具备，`[ ]` 待做，`[-]` 明确不做。

## 一、界面与交互

### 1. 可停靠右栏 `[ ]`

上游 `packages/client/ui-dockkit` 把右栏建模成一棵通用布局树：

- `contract/types.ts:36` 定义五个拖放落点 `DockZone = 'center' | 'top' | 'right' | 'bottom' | 'left'`；`center` 并入目标面板的标签组，其余在对应侧开出分栏。
- 叶子是 `PaneNode`（标签列表 + 至多一个激活项），内部节点是 `SplitNode`（沿 `row`/`column` 轴、按分数比例分配尺寸），`PaneHost` 区分停靠与浮动，浮动面板只多带一个视口矩形 `FloatRect`。
- 整份布局是一个不可变 `LayoutState`（`nodes`/`tabs`/`rootId`/`floats`/`activePaneId`/`expanded`/`mode`）。每次改动是一个自带新 id 的操作对象，因此从同一初始状态重放操作序列能复现完全相同的布局——撤销、重做与持久化都建立在这条性质上。
- `PaneAttachment` 记录面板原来的位置（作为既有分栏的子节点、复建一个塌缩分栏、或回到浮动层的某个 z 序），所以关闭再打开能回到原处。

Deeptop 现状：停靠是封闭的固定集合。`src/app/dock-pin.ts:18-21` 硬编码三个可钉面板及其侧别与默认宽度（`terminal-dock` 左 560、`workspace-files-dock` 左 480、`git-dock` 左 600），宽度钳制在 220–800；`src/components/UtilityDockShelf.tsx:58-63` 是任务/待办/交付/子 Agent 四个固定标签，同一时刻只显示一个。

差距：无法把两个面板上下或左右并排对照，无法把一个标签拖进另一个面板，无法把面板拖出成浮动层，无法按会话保存不同布局；新增一种内容类型必须改 `PINNABLE_DOCKS` 才能出现。终端与 Git 图谱目前只能各钉一个边栏或来回切换。

量级：大。这是一个独立状态机，需要决定浮动面板在桌面端是窗内浮层还是真实 Tauri 窗口，并把布局持久化改为 Tauri/DSH Storage（不能用浏览器存储）。

### 2. 文件在停靠标签中按行打开 `[ ]`

上游删掉了 `ui-chat` 的 `DetailsPanel` 与 `ui-tool` 的 `ToolDetails`，改为在右栏开标签并定位到行：点工具行里的路径调用 `onOpenFile(path, { line })`；行号从 read 调用的 1-based `offset` 推出（读取尚未落盘时也成立）；打开时按 `(kind, contentId)` 去重，重复点击是复用并 reveal，而不是开出第二个标签。

Deeptop 现状：`src/lib/bridge-contracts.ts` 没有读取文件内容的通道（只有 `host.openPath` 交给系统默认程序、`host.pickDirectory`、`agentPreset.read`、`settings.openDocument` 这类专用读取），`src/components/WorkspaceFilesPanel.tsx` 是目录树面板。因此 `src/components/DeliverablesPanel.tsx:77` 的每个文件按钮点击后是**交给系统程序打开**，Deeptop 内看不到文件内容。

差距：Agent 说"改了某文件第 42 行"时，上游在原位展开并定位，Deeptop 会弹外部编辑器由用户自行查找。

量级：中。需要先有一条按行读取文件内容的 Bridge 通道，标签宿主来自第 1 条。

### 3. 输入区统一提交模式 `[x]`

上游 `packages/client/ui-conversation/src/client/input/submission-policy.ts:30` 用纯函数把提交解析成实际投递方式：未运行或该传输不支持 steering 时一律 `queue`，否则按用户偏好（Queue 或 Steer，持久化在 Host 用户设置里），加速键手势取偏好的反面。普通 Enter 与主发送按钮共用同一个 `enter` 手势，所以按钮行为与 Enter 严格一致。

Deeptop 已对齐的行为：`src/app/submit-mode.ts` 提供同一判定的纯函数，`src/App.tsx` 用它决定 `session.prompt` 的 `mode`，`src/components/ComposerShell.tsx` 用它决定发送按钮的文案，因此空闲会话不会再以 `steer` 投递——`agent-loop/src/agent.ts:141` 的 `steer` 走 `send(input, 'next-step', true)`，空闲时不会报错，但会把消息归为 step 级插入而非一次正常 user 轮次。

上游区分偏好与手势：模式选择器（`ComposerShell.tsx` 的 `mode-picker`）表示**偏好**，发送按钮的 title 与 `aria-label` 表示**本次点击的实际行为**，仅在会话运行中、草稿可投递、且不是 `/` 命令行时才显示 Queue/Steer，其余情况保持普通发送文案。

### 4. 统计改为图标胶囊 `[-]`

上游 `packages/client/ui-chat/src/client/chat/StatsPills.tsx` 把 composer 下方一行密集文本换成两个图标按钮（仪表盘胶囊打开时间与速度弹窗、数据库胶囊打开 token 用量弹窗），共用同一个锚定并钳制在视口内的弹窗座位。

Deeptop 现状：`src/components/ComposerShell.tsx:302-306` 是那行密集文本，而分析能力已经集中在 `src/components/SessionDashboard.tsx`（上下文环形与进度、token 构成环图、输入/输出账本、时间范围切换、TTFT 与 decode 速度）。上游这条对 Deeptop 属于外观与入口调整，不新增分析能力，因此不做。

### 5. Markdown 与代码块细节 `[x]`

上游 `packages/client/ui-primitives/src/markdown/CodeBlock.tsx` 的行号用 CSS `counter(source-line)` 画在装订线上、不进入 DOM 文本，所以复制代码不会带出行号；代码块滚动容器有稳定的 `data-code-block-content` 句柄，流式更新时保持滚动位置；Markdown 图片加载失败时回退渲染作者写的 `alt` 或目标文本，并按来源作 key，使被修正的来源能够重挂载。

Deeptop 已对齐：

- 代码块渲染抽到 `src/lib/markdown-code-block.tsx`，逐行输出 `.md-code-line`，行号由 `src/styles/09-workbench-messages.css` 的 `.md-code-line::before` 用 CSS 计数器生成，因此数字不在 DOM 文本中，选中或复制得到的是源码本身；复制按钮与整块文本共用同一份行数据（`src/lib/code-block.ts` 的 `codeBlockLines()`），二者不会各算一套。
- `<pre>` 是滚动容器（`overflow: auto`），带上 `data-code-block-content` 句柄，并在每次重渲染后用 `useLayoutEffect` 恢复上一次的横向偏移——流式消息逐帧重解析 Markdown 时，代码块不会跳回左端。
- Markdown 图片改用 `MarkdownImage`（`src/lib/markdown.tsx`）：加载失败或来源缺失时渲染 `alt` 或来源文本，并记录**失败的来源**而非布尔值，使来源被修正后重新尝试加载。

量级：小。行内代码里的路径已可点（`MessageEntityLink`），消息级复制与复制菜单已有（`src/components/ConversationTranscript.tsx`）。

未做：本地路径图片的解析。浏览器无法直接读取任意本地文件，上游为此有一套本地路径图片词汇表，Deeptop 需要先有"按行/按路径读取文件内容"的 Bridge 通道（见第 2 条），否则只能像现在这样落到失败回退文本。

### 6. 逐消息反馈界面 `[-]`

上游存在两套反馈：`command-feedback` 拥有会话级 `/feedback` 命令与 `feedback/record` 事件；`message-feedback` 拥有逐消息 Like/Dislike、分类与备注，通过 `messageFeedback` 一元 Remote 提供给产品界面。两者都只写会话日志、不进入模型上下文。

Deeptop 现状：会话级 `/feedback` **已经可用**——它由 `command-feedback` 提供，该插件位于 `packages/bundle/base/cordis.patch.yml:289-290` 的 base bundle 中，而 Deeptop 已经接好官方 `commands/list` 与 `commands/execute`。同处 `:187` 的 OTel 配置默认 `DSH_TELEMETRY_MODE=FEEDBACK_ONLY`，注释说明只有在用户显式反馈后才释放会话日志前缀，因此 `/feedback` 就是"把问题反馈给 DSH"的官方通道。

逐消息界面未接线：`cordis/cordis.patch.yml:20-23` 装载了 `message-feedback` Host 插件，但 `src/lib/desktop.ts:772` 只有 `DshMessageFeedbackItem` 类型，`src/` 与 `cordis/` 中没有调用点，也没有 Like/Dislike 组件。该界面记录的是本地评分，对桌面端使用价值有限，因此明确不做。

### 7. 共享文件类型分类 `[ ]`

上游 `packages/client/ui-primitives/src/FileTypeIcon.tsx` 定义一份 `FileType` 联合与 `classifyFileType(path)`，附件卡片、链接字形、交付卡片与文件树共用，并由穷尽性检查兜底。

Deeptop 现状：`src/components/DeliverablesPanel.tsx:17-22` 的 `fileTypeLabel` 只是把扩展名大写截断成六字符徽标，附件、链接图标与文件树各自处理类型。

量级：小。桌面端对磁盘文件可能更适合系统图标，因此只借分类表。

### 8. Presented 文件卡片 `[ ]`

上游交付卡片主体是应用内预览，旁挂一个 chevron 菜单（用默认应用打开、在文件管理器中显示），按阶段显示状态并据此禁用菜单项，执行动作后把焦点还给预览按钮；文件管理器名称显式建模为 `finder | explorer`，不从浏览器推断操作系统。

Deeptop 现状：数据面已就绪（`deliverables/presented` 事件已投影为生成文件卡片），`src/components/DeliverablesPanel.tsx` 每行是一个直接交给系统打开的按钮，底部提供"在文件夹中显示"。

量级：小到中，依赖第 2 条提供应用内预览。

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
