# Deeptop 项目说明手册

> 本手册描述当前仓库实现，不是 DSH 官方 API 的替代文档。Deeptop 运行时来自 `vendor/dsh` 子模块锁定的 DSH 提交；更新子模块后应重新生成并验证 `dsh-runtime`，再检查 Profile、ApiProxy 和 Remote 契约。

## 1. 项目定位

Deeptop 是 DSH 的原生桌面工作台：

- **DSH** 提供 Agent、Session、Tool、Model、Storage、Workspace、Skill、Goal、Provider、权限和事件等领域能力；
- **Tauri/Rust** 启动并监管 DSH 子进程，负责 Profile 物化、JSONL stdin/stdout、超时、重启和桌面系统能力；
- **deeptop-bridge** 作为 Cordis Profile Bundle 运行在 DSH 内部，把 DSH Host/API 能力转换为受控的桌面协议；
- **React** 提供会话、输入、设置、运行台和 Inspector 等原生界面，并将事件映射为 UI 状态。

因此，项目的核心目标是：

> 复用 DSH 的官方运行时和契约，在桌面端提供原生交互；而不是把 WebUI 搬进 Tauri，也不是重新实现一套 Agent。

## 2. 快速开始

### 2.1 环境要求

- Node.js 22.19+ 或 24+；
- Rust/Cargo 和 Tauri 桌面开发环境；
- Node.js 在 `PATH` 中可用（npm 仅用于开发依赖安装）；
- 首次生成内嵌 DSH 运行时时可访问 npm registry，或构建机已有源码依赖缓存；
- Windows 上需要可用的 WebView2 环境。

安装依赖并启动桌面应用：

```powershell
npm install
npm run tauri:dev
```

仅启动 Vite 前端：

```powershell
npm run dev
```

Vite 浏览器预览没有 Tauri 的 `invoke`、事件通道和 DSH 子进程，只适合做 UI 开发。

### 2.2 构建与测试

```powershell
npm run dsh:sync
npm run dsh:verify
npm run build
npm run tauri:build
npm run test:bridge
npm run test:retry
npm test
npm run version:check
```

项目提供统一的 `npm test`，但暂未配置 lint 或 format 脚本。修改前端后运行 `npm run build`；修改 `deeptop-bridge` 路由、来源校验或消息重试时运行对应的专项测试。`src-tauri/tauri.conf.json` 已启用 Tauri bundle，`npm run tauri:build` 会构建原生应用和平台包。推送 `v<SemVer>` Tag 会触发 GitHub Actions 的跨平台构建、校验和 Release 发布，详见 [CI/CD 与发布](CI_CD.md)。

### 2.3 首次启动与用户流程

1. 启动 `npm run tauri:dev`，等待 DSH runtime status 进入 ready。开发命令会先从 `vendor/dsh` 生成并校验内嵌运行时，应用启动不会访问 npm registry。
2. 在 Settings/Workbench 中配置 Provider 和凭据（如果当前 Profile 暴露这些域）；凭据由 DSH API 管理，不应提交到仓库。
3. 选择或创建 Workspace。新会话使用选定目录作为 `cwd`，已存在的 Session 不会被隐式改写。
4. 创建 Session、选择模型并发送消息；运行中可通过 queue 或 steering 模式追加上下文。
5. 在 Interaction 面板处理 Approval 和 User Question；根据事件可执行单选、多选或自定义回答。
6. 用 `/skill` 选择 Skill，通过 Subagent/Goal 面板使用对应能力，用 Runtime Inspector 查看 Profile、插件和路由。
7. 通过会话操作执行 retry、fork、archive、restore、export 或删除。刷新 DSH 会重启子进程，pending request 可能失败，应重新加载当前状态。
8. 从系统托盘的“未读”“最近”或“更多”入口恢复窗口并打开对应会话；“新会话”会回到空白输入页。Windows 使用固定宽度的 Deeptop WebView 弹窗并复用当前应用主题，弹窗不可用时回退到系统原生菜单。

## 3. 代码结构

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx` | 组装桌面工作台、加载会话和订阅运行时状态 |
| `src/components/` | 会话侧栏、消息转录、输入框、设置、运行台和交互面板 |
| `src/app/` | 会话、消息、轨迹、事件、重试和设置等前端状态模型 |
| `src/lib/desktop.ts` | Tauri 命令、Bridge 请求、事件类型和 DSH 数据类型 |
| `src/lib/desktop-client-runtime.ts` | Remote loopback 调用和 Host Remote 事件订阅 |
| `src-tauri/src/main.rs` | DSH 进程管理、Profile 物化、JSONL 请求/响应、系统托盘和诊断转发 |
| `src-tauri/` | Tauri 应用配置和 Rust 工程 |
| `deeptop-bridge/index.mjs` | Cordis 插件入口和服务依赖声明 |
| `deeptop-bridge/bridge.mjs` | `deeptop/1` JSONL 协议、请求处理和事件转发 |
| `deeptop-bridge/routes.mjs` | 桌面 API allowlist、Host API 转发和原生边界操作 |
| `deeptop-bridge/cordis.patch.yml` | 内置 desktop Profile 的 DSH Host/Cordis 插件组合 |
| `deeptop-bridge/desktop-profile.json` | desktop Profile 的基础 Bundle 清单 |
| `PLUGIN_COMPATIBILITY.md` | 插件兼容分层和未完成事项 |
| `DEEPTOP_UI_RUNTIME.md` | Client Module、Slot、Bridge 能力和桌面 UI 插件的实施设计 |
| `WEBUI_PARITY.md` | 功能对齐清单和 WebUI 明确排除项 |

## 4. 启动生命周期

桌面窗口初始化时，Rust 侧创建 `BridgeManager` 并启动 DSH。启动流程如下：

```text
Tauri setup
  -> materialize_desktop_profile()
  -> discover dsh on PATH, npm global, $DSH_HOME, or npx cache
  -> npm install --prefix $DSH_HOME (only when every existing source is unavailable)
  -> launch dsh or npm exec --offline -- dsh --profile desktop
  -> pipe stdin/stdout/stderr
  -> receive { type: "ready", protocol: "deeptop/1" }
  -> emit dsh-runtime-status
  -> React starts DSH API calls
```

启动器会从 `PATH` 查找本机 Node.js 和 npm；Windows 下会直接调用 npm 的 CLI JavaScript 文件，避免依赖 shell 和 GUI 进程中的 `.cmd` 脚本解析。DSH 的 stdout 用于结构化 JSONL，stderr 转为诊断事件；非 JSONL 输出不会被当作 API 响应。

Bridge 进程退出、启动失败或请求超时后，Rust 会更新运行时状态并结束等待中的请求。应用可以调用 `refresh_dsh` 重启 DSH 子进程。

## 5. DSH_HOME 与 Profile

### 5.1 默认目录

`DSH_HOME` 由环境变量控制：

- Windows：显式设置时使用该目录，否则默认为 `%USERPROFILE%\.dsh`；
- Unix-like：显式设置时使用该目录，否则默认为 `$HOME/.dsh`。

Deeptop 使用或创建：

```text
$DSH_HOME/
├─ profiles/
│  ├─ desktop/
│  │  ├─ package.json
│  │  ├─ cordis.patch.yml       # 用户持久化扩展
│  │  └─ pnpm-workspace.yaml
│  └─ node_modules/
│     └─ deeptop-bridge/        # 应用物化的 Bridge Bundle
├─ node_modules/                 # npm prefix 下安装的 DSH 及依赖
├─ storages/                     # 默认 JSON storage 配置使用的目录
└─ ...                           # 其他 DSH 数据
```

### 5.2 物化规则

应用启动时：

- 如果 desktop Profile 不存在，则使用仓库内 `desktop-profile.json` 模板；
- 始终确保 `@deepseek-ai/dsh-base` 和 `deeptop-bridge` 位于 Bundle 列表前部；
- 保留用户添加的其他 Bundle；
- 只在用户文件不存在时写入 `profile.patch.yml` 和 workspace 文件；
- 将内置 Bridge 文件写入 `profiles/node_modules/deeptop-bridge`，以便当前 DSH 包解析；
- 每次启动都会同步内置 Bridge 文件，因此不要直接修改生成目录。

用户要添加 Cordis 插件时，应修改：

```text
$DSH_HOME/profiles/desktop/cordis.patch.yml
```

示例：

```yaml
- insert:
    - id: local-plugin
      name: 'C:/work/local-plugin/src/index.ts'
```

## 6. 当前 DSH 能力面

内置 `deeptop-bridge/cordis.patch.yml` 当前组合了以下类型的服务：

- storage、JSON storage、storage domain；
- message feedback、message annotations；
- session log export、session stats、projection cache；
- workspace、native directory picker、plugin inventory；
- Host ApiProxy 和 Cordis Host runner；
- Agent Presets、Skill installer 和桌面 Bridge。

如果历史会话引用的 Agent Preset 已被删除，桌面端不会静默改用其他 Preset；打开时会明确告知缺失项，用户选择可用替代项并确认后，才创建保留原历史的迁移副本。原会话保持不变，迁移副本可能因工具、系统提示词和能力不同而产生不同后续结果。

部分工具在 Profile patch 中标记为 disabled，是为了避免与 `standard` Agent Preset 重复挂载，并不表示桌面端放弃这些 DSH 工具。Windows PowerShell、文件、搜索和 Job 等工具由现有 Preset 提供。

## 7. API 与事件使用方式

React 侧通过 `bridgeRequest` 发送请求：

```ts
const result = await bridgeRequest<DshSessionModels>("session.models", {
  sessionId,
});
```

Bridge 在 `routes.mjs` 中生成 DSH RPC request，并只暴露显式列出的 method，例如：

```text
session.list              session.history         session.prompt
workspace.list            workspace.create        workspace.attachSession
subagent.history          skill.list              goal.resume
settings.describe         credentials.set         llm.models
remote.invoke             plugin.list             respond
```

真实可用的方法以 `deeptop-bridge/routes.mjs` 和对应 DSH `ApiProxy` 为准。未在 allowlist 中的方法会被拒绝。

事件通过两条流进入桌面端：

- `mux`：Session、Agent、Projection 和会话相关事件；
- `host`：Host 事件，包括 Remote 事件和 Host 生命周期/状态事件；stderr 与 Bridge diagnostic frame 通过独立的诊断通道转发。

Rust 将 Bridge 帧转发为 `deeptop-bridge-event`，React 再通过 `bridge-event-handler.ts` 更新当前会话状态。运行时状态使用 `dsh-runtime-status`，诊断文本使用 `dsh-diagnostic`。React 把现有会话指示器投影为有界的托盘快照；Windows 由 Rust 定位固定宽度的无边框 WebView，React 使用与主窗口相同的本地主题设置渲染快照，其他平台和弹窗创建失败时保留系统原生菜单。托盘入口按需加载独立的 JS 和 CSS，仅在快照、主题、尺寸或位置实际变化时更新；常规重复打开只显示并聚焦已预热的 WebView。会话与新建操作仍通过 `tray-session-open` 和 `tray-new-chat` 事件交回主窗口。

## 8. 原生扩展指南

新增功能前先判断它属于哪一层：

| 问题 | 首选位置 |
| --- | --- |
| 需要新增 Session、Agent、Tool、Storage 或权限语义 | DSH 官方插件 / desktop Profile |
| 需要复用官方 Host 服务但桌面端没有入口 | `deeptop-bridge/routes.mjs` + `src/lib/desktop.ts` |
| 需要复用 Remote/Projection/Host event | `desktop-client-runtime.ts` + `bridge-event-handler.ts` |
| 需要展示或编辑状态 | `src/components/` + `src/app/` |
| 需要启动、停止、重启 DSH 或访问系统通知 | `src-tauri/src/main.rs` |
| 需要目录选择、原生文件保存或下载通道 | Bridge/Tauri 的边界适配 |

推荐流程：

1. 查 DSH 是否已有 Host/Cordis service、ApiProxy method、Remote namespace 或 Projection。
2. 先把官方 Host 能力加入 Profile，验证依赖和加载顺序。
3. 在 `desktop.ts` 声明最小数据类型，避免在 UI 中散落 `unknown` 的领域假设。
4. 在 `routes.mjs` 增加参数校验和 allowlist 路由，并覆盖成功、失败、取消和缺失服务。
5. 在 React 中只做状态映射和原生交互，不复制官方服务的决策逻辑。
6. 更新 `PLUGIN_COMPATIBILITY.md` 或 `WEBUI_PARITY.md`，说明“功能兼容”与“WebUI 视觉/生命周期兼容”的差异。

## 9. 兼容边界

### 直接复用

优先复用 DSH Host/Cordis 的 Session、Agent Preset、Workspace、Tool、Skill、Subagent、Goal、Settings、Credential、LLM、Storage、Projection、ApiProxy 和事件服务。

### 通过原生入口适配

对有 Host/Remote 契约但只有 WebUI Client UI 的能力，复用官方参数、结果、错误、Projection 和事件语义，在 React 中实现原生入口。当前典型边界包括 Commands、Message Feedback、Permission、Plan、Session Stats、Session Log Export 和 Directory Picker。

### 明确不直接加载

以下 WebUI 基础设施不属于当前纯桌面目标：

- `window.__ModuleLoader__` 和动态客户端模块加载；
- Cordis client runner、WebUI client context 和客户端生命周期；
- slot registry、WebUI slot 注入和官方 Client bundle 的无改动安装；
- WebUI layout/primitives/locale 和浏览器专用下载控制器。

这不是拒绝官方插件，而是把“官方 Host 能力”和“官方 WebUI 实现”分开处理。

## 10. 排障手册

### DSH 未就绪

1. 检查运行时 Inspector 的状态和诊断文本。
2. 确认 Node.js 在 `PATH` 中可用，并检查安装包的 `dsh-runtime.tar.gz`、`dsh-runtime-manifest.json`、应用本地数据中的版本缓存（目录名包含源码提交、平台、架构和摘要前缀）和 CLI 入口清单；若缓存被篡改或 `treeSha256` 不匹配，启动器会删除该缓存并重新解压。
3. 确认 `DSH_HOME` 可写。
4. 检查 `$DSH_HOME/profiles/desktop/package.json` 和 `cordis.patch.yml` 是否为有效内容。
5. 刷新 DSH 运行时，观察新的启动日志。

### Profile 插件未加载

确认：

- 修改的是 `$DSH_HOME/profiles/desktop/cordis.patch.yml`；
- 插件 `name` 使用绝对路径或可由 Profile 解析的包名；
- 插件 ID 未与已有服务冲突；
- 依赖已经能被 desktop Profile 解析；
- 没有把改动写到自动生成的 `profiles/node_modules/deeptop-bridge`。

### 某个面板不可用

先区分两种情况：

- Profile 中没有对应 Host/ApiProxy 服务：这是能力缺失，应显示不可用，不应伪造数据；
- 服务存在但调用失败：检查 DSH diagnostic、Remote 错误、参数和当前 Session 是否仍然有效。

### 浏览器预览与桌面表现不同

预览模式不运行 Rust、DSH 子进程和 Tauri event。涉及会话、模型、文件选择、通知、Remote 或 Profile 的验证必须使用 `npm run tauri:dev`。

## 11. 版本漂移与证据范围

Deeptop 启动的是 `vendor/dsh` 固定提交构建的 DSH 版本；运行时清单记录源码提交、包版本和目标平台。仓库源码可以证明 Bridge 的启动命令、Profile 物化、路由 allowlist、JSONL 协议和已实现的 React 入口，但不能单独证明某个 DSH 版本内部服务的全部语义。不要把 Deeptop 描述为 DSH 官方桌面客户端、官方 fork 或“已覆盖全部官方插件”。

判断能力是否可用时，应以当前 Profile、`deeptop-bridge/routes.mjs`、`src/lib/desktop.ts` 和事件处理代码为依据。未出现在这些边界中的 DSH 能力不能视为已支持；可选域缺失时，面板应保持不可用。版本升级后应重新验证：

- desktop Profile 的 Bundle 依赖和插件加载顺序；
- ApiProxy 方法的参数、返回值和错误结构；
- Remote namespace/method、Projection 字段和事件语义；
- 历史恢复、实时事件、取消、超时和 DSH 重启行为。

## 12. 提交前检查

- `npm run build` 通过；
- 修改 Bridge 时运行 `npm run test:bridge`；
- 修改消息重试时运行 `npm run test:retry`；
- 新方法具有 allowlist、参数验证、错误和取消语义；
- 历史恢复与实时事件都能更新同一状态模型；
- 快速切换 Session 时，晚到事件不会覆盖当前会话；
- 插件缺失时 UI 不崩溃、不伪造成功；
- 文档已说明新增能力位于 DSH、Bridge、Tauri 还是 React 层。
