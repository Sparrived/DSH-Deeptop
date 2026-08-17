# Deeptop

[English](README.md) | 中文

Deeptop 是 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的轻量级原生桌面客户端。它使用 Tauri + React 提供桌面工作台，同时把 DSH 的 Agent、Session、Tool、Model、Workspace、Skill、Goal 和 Provider 能力保留在同一棵 Cordis 运行时树中。

Deeptop 不是对 `dsh web` 的页面包装，也不会在桌面进程中复制一套 Agent 或插件实现。桌面端负责原生窗口、进程管理、JSONL 传输和交互界面；领域语义、持久化、事件、权限和插件服务优先由 DSH Host/Cordis 提供。

项目地址：[Sparrived/DSH-Deeptop](https://github.com/Sparrived/DSH-Deeptop)

## 文档导航

- [项目说明手册](docs/PROJECT_GUIDE.md)：从安装、运行、目录、数据流到扩展方式的完整说明。
- [CI/CD 与发布](docs/CI_CD.md)：GitHub Actions 检查、跨平台安装包、版本同步和自动 Release。
- [DSH 原生协调关系](docs/DSH_NATIVE_COORDINATION.md)：说明 Tauri、Bridge、Cordis Profile、ApiProxy、Remote、Projection 和 React 的边界与调用链。
- [架构说明](ARCHITECTURE.md)：说明依赖方向、纯前端模型层和插件化规则。
- [官方插件兼容策略](PLUGIN_COMPATIBILITY.md)：Host/Cordis 与 WebUI Client 的兼容分层、当前状态和后续工作。
- [WebUI 对齐清单](WEBUI_PARITY.md)：当前功能覆盖、缺口和明确排除的 WebUI 基础设施。

## 当前功能

桌面工作台目前覆盖 WebUI 的核心对话面，并提供原生 DSH 运行台。下面区分已支持、部分支持和依赖 Profile 的能力：

| 领域 | 状态 | 说明 |
| --- | --- | --- |
| 会话 | 已支持 | 持久化列表、历史恢复、历史向前分页、实时事件、重命名、搜索、分叉、归档、恢复和删除归档会话。 |
| 对话 | 已支持 | assistant/reasoning 流式拼装、Markdown/GFM、图片附件、排队/steering（引导）提示、队列编辑/移除、停止和消息重试。重试会创建可恢复的前缀分支，不回滚原会话。 |
| 工作区 | 已支持 | 原生目录选择、创建/重命名/删除、会话归属、分组和排序。选定路径会作为会话 `cwd` 传入 DSH。 |
| 模型与 Provider | 有边界地支持 | Provider/模型目录、每会话模型选择、思考程度、上下文窗口和输入模态元数据、Provider 发现及自定义连接设置。Schema 驱动的 Provider 表单尚未完整实现。 |
| 工具与交互 | 已支持 | 工具调用/结果、Workflow、Job、Todo、轨迹视图、单选/多选/自定义问题响应，以及审批响应。 |
| 反馈与导出 | 部分支持 | 消息赞/踩和带版本的备注可用；会话 JSON/ZIP 导出可用，但 ZIP 当前通过 JSONL Bridge 以 Base64 传输，尚未采用原生流式下载。 |
| 诊断与日志 | 支持 | DSH 运行时、Bridge 与前端错误堆栈按时间戳记录，持续写入 `$DSH_HOME/logs`，并可在 设置 → 日志 中查看、筛选和导出。 |
| DSH 运行台 | 依赖 Profile 的能力 | Profile/插件清单、运行时检查器、Host 设置、Skill 目录、Agent Preset、Subagent 历史/追问/中断和 Goal 生命周期。可选域缺失时保持不可用，不伪造成功。 |
| Skill 安装 | 已支持 | 输入框 `/skill` 候选，以及受审批保护的 GitHub 安装，支持直接下载和 sparse-git fallback。 |
| Remote 与事件 | 已支持 | Typert Remote loopback 调用和官方 Host 事件转发；原生界面适配契约，不加载 WebUI Client Bundle。 |
| 部分领域 | 开发中 | Permission 全局控制、Plan chip/Review、完整 Session Stats、递归 Subagent、Schema 设置、长会话虚拟化、完整媒体预览和本地化仍未完成。 |

窗口当前为无边框、可调整大小，默认 1360×860，最小 920×620；支持 Light、Dark、System 主题和外观设置。

可选 DSH 插件缺失时，对应面板会保持不可用并显示错误状态；Agent 对话不应因为单个可选域缺失而被桌面端伪造或中断。

## 首次使用

1. 运行 `npm run tauri:dev`，等待运行时指示器显示 DSH 已就绪。开发启动会从 `vendor/dsh` 构建并同步固定提交的内嵌运行时；应用启动不会使用 PATH 中的 `dsh`、npm 全局安装、`DSH_HOME` prefix、npm/npx 缓存或 registry。
2. 打开设置/运行台；如果当前 Profile 提供对应域，配置 Provider 和凭据。凭据通过 DSH API 写入，不要把密钥放进仓库或 Profile 补丁。
3. 选择或创建工作区。选定目录会作为新建会话的 `cwd`，不会自动修改已有会话的工作目录。
4. 创建会话、选择模型并发送提示。运行中需要追加上下文时，可使用 queue 或 steering 模式。
5. 在原生交互面板中处理审批和问题响应。问题可以根据 DSH 事件支持单选、多选或自定义文本。
6. 使用 `/skill` 获取 Skill 候选，通过 Subagent 和 Goal 面板使用对应 DSH 工作流，并用运行时 Inspector 检查 Profile/插件能力。
7. 使用会话操作执行重试、分叉、归档、恢复、导出或删除。刷新运行时会重启 DSH 子进程，等待中的请求可能失败。

仓库已包含 GitHub Actions 发布流水线。`src-tauri/tauri.conf.json` 已启用 Tauri bundle；推送 `v0.2.0` 这样的 SemVer Tag 后，会自动构建 Windows（NSIS/MSI）、Linux（DEB/AppImage）和 macOS（DMG）资产，并发布 GitHub Release。完整流程和签名配置见[CI/CD 与发布](docs/CI_CD.md)。

## 与 DSH 的原生协调关系

```text
┌──────────────────────────────────────────────┐
│ Tauri + React 原生桌面界面                    │
│ 会话、输入、设置、运行台、Inspector           │
└──────────────────────┬───────────────────────┘
                       │ Tauri invoke / events
┌──────────────────────▼───────────────────────┐
│ Rust Bridge Manager                           │
│ 启动 DSH、物化 Profile、JSONL stdin/stdout     │
└──────────────────────┬───────────────────────┘
                       │ deeptop/1 JSONL
┌──────────────────────▼───────────────────────┐
│ node <installed @deepseek-ai/dsh bin>         │
│ --profile desktop                             │
│ dsh-base + deeptop-bridge + 用户 Profile      │
└──────────────────────┬───────────────────────┘
                       │ 同一 Cordis 树
┌──────────────────────▼───────────────────────┐
│ DSH Host/Cordis                               │
│ Session / Agent / Tool / Model / Storage       │
│ Workspace / Skill / Goal / Provider / ApiProxy │
└──────────────────────────────────────────────┘
```

关键原则：

1. DSH 是领域能力的权威来源，桌面端复用 Host/Cordis 服务、ApiProxy、Remote 契约、Projection、事件和数据语义。
2. `deeptop-bridge` 是 DSH Profile Bundle 中的 Cordis 插件，不是一个独立的 HTTP 服务，也不是第二套 Agent。
3. Tauri 只维持一个隐藏、长驻的 DSH 子进程，并通过 JSONL 请求/响应和事件流连接原生 UI。
4. 只有桌面传输、目录选择、文件下载和原生交互等边界能力放在 Bridge/Tauri 中；领域逻辑不应在 React 或 Rust 中复制。
5. WebUI 专属的 ModuleLoader、Client Runner、slot registry 和客户端生命周期不属于纯桌面兼容目标。

详细调用链、职责表和插件扩展方式见 [DSH 原生协调关系](docs/DSH_NATIVE_COORDINATION.md)。

## 运行时与数据目录

桌面端启动时会执行以下准备工作：

1. 读取 `DSH_HOME`；未设置时，Windows 默认使用 `%USERPROFILE%\.dsh`，Unix-like 系统默认使用 `$HOME/.dsh`。
2. 创建 `$DSH_HOME/profiles/desktop`，写入或补齐 desktop Profile 清单。
3. 将内置 `deeptop-bridge` 写入 `$DSH_HOME/profiles/node_modules/deeptop-bridge`，因此无需全局安装该 Bridge。
4. 保留用户已有的 desktop Profile Bundle 和 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 修改。
5. 从 Tauri 安装包的 `dsh-runtime` 资源读取固定版本的 DSH 源码构建产物和完整依赖树。
6. 通过系统 Node.js 直接执行内嵌 `@deepseek-ai/dsh/lib/bin.js`，不调用 npm、PATH 中的 `dsh`、全局安装、npm/npx 缓存或 registry。
7. 运行时资源只读；Profile、会话、日志和设置仍写入 `$DSH_HOME`，然后等待 Bridge 返回 `deeptop/1` 的 `ready` 帧。

选定工作区后，桌面端会将其作为 `session.create({ cwd })` 的工作目录传给 DSH；它不会把桌面项目目录隐式当成所有会话的工作区。Storage、Session Persistence 和 Profile 数据仍由 DSH 按自身配置管理。

## 开发环境

要求：

- Node.js 22.19+ 或 24+；
- Rust/Cargo，以及 Tauri 所需的 Windows 桌面开发环境；
- Node.js 位于 `PATH` 中（npm 仅用于开发依赖安装，不参与安装包运行时）；
- 首次构建内嵌 DSH 运行时需要访问 npm registry，或构建机已准备好 DSH 源码依赖缓存；运行中的安装包不访问 registry；
- Windows 运行时需要可用的 WebView2 环境。

安装依赖：

```powershell
npm install
```

启动完整桌面应用：

```powershell
npm run tauri:dev
```

只预览 React/Vite 前端：

```powershell
npm run dev
```

浏览器预览不包含 Tauri Bridge，因此 DSH、会话和原生目录选择不可用；它适合检查布局和组件，不代表完整运行时验证。

## 构建与测试

```powershell
# 从固定 vendor/dsh 提交生成并校验内嵌运行时
npm run dsh:sync
npm run dsh:verify

# TypeScript 检查并构建 Vite 前端
npm run build

# 构建 Tauri 应用
npm run tauri:build

# Bridge 路由和 Skill 来源测试
npm run test:bridge

# 全量 JavaScript 测试
npm test

# 检查所有应用清单版本一致
npm run version:check
```

`npm run build` 实际执行 `tsc --noEmit && vite build`；`npm run tauri:dev` 会按 Tauri 配置先启动 Vite，`npm run tauri:build` 会构建原生应用和已启用的 bundle。准备发布时使用 `npm run version:set -- 0.2.0`，它会同步更新 npm、Bridge、Tauri 和 Cargo 清单。每次修改至少运行 `npm run build` 与 `npm test`；修改 Bridge 或重试逻辑时同时运行对应专项测试。

内嵌 DSH 来自 `vendor/dsh` 子模块锁定的 DeepSeek Harness 提交；构建脚本会先构建 Host 产物，再生成无 workspace 链接的 `dsh-runtime` 资源。升级 DSH 时应更新子模块指针、运行时清单，并重新验证 Profile、ApiProxy 方法、Remote 契约和事件投影。

## 扩展桌面 Profile

用户自定义 DSH 能力应优先加入 desktop Profile，而不是直接改 Rust 启动器或 React 领域逻辑。桌面 Profile 的用户补丁位置是：

```text
$DSH_HOME/profiles/desktop/cordis.patch.yml
```

示例：加入一个本地 Cordis 插件（路径必须是绝对路径）：

```yaml
- insert:
    - id: my-plugin
      name: 'C:/absolute/path/to/my-plugin/src/index.ts'
```

插件最小形式：

```ts
import type { Context } from "@deepseek-ai/cordis";

export const name = "my-plugin";

export function apply(ctx: Context) {
  ctx.on("session/event", (event) => {
    console.log("session event", event);
  });
}
```

建议的扩展顺序：

1. 先检查 DSH 官方包是否已有 Host/Cordis、ApiProxy、Remote 或 Projection 能力。
2. 有 Host 能力时，把插件加入 Profile 并复用其服务，不在桌面端重新实现领域逻辑。
3. 有 Remote/Projection 时，在 `src/lib/desktop.ts` 声明最小类型，通过 `desktopClientRuntime` 接入。
4. 只有 WebUI Client UI 时，用原生 React 实现桌面入口，不直接加载 WebUI Client bundle。
5. 新增 Bridge 路由时，必须加入 `deeptop-bridge/routes.mjs` 的显式 allowlist，并补充测试。

不要直接编辑运行时生成的 `$DSH_HOME/profiles/node_modules/deeptop-bridge` 内容；重启时这些文件会由应用重新物化。需要持久化用户扩展时，请改 desktop Profile 的 `cordis.patch.yml`。

## 兼容边界与已知缺口

Deeptop 的目标是“功能和契约兼容，界面和生命周期原生化”，而不是复制官方 WebUI 的全部实现。当前仍在完善的方向包括：

- Plan chip、结构化 Plan Review 和更完整的 Permission 入口；
- 完整 Session Stats 展示与 ZIP 原生流式下载；
- Provider/插件的 Schema 驱动设置表单；
- 递归 Subagent、GoalBar、Workflow 成员导航和更多领域工具卡片；
- 长会话虚拟化、数学公式、附件画廊、Lightbox 和中英文资源。

明确不安排（除非未来单独引入 WebUI compatibility mode）：

- `window.__ModuleLoader__`；
- Cordis client runner、WebUI client context 和客户端插件生命周期；
- WebUI slot registry、动态加载官方 Client bundle；
- 为了视觉一致而引入 WebUI layout、primitives、locale 和浏览器专用下载控制器。

完整状态以 [PLUGIN_COMPATIBILITY.md](PLUGIN_COMPATIBILITY.md) 和 [WEBUI_PARITY.md](WEBUI_PARITY.md) 为准。

## 常见问题

### 找不到 Node.js

Deeptop 通过系统 `PATH` 中的 Node.js 直接执行安装包内嵌的 DSH JavaScript；npm 不参与安装包运行时。请安装 Node.js 22.19+ 或 24+，确认启动 Deeptop 的进程继承了正确的 `PATH`，然后重试。

### DSH 启动失败或停留在“正在启动”

打开运行时 Inspector 查看 DSH 状态和诊断信息，确认 `DSH_HOME` 可写、安装包的 `dsh-runtime/runtime-manifest.json` 与 DSH 入口完整、desktop Profile 的 JSON/YAML 没有被破坏。修改 Profile 后可通过应用的刷新运行时操作重新启动 DSH。

### 浏览器预览没有会话

这是预期行为。只有 `npm run tauri:dev` 启动的 Tauri 窗口才拥有 Rust Bridge 和 DSH 子进程。

### 修改了插件但没有生效

确认修改的是 `$DSH_HOME/profiles/desktop/cordis.patch.yml`，而不是生成的 `profiles/node_modules/deeptop-bridge/cordis.patch.yml`；然后刷新 DSH 运行时。插件依赖、Profile 注入顺序和 Host 错误可在 Inspector/诊断信息中检查。

### 排查崩溃或请求失败

打开 设置 → 日志。运行时、Bridge 与前端错误的堆栈会带时间戳显示；点击「刷新」可从桌面宿主回填历史日志，「打开日志目录」可查看 `$DSH_HOME/logs/deeptop.log`，「导出日志」可生成带时间戳的日志快照文件用于分享。

## 项目结构

```text
src/                       React 桌面界面、状态模型和原生运行时适配
src/components/            会话、设置、运行台和交互组件
src/app/                   会话/消息/轨迹/事件等领域状态模型
src/lib/desktop.ts         Tauri Bridge 类型与请求封装
src/lib/desktop-client-runtime.ts
                           Remote loopback 和 Host 事件订阅
src-tauri/src/main.rs      DSH 子进程、Profile 物化和 JSONL 管理
src-tauri/                 Tauri 配置与 Rust 工程
deeptop-bridge/            DSH Cordis Bundle、路由和 Bridge 测试
docs/                      项目手册与 DSH 原生协调说明
ARCHITECTURE.md            依赖方向与插件化规则
PLUGIN_COMPATIBILITY.md    插件兼容分层与工程清单
WEBUI_PARITY.md            WebUI 对齐状态与缺口
```

## 贡献前检查

- 不把 WebUI Client bundle 当作桌面依赖直接加载；
- 不在 React/Rust 中复制 DSH 的会话、权限、Agent 或插件领域逻辑；
- 新 Bridge 方法保持显式 allowlist、参数校验、错误和取消语义；
- 覆盖历史恢复、实时事件、插件缺失、错误、取消和快速切换 Session；
- 运行 `npm run build` 及相关测试，并同步更新兼容文档。
