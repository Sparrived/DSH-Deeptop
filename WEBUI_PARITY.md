# WebUI Parity 工程清单

## 基线

- 对比对象：官方 `deepseek-ai/deepseek-harness` WebUI。
- 对比版本：`47f943859bef60e4160492346772ded9b24f765a`（2026-08-13）。
- 运行时版本：`@deepseek-ai/dsh@latest`，当前验证为 `0.1.0-rc.6`。
- 原则：复用现有 DSH ApiProxy 和桌面 Bridge；没有必要时不在桌面端复制 DSH 插件逻辑。

## 当前已具备

- 会话创建、打开、历史恢复、重命名、整会话分叉、归档和事件流更新。
- 基础会话搜索、模型/思考程度选择、发送、排队、Steer、停止和删除队列项。
- 原生工作区选择与注册、通用工具审批、通用问题回答。
- 基础轨迹、Skill 目录、Subagent 历史/追问/中断、Goal 生命周期、Preset 和运行时设置面板。

## 缺口清单

状态：`[ ]` 未实现，`[~]` 部分实现，`[x]` 已完成。

### P0：核心会话体验

- [ ] Workspace/Session 树：工作区分组、折叠、平铺模式、排序、拖拽重排。
- [~] 工作区管理：已有选择、创建和归档；缺少工作区重命名、删除、会话移动和目录浏览器。
- [~] 会话搜索：已有回车触发的 ID 过滤；缺少防抖全文搜索、摘要片段、排序和结果上限管理。
- [ ] 可调整布局：三栏布局、侧栏/面板拖拽和宽度持久化。
- [~] 对话流：已有完整消息事件；缺少 `assistant/chunk` 流式拼装、Think/reasoning 尾部和实时折叠行。
- [ ] 历史分页：`load older`、长会话虚拟化、完整历史统计和尾部跟随暂停。
- [~] 消息操作：已支持消息复制和按 `atSeq` 分叉；仍缺少重试和完整完成消息尾部操作栏。
- [~] 工具视图：已有通用 call/result 行；缺少嵌套调用树及终端、文件、Diff、搜索、Web、Todo、Skill、Workflow 专用卡片。
- [~] Markdown/媒体：已有 GFM；缺少数学公式、图片展示、附件画廊、Lightbox 和拖放上传。

### P1：输入和运行交互

- [ ] `/` 命令菜单、Skill 快捷候选、`@` Subagent 候选和键盘导航。
- [~] 队列：已有排队、Steer、删除；缺少队列内容编辑、折叠展开和更完整的生命周期视图。
- [ ] Plan 模式、Plan chip、`/plan` 和结构化 Plan Review。
- [~] 用户问题：已有单选/多选；缺少自定义文本、逐题导航、推荐标记、Markdown detail 和 Plan Review intent。
- [ ] Permission preset、当前会话权限弹窗和命令级权限操作。
- [~] Subagent：已有直接子 Agent；缺少递归树、任意深度导航、懒加载和 `@` 引用。
- [~] Goal：已有运行台生命周期操作；缺少 WebUI 输入区 GoalBar 集成。
- [ ] Background Jobs 列表和运行状态控制。
- [ ] Workflow Run 成员/进度卡片。
- [ ] Produced Files 文件卡片和“在文件夹中显示”。

### P1：设置和模型管理

- [~] Provider/模型设置：已有状态和只读目录；缺少 Provider 新增/删除、API Key 写入/清除、自定义 Base URL/协议、模型发现和模型编辑。
- [ ] Light/Dark/System 主题及持久化。
- [ ] 中英文语言切换和本地化资源。
- [~] 插件设置：已有原始 JSON 编辑和只读清单；缺少 schema 驱动表单及插件管理卡片。
- [~] Agent Preset：已有选择、默认值、复制、查看和打开文件；缺少完整管理入口、新会话 chip 和删除。
- [ ] 消息 Like/Dislike 及反馈备注。
- [ ] 会话日志导出、ZIP 下载和完整会话统计。

## 本轮实施

- [x] 建立本工程清单。
- [x] 消息级复制与按 `atSeq` 分叉。
- [x] 输入框 `/Skill` 和 `@Subagent` 快捷候选。

## 后续顺序

1. Workspace/Session 树和搜索体验。
2. 对话流、历史分页和专用工具视图。
3. Provider/凭据/模型设置。
4. Plan、Permission、Question、Jobs、Workflow、附件和导出。

## 验证要求

- `npm run build` 通过。
- 消息复制不改变会话状态；按消息分叉发送 `session.fork({ sessionId, atSeq })`。
- `/` 和 `@` 候选支持鼠标选择、Enter 选择、Escape 关闭，并保留前缀输入文本。

## 本轮实现记录

- `src/App.tsx` 为转录项保留事件 `seq`，消息级分叉调用 `session.fork({ sessionId, atSeq })`。
- `src/App.tsx` 在活动会话切换时加载 Skill，并基于当前输入 token 提供 `/`、`@` 候选。
- `src/styles.css` 增加消息操作栏和 composer 候选层；候选层不抢 textarea 焦点。
- 验证：`npm run build` 通过（TypeScript 与 Vite）。
- 不覆盖已有未提交改动。
