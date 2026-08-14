# Deeptop

[English](README.md) | 中文

Deeptop 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的轻量级原生桌面客户端。它不是对 `dsh web` 的简单封装：Deeptop Bridge 本身就是一个 Cordis Profile Bundle，Agent、会话存储、模型路由、工具、Preset、Skill 和工作区服务都位于同一棵 DSH Cordis 树中。

项目：[Sparrived/DSH-Deeptop](https://github.com/Sparrived/DSH-Deeptop)

## 当前功能

桌面工作台目前提供 WebUI 的核心对话功能：

- 持久化会话列表、历史恢复和事件驱动的实时更新；
- 按需创建新会话，以及会话重命名、分叉、搜索和移除排队消息；
- 模型目录和每会话模型选择；
- 可选的原生工作区选择与工作区注册；
- 排队/插入提示模式、停止当前轮次、工具调用/结果行，以及按轮次组织的轨迹账本；
- 原生审批和问题响应流程；
- 原生 DSH 运行台：Profile 清单、Skill 目录、Subagent 历史/追问/中断、Goal 生命周期、Host 设置，以及 Provider 和模型目录；
- DSH Host、Cordis Profile、工作区和活动路由的运行时检查器。

Bridge 会转发 WebUI 使用的相同 DSH `ApiProxy` 域：会话、Subagent、Skill、Goal、设置、凭据、Provider 发现、目录浏览、工作区和 Preset 编写。原生界面直接使用这些域，不会在桌面进程中重复实现插件逻辑。如果某个可选域未包含在 Profile 中，其面板会保持不可用，但 Agent 对话仍然可以使用。

## 运行架构

桌面进程会启动一个隐藏、长驻的 DSH 进程：

```text
Tauri 原生窗口 + JSONL stdio
  -> npx @deepseek-ai/dsh@latest --profile desktop
  -> dsh-base + deeptop-bridge + 用户 desktop Profile Bundle
      -> Cordis 服务、Agent Preset、会话、工具和 ApiProxy
```

应用会在首次启动时创建 `$DSH_HOME/profiles/desktop`，并保留用户添加的 Profile Bundle。Bridge 包会写入 `$DSH_HOME/profiles/node_modules/deeptop-bridge`，使 `npx @deepseek-ai/dsh@latest` 能够直接解析它，无需另外全局安装。

DSH 进程使用 `$DSH_HOME/desktop-runtime` 作为默认当前目录。选定的工作区会通过 `session.create({ cwd })` 传入，因此每个会话都可以拥有自己的工作目录，DSH 也不需要依赖桌面应用的项目目录。

## 开发

环境要求：

- Node.js 22.19+ 或 24+；
- Tauri 所需的 Rust/Cargo；
- `PATH` 中可以使用 `npx`；
- 首次使用 DSH 时能够访问已配置的 npm registry。

```powershell
npm install
npm run tauri:dev
```

仅预览前端界面：

```powershell
npm run dev
```

运行时会有意跟随当前的 `@deepseek-ai/dsh@latest` 包。用户的 DSH 配置和 Profile Bundle 会保留在已配置的 `DSH_HOME` 下。

## 扩展 Cordis Profile

桌面 Profile 会保留 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 的用户修改。需要新增 DSH 能力时，优先以 Cordis 插件接入 Profile，而不是修改桌面 UI 或 Tauri 进程。最小本地插件可以写成：

```ts
import type { Context } from "@deepseek-ai/cordis";

export const name = "my-plugin";

export function apply(ctx: Context) {
  ctx.on("session/event", (event) => {
    console.log("session event", event);
  });
}
```

然后在 `$DSH_HOME/profiles/desktop/cordis.patch.yml` 添加本地插件，路径使用绝对路径：

```yaml
- insert:
    - id: my-plugin
      name: "C:/absolute/path/to/my-plugin/src/index.ts"
```

需要提供可替换运行时能力时，再按 Service Definition、Provider、Consumer 三层拆分；单一的小型扩展保持为一个插件即可。
