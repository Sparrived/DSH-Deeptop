<div align="center">
  <img src="https://raw.githubusercontent.com/Sparrived/DSH-Deeptop/refs/heads/master/assets/deeptop-poster.png" alt="Deeptop 原生桌面工作台海报，展示会话与工作区界面" />

  <h1>Deeptop</h1>
  <p><strong>把复杂的工作，交给深处。</strong></p>
  <p>基于 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness（DSH）</a> 的原生桌面工作台。</p>

  <p>
    <a href="https://github.com/Sparrived/DSH-Deeptop/actions/workflows/ci.yml"><img src="https://github.com/Sparrived/DSH-Deeptop/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
    <a href="https://github.com/Sparrived/DSH-Deeptop/releases"><img src="https://img.shields.io/github/v/release/Sparrived/DSH-Deeptop?display_name=tag&sort=semver" alt="最新发布版本" /></a>
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-5C6BC0" alt="支持 Windows、macOS 和 Linux" />
  </p>

  <p>
    <a href="#快速开始">快速开始</a> ·
    <a href="#文档">文档</a> ·
    <a href="https://github.com/Sparrived/DSH-Deeptop/releases">下载发布版</a> ·
    <a href="https://github.com/Sparrived/DSH-Deeptop/issues">报告问题</a>
  </p>
</div>

---

## 这是什么

**Deeptop** 将 DSH 的 Agent 能力带到一个面向深度工作的原生桌面环境中：用会话组织任务、用工作区提供上下文，并在运行时直接处理工具调用、审批、追问与诊断。

它不是把 `dsh web` 放进桌面窗口，也不在应用内重写一套 Agent。DSH 仍然负责 Agent、Session、Tool、Model、Workspace、Skill、Goal、Provider、持久化与事件语义；Tauri/Rust 负责原生窗口、进程监管与系统能力，React 只负责清晰、可操作的桌面交互界面。

> **桌面优先。** 目录选择、文件保存与日志导出通过 Tauri/Bridge 的原生能力完成；界面不依赖浏览器下载、浏览器弹窗或内部 URL 来完成系统操作。

## 核心体验

| 能力 | 你可以做什么 |
| --- | --- |
| **工作区与会话** | 用原生目录选择器关联工作目录；创建、搜索、分叉、归档、恢复和导出会话。 |
| **连续对话** | 流式查看回答与思考过程；附加图片；在任务运行时排队或引导后续提示。 |
| **Agent 交互** | 在同一界面中查看工具调用、Todo、Workflow、Job 与执行轨迹，并处理审批和单选、多选或自定义问题。 |
| **模型与 Provider** | 浏览可用 Provider 与模型，按会话选择模型与推理强度；凭据仍由 DSH API 管理。 |
| **原生运行台** | 查看 Profile、插件、Skill、Agent Preset、Subagent、Goal 与运行时状态；缺少可选能力时明确显示，而不伪造结果。 |
| **可追溯诊断** | 聚合 DSH、Bridge 和前端错误；在设置中筛选、打开日志目录或导出日志快照。 |

## 原生运行模型

```text
┌─────────────────────────────────────────────────┐
│  Deeptop Desktop UI · Tauri + React              │
│  会话 · 工作区 · 设置 · 运行台 · 交互面板        │
└───────────────────────┬─────────────────────────┘
                        │ Tauri commands / events
┌───────────────────────▼─────────────────────────┐
│  Rust Bridge Manager                             │
│  Profile 物化 · DSH 子进程监管 · JSONL 传输       │
└───────────────────────┬─────────────────────────┘
                        │ deeptop/1 JSONL
┌───────────────────────▼─────────────────────────┐
│  DeepSeek Harness · 一棵 Cordis 运行时树          │
│  Agent · Session · Tool · Model · Storage · Host │
└─────────────────────────────────────────────────┘
```

这种边界让桌面端复用 DSH 的领域契约，而不是把 WebUI 的浏览器生命周期、下载机制或客户端插件运行时带入桌面应用。

## 快速开始

### 环境要求

- Node.js **22.19+** 或 **24+**，且 `node`、`npm` 已加入 `PATH`；
- Rust/Cargo 与 [Tauri 桌面开发环境](https://v2.tauri.app/start/prerequisites/)；
- Windows 需要可用的 WebView2；
- 构建与运行需要 Node.js **22.19+** 或 **24+**；安装包会携带固定版本的 DSH 源码构建运行时，不会在启动时访问 npm registry。

### 在本地运行

```powershell
git clone https://github.com/Sparrived/DSH-Deeptop.git
cd DSH-Deeptop
npm ci
npm run tauri:dev
```

启动后等待内嵌 DSH 运行时就绪，再选择或创建工作区、配置 Provider 与凭据，然后新建会话开始工作。Deeptop 会从安装包的压缩 `dsh-runtime.tar.gz` 资源启动固定版本的 DSH，并将按源码提交、平台、架构和运行时树摘要命名的解压缓存复用于后续启动与更新；用户的 PATH、全局 npm、npm 缓存和 registry 不会替换或安装运行时。安装包仍使用系统 Node.js 执行内嵌 JavaScript；缺少 Node.js 时会显示可重试的原生错误。

> `npm run dev` 仅启动 Vite 预览，缺少 Tauri Bridge 和 DSH 子进程。它适合调整布局，不应用于验证会话、文件或系统集成功能。

### 构建与验证

| 目标 | 命令 |
| --- | --- |
| 前端类型检查与构建 | `npm run build` |
| 生成内嵌 DSH 运行时 | `npm run dsh:sync` |
| 校验内嵌 DSH 运行时 | `npm run dsh:verify` |
| Bridge 路由测试 | `npm run test:bridge` |
| 全量 JavaScript 测试 | `npm test` |
| 原生应用与安装包 | `npm run tauri:build` |
| 检查版本清单一致性 | `npm run version:check` |

## 文档

| 文档 | 适用场景 |
| --- | --- |
| [项目说明手册](docs/PROJECT_GUIDE.md) | 安装、运行时目录、数据流、扩展和排障。 |
| [DSH 原生协调关系](docs/DSH_NATIVE_COORDINATION.md) | 判断功能应位于 Tauri、Bridge、Profile 还是 React。 |
| [架构说明](ARCHITECTURE.md) | 了解依赖方向、纯模型层与插件化边界。 |
| [插件兼容策略](PLUGIN_COMPATIBILITY.md) | 查看 Host/Cordis 与 WebUI Client 的兼容分层。 |
| [WebUI 对齐清单](WEBUI_PARITY.md) | 了解已覆盖能力、进行中项目与明确排除项。 |
| [CI/CD 与发布](docs/CI_CD.md) | 了解版本同步、跨平台构建、校验和与 GitHub Release 流程。 |
| [中文完整参考](README.zh.md) | 查看更完整的功能清单、配置示例与常见问题。 |

## 为 Deeptop 扩展能力

优先把用户自定义能力加入 DSH desktop Profile，而不是直接复制到 Rust 或 React。持久化补丁位于：

```text
$DSH_HOME/profiles/desktop/cordis.patch.yml
```

推荐顺序：

1. 先寻找 DSH 已有的 Host/Cordis 服务、ApiProxy 方法、Remote 契约或 Projection；
2. 在 Profile 中挂载并验证该能力；
3. 需要桌面入口时，在 `deeptop-bridge` 添加最小、显式校验的 allowlist 路由；
4. 在 Tauri 层处理目录、文件保存、系统通知等原生边界；
5. 最后让 React 映射状态和触发语义化操作，并补足成功、取消、失败与缺失能力路径。

请不要直接修改 `$DSH_HOME/profiles/node_modules/deeptop-bridge` 下的生成文件；应用启动时会重新物化它们。更多示例见[项目说明手册](docs/PROJECT_GUIDE.md#扩展桌面-profile)。

## 贡献

欢迎提交 Issue 和 Pull Request。提交前请：

- 保持 DSH 作为 Agent、权限、会话和插件领域语义的权威来源；
- 不引入 Web 原生下载、浏览器弹窗或散落在 React 组件内的平台判断；
- 为新增 Bridge 命令覆盖协议、取消和失败路径；
- 运行与变更相关的测试；修改前端时至少运行 `npm run build`，提交前运行 `npm test`；
- 使用 Conventional Commits，例如 `feat(workspace): 支持工作区模板`。

完整的开发与发布约定见[项目说明手册](docs/PROJECT_GUIDE.md)和[CI/CD 与发布](docs/CI_CD.md)。

## 发布

推送符合 SemVer 的 Tag（例如 `v0.2.0`）会触发 GitHub Actions，构建 Windows、Linux 和 macOS 安装包，生成 SHA-256 校验和，并以自动归类的中文说明创建或更新 GitHub Release。发布前请先运行：

```powershell
npm run version:check
npm run build
npm test
```

请从 [Releases](https://github.com/Sparrived/DSH-Deeptop/releases) 获取安装包与升级说明。

---

<div align="center">
  <sub>Deeptop · A desktop for deep work, powered by DeepSeek Harness.</sub>
</div>
