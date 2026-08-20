# Deeptop 项目 Agent 指令

## 项目定位与边界

- Deeptop 是 Tauri + React 原生桌面客户端；DSH/Cordis 负责 Agent、Session、Tool、Model、Workspace、Skill、Goal、Provider、持久化和领域事件。
- `src/` 负责桌面界面、编排和纯投影；`src/app/*-model.ts` 保持纯函数，不调用 React、Tauri 或 Bridge。
- `src/lib/desktop.ts` 维护前端传输与 DSH 类型；`deeptop-bridge/` 维护 Cordis 插件、JSONL 协议、allowlist 路由和 Host/Remote 适配；`src-tauri/` 只负责进程、窗口、原生系统能力和 Bridge 监管。
- 不在 React 或 Rust 中复制 DSH 领域逻辑。新增 DSH 能力优先通过 Profile/Bridge 复用官方服务；修改 `vendor/dsh` 前先确认是明确的上游同步或兼容性任务。
- 选定工作区会作为新会话的 `cwd`。需要验证本项目指令时，使用本仓库根目录或其子目录创建会话，并在对话上下文中确认已出现 `Instructions from: AGENTS.md`。

## 桌面端实现规则

- 文件选择、导出、另存为、日志导出和安装包相关操作必须使用现有 Tauri/desktop bridge 与原生保存对话框；禁止 `<a download>`、`window.open` 下载、隐藏 iframe、浏览器下载栏或把文件 URL 交给浏览器。
- 确认、错误、输入和危险操作必须使用应用内组件；禁止 `alert()`、`confirm()`、`prompt()`、`beforeunload` 和浏览器权限弹窗。涉及文件、目录、权限或系统路径时使用 Tauri 原生对话框，并覆盖取消、失败和重试路径。
- 外链、协议唤起、通知、剪贴板、窗口、快捷键、托盘和文件关联必须先查找现有 Bridge/Rust 封装；React 只触发语义化动作，不散落平台判断。
- 不使用 `window`、`document`、Web Storage、IndexedDB、Service Worker 或浏览器 File System Access API 作为跨重启数据、用户文件或系统资源的默认实现。桌面持久化优先交给 Rust/Tauri、DSH Storage 或 desktop bridge。
- 设计交互时检查桌面窗口尺寸、键盘焦点、右键菜单、拖拽、系统主题、离线状态、取消和失败恢复；不要把浏览器标签页、地址栏、历史或下载栏当作产品能力。

## 开始修改前

1. 先执行 `git status --short --branch`、确认当前分支，并查看相关模块、既有测试和工作区改动。
2. 不覆盖、撤销、重置、rebase、squash 或修改用户未要求处理的改动；只暂存当前模块相关文件。
3. 先定位职责归属和现有 Bridge/Tauri 能力，再做最小变更。跨模块改动在计划中说明依赖关系。
4. 涉及文件、弹窗、外链或运行时能力时，同时设计 Bridge 协议/命令、取消与失败路径，以及渲染层不退化为 Web 原生行为的验收。

## 实现与验证

- 每个独立模块完成后立即运行最相关的专项检查，再查看 `git diff` 与 `git diff --check`；不要用跳过测试、吞掉错误或删除断言来“修绿”。
- 常用检查：`npm run build`、`npm test`、`npm run test:bridge`、`npm run version:check`、`npm run dsh:verify`。修改内嵌 DSH 或运行时构建时，按需先运行 `npm run dsh:sync`；修改 Rust/Tauri 时执行 `cargo fmt --all -- --check`、`cargo check --locked` 和相关 `cargo test --locked`，必要时补充 Clippy。
- 文档、配置和代码必须描述当前行为；避免把实现过程、历史叙述或重复目录清单写入说明。保持 Markdown 链接有效、文件末尾一个换行。
- 修改完成后记录实际运行的命令及结果。桌面能力的验收至少包含原生桥接协议/命令、取消或失败路径和非 Web 原生替代方案。

## 提交纪律

- 按模块拆分提交；每个完成模块立即创建一个独立 Conventional Commit：`<type>(<scope>): <中文摘要>`，例如 `docs(agent): 完善 DSH 项目指令`。
- commit 正文使用中文，说明“改了什么”“为什么改”“如何验证”；提交前确认只包含当前模块相关文件。记录短 hash 和主题，后续发布说明从版本范围内的 commits 提取。
- 不为本次任务顺手重构无关代码，不提交生成目录、临时补丁、凭据、日志或本地 Profile 数据。

## 发布规则

只有用户明确要求发布或准备版本时才执行发布动作。发布流程开始时，先确认当前分支和目标分支，并执行 `git pull --ff-only <remote> <branch>` 拉取云端最新提交；在云端同步完成前，不得生成发布说明、构建产物、创建 Tag 或执行发布命令。若拉取发生冲突、分支无法快进或出现其他需要人工判断的同步问题，必须立即停止发布，向用户说明具体原因和涉及文件，并提问确认解决方案；未获得用户明确选择且问题解决前，不得自行改冲突、覆盖工作区、rebase、重置或继续发布。同步成功后，再确认版本号、工作区干净、每个模块已有提交，并完成 `npm run version:check`、JavaScript 测试、前端构建、Rust 检查和项目要求的发布构建。

使用 `npm run release:notes -- --tag <tag> --version <version> --output release-notes.md` 生成并人工检查中文发布说明；确认分类、破坏性变更、安装升级提示、commit 链接和完整对比链接正确。发布到 GitHub 时必须通过 `gh release create/edit --notes-file` 写入 Release 页面，不要只留下本地 notes 文件。发布完成后记录 Release URL、Tag、安装包/校验和及关键验证结果。
