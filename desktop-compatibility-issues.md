# DSH Desktop：Skill 安装流程兼容性问题报告

> 目的：把本次从 GitHub 安装 Skill 时遇到的桌面端/工具链问题交给外部模型修复。
>
> 记录时间：本次会话
> 工作目录：`D:\\Code\\DSH-Desktop`

## 一、问题摘要

本次目标是安装以下两个 GitHub Skill：

- <https://github.com/anthropics/skills/tree/main/skills/frontend-design>
- <https://github.com/Leonxlnx/taste-skill>

由于当前桌面端运行时没有把“从 GitHub 安装 Skill”作为直接能力暴露给模型，安装流程被迫拆成：

1. 查找 agent preset 的实际路径；
2. 通过临时 Cordis Plugin 注入 `agentPresets` Service；
3. 注册临时模型 Tool 查询 preset roster；
4. 再考虑复制 shipped preset、写入用户目录并让 Skill Registry 重新扫描。

用户在中途要求暂停，因此两个 Skill **尚未安装**。以下问题均来自本次实际运行或当前运行时暴露出的明确限制。

## 二、已实际观察到的问题

### 1. `skill` 工具不能直接安装或加载外部 GitHub Skill

当前会话的 `skill` 工具只接受已经出现在会话 Skill Catalog 中的精确名称。它可以加载：

```text
cordis-plugin-development
editing-cordis-compositions
```

但不能直接接受：

- GitHub URL；
- 本地目录；
- 尚未注册的 `SKILL.md`；
- 一个仓库 URL 后自动识别并安装 Skill。

因此用户说“装一下这两个 skill”时，没有一个直接的安装入口。建议增加独立的 Skill 安装能力，至少支持：

```text
installSkill(source: GitUrl | LocalPath, options): InstallResult
```

安装流程应包括下载、目录结构检查、`SKILL.md` 检查、名称冲突处理、注册、刷新当前会话可见目录，并返回最终安装路径和 Skill 名称。

### 2. 没有配置 `DEEPSEEK_API_KEY` 时，`web_search` 不能工作

尝试使用 `web_search` 获取 GitHub 内容时，运行时直接返回：

```text
Error: DeepSeek search has no API key for "DEEPSEEK_API_KEY"; store it through the credentials service (the web Models page writes it), export it in the launching environment, or set a literal "apiKey" in the web-search-deepseek config
```

问题影响：

- 没有搜索 API Key 时，模型无法通过现成的 `web_search` 访问 GitHub；
- 错误提示提到了 credentials service、环境变量和配置项，但当前模型侧没有一个简单、明确的“配置搜索 Key”修复路径；
- 对安装公开 GitHub Skill 这类任务，搜索 API Key 不应成为唯一的内容获取路径。

建议：

1. 为公开 URL 提供不依赖搜索模型 Key 的直接 HTTP/GitHub fetch 能力；或
2. 为 `web_search` 增加无 Key 的降级错误/引导；或
3. 在 Tool Catalog 中清楚区分“搜索”与“直接抓取 URL”。

### 3. 查询 agent preset 路径没有直接的模型 Tool

Skill 文档要求通过 `ctx.agentPresets.list()` 获取真实 preset 路径，不能猜测部署路径。但当前可见 Tool 中没有直接的 `agent_presets`/`preset_roster` 查询工具。

因此我不得不：

- 创建临时 Cordis Plugin `prst-1`；
- 注入 `agentPresets` 和 `tools`；
- 通过 `harness.registerTool()` 注册临时 Tool `preset_roster`；
- 运行插件后再调用这个临时 Tool。

最终才获取到 shipped preset 的路径，例如：

```text
C:\Users\Sparr\AppData\Local\npm-cache\_npx\b86ed90107c62dab\node_modules\@deepseek-ai\dsh\config\agent-presets\standard\agent.cordis.yml
```

这条路径发现链路对普通 Skill 安装任务过于复杂，且把“运行时插件开发”变成了常规文件安装的前置条件。

建议：

- 直接提供只读的 `agent_presets` Tool；或
- 让 `skill`/Skill 安装器内部调用 `agentPresets.resolve/list`；
- 不要要求模型为了查询配置目录临时编写 Cordis Plugin。

### 4. 动态 Tool 的输出 Schema 在定义/运行阶段没有被充分校验

第一次临时 Tool 的声明为字符串输出：

```js
output: {
  schema: { type: 'string' },
  render(_args, value) {
    return [{ type: 'text', text: value }]
  }
}
```

但 `execute()` 实际返回了数组：

```js
return presets.map((p) => ({ ... }))
```

插件可以成功 define，也可以成功 run；直到调用 Tool 时才失败：

```text
Error: tool "preset_roster" returned invalid output: "value" must be a string
```

这说明当前运行时没有在以下更早阶段提示错误：

- `cordis_define` 阶段；
- `harness.defineTool` 阶段；
- `harness.registerTool` 阶段；
- 插件启动阶段。

建议：

- 对 Tool 的 `execute()` 返回值做运行前静态校验（能校验的部分）；
- 或在首次执行失败时提供更完整信息：工具名、声明 Schema、实际返回类型、修复示例；
- `defineTool` 应该尽可能验证 `output.schema` 与 `render` 的契约；
- 若 `render` 只接受字符串，应在声明期拒绝明显不匹配的实现，或者允许结构化 JSON 输出并自动序列化。

### 5. 动态注册 Tool 的发现/可见性不够明确

临时 Tool 注册成功后，当前原始工具目录中并没有提前列出 `preset_roster`。模型需要知道动态 Tool 的名称，才能尝试调用它。

这会造成以下不确定性：

- Tool 已注册但模型目录未刷新；
- Tool 是否应该通过静态命名空间调用不明确；
- Tool 注册后是否需要重新查询 `Tool.listTools` 不明确；
- 动态 Tool 的作用域和有效期不明显。

建议：

1. `harness.registerTool()` 成功后自动刷新当前 Agent 的 Tool Catalog；
2. 明确返回 Tool 的最终可调用名称、作用域和生命周期；
3. 对动态 Tool 增加统一的“当前可见 Tool 列表”查询；
4. 若注册 Tool 只能在下一模型步可用，应在 API 返回值和 UI 状态中明确显示。

### 6. 用户 preset 目录在 workspace 外，导致正常 `workspace-write` 无法直接修改

Skill 文档说明用户 preset 应位于：

```text
%USERPROFILE%\\.dsh\\.agent-presets\\<preset-id>\\
```

而当前工作区是：

```text
D:\\Code\\DSH-Desktop
```

因此用户 preset 根目录在 workspace 外。按当前文件沙箱策略，对其进行写入时预计会触发更宽权限审批；普通 `write`/`edit` 不能直接完成。

这会让“安装一个 Skill”变成：

1. 先从 shipped preset 复制到用户 preset；
2. 再对 workspace 外路径发起额外写权限请求；
3. 依赖用户审批；
4. 最后还要 mount-validate。

这可能是有意的安全边界，但桌面端应为受控的 preset/Skill 安装提供专门 API，避免模型通过通用文件工具修改用户配置目录。

建议提供：

```text
agentPresets.installSkill(...)
agentPresets.copy(...)
agentPresets.validate(...)
```

这些 API 应自行执行路径校验、用户确认和原子写入，不要让模型直接拼接外部配置路径。

## 三、当前架构导致的额外复杂度（不一定是 Bug）

### 1. shipped preset 禁止直接修改

`standard`、`code`、`minimal`、`cordis` 都属于部署自带 preset。当前规则要求：

- 不编辑 shipped preset；
- 先复制到用户 preset 根目录；
- 修改用户副本；
- 通过 `standingKeyFor()` 验证。

这是合理的升级保护机制，但需要在用户操作层提供易用封装，否则模型必须理解 Cordis composition、realm、scope 和 mount 生命周期。

### 2. Skill Registry 与 preset composition 是两个层次

Skill 文件本身需要被 Skill Registry 发现；而 `tool-skill`、`skill-filesystem` 等又需要出现在 preset composition 中。当前流程没有把以下步骤统一封装：

- 复制 preset；
- 安装 Skill 文件；
- 触发 Skill 目录重新扫描；
- 验证 Skill 结构；
- 验证当前 session 是否已经能看到 Skill；
- 必要时重新挂载或新建 session。

外部模型需要修改的重点是：提供一条端到端的安装、注册、验证链路。

## 四、建议的修复优先级

### P0：提供直接的 GitHub Skill 安装 Tool/API

输入：

```json
{
  "source": "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
  "target": "current-user-preset"
}
```

输出至少包含：

```json
{
  "skillName": "frontend-design",
  "source": "...",
  "installPath": "...",
  "registered": true,
  "visibleInCurrentSession": true,
  "warnings": []
}
```

### P1：增加公开 URL 直接抓取的降级路径

对于 GitHub raw 内容或公开仓库，不应强依赖 `DEEPSEEK_API_KEY`。可以使用已有 `web` Service 的 fetch provider，或新增安全的 GitHub content provider。

### P1：把 preset 操作封装为一等能力

至少暴露：

- `listPresets()`；
- `copyPreset()`；
- `installSkillToPreset()`；
- `validatePreset()`；
- `reloadSkills()`。

### P1：改善动态 Tool 契约验证

在 define/register/run/execute 各阶段明确验证 `execute()` 结果与输出 Schema 的关系，并给出可操作的错误消息。

### P2：改善动态 Tool Catalog 刷新

动态 Tool 注册后应该：

- 自动同步到当前 Agent；
- 在 UI/steering 中显示“已注册”；
- 提供稳定的查询接口；
- 明确工具何时可调用、何时失效。

## 五、建议的验收测试

1. 无 `DEEPSEEK_API_KEY` 时，安装公开 GitHub Skill 仍能成功，或返回明确的直接抓取降级状态。
2. 模型只调用一个安装 Tool，即可完成下载、校验、复制/写入、注册和验证。
3. 不需要创建临时 Cordis Plugin 来查询 preset 路径。
4. 安装过程不会修改 shipped preset。
5. 安装目标位于 workspace 外时，权限审批信息明确且只请求一次。
6. Skill 安装后，当前 Agent 的 Skill Catalog 能看到新 Skill，或者明确提示需要新建/重载 session。
7. 动态 Tool 的输出类型错误在注册或首次执行时给出完整诊断，而不是只显示 `value must be a string`。
8. 动态 Tool 注册后，Tool Catalog 会自动刷新并可被模型稳定调用。
9. 安装重复 Skill 时有明确的幂等行为、版本策略和冲突提示。
10. GitHub URL 指向仓库目录、单个文件、分支或 tag 时，错误信息和处理结果一致可理解。

## 六、本次会话产生的临时对象

为查询 preset 路径，本次会话创建了一个临时动态 Plugin：

```text
pluginId: prst-1
packageId: pkg-1 / pkg-2
```

它注册了临时 Tool：

```text
preset_roster
```

该 Plugin 不属于项目源码，也不是 Skill 安装结果；任务结束后应停止或删除，避免残留运行时能力。
