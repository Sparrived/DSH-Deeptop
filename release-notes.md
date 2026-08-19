# Deeptop 0.1.3

> 本版本变更由 Conventional Commits 自动整理，按提交类型归类，方便快速了解升级内容。

**98 个提交** · 对比 `v0.1.2`

## ✨ 新增功能

- **session**：增加工作区会话置顶 ([0ff5471](https://github.com/Sparrived/DSH-Deeptop/commit/0ff547150fafede862f0d171729b9f7fc4d41a0a))
- **message-path**：仅对真实文件显示路径卡片 ([063a7ac](https://github.com/Sparrived/DSH-Deeptop/commit/063a7acf3e0d11f8ac5f63d494ec71ddaa287e92))
- **updater**：支持开发版与正式版桌面更新 ([a1dc122](https://github.com/Sparrived/DSH-Deeptop/commit/a1dc122462285600d77dc9d2fefdf3b1a700c9eb))
- **settings-typography**：自定义运行中提示文字与特效 ([65b9546](https://github.com/Sparrived/DSH-Deeptop/commit/65b9546053a0c15f508f00a393ae8a898ab0d2fc))
- **settings-general**：增加最小化到托盘与关闭选项 ([df66c7b](https://github.com/Sparrived/DSH-Deeptop/commit/df66c7b603776e510ebd016135e5ed25fa4bd378))
- **window-tray**：支持窗口后台运行与系统托盘 ([81713ca](https://github.com/Sparrived/DSH-Deeptop/commit/81713ca33cd2a1550ee342fadc20e1beebd013b6))
- **settings-general**：增加右键启动设置 ([ad1b14b](https://github.com/Sparrived/DSH-Deeptop/commit/ad1b14bccc096a4b1e84aca27fd12046b9db6968))
- **桌面桥接**：支持外部路径启动与右键菜单注册 ([8d6d8bf](https://github.com/Sparrived/DSH-Deeptop/commit/8d6d8bf10291555d8a0321f9c213454ceeb7e5b2))
- **runtime**：安装阶段预热内嵌运行时 ([934a123](https://github.com/Sparrived/DSH-Deeptop/commit/934a123b7e447a861b95526820eb88b8befa916a))
- **runtime**：使用压缩归档和版本化缓存启动 DSH ([31c709e](https://github.com/Sparrived/DSH-Deeptop/commit/31c709eb5465b1ed8d146de44657a7898df086dc))
- **设置**：添加关于页面与原生更新检查 ([c5fa383](https://github.com/Sparrived/DSH-Deeptop/commit/c5fa3832c62f2bb9523a30d5e369cf612daf0141))
- **聊天动作**：接入路径与连接桌面动作 ([ee54880](https://github.com/Sparrived/DSH-Deeptop/commit/ee54880463ee6117f03a8d967c7f588cd108915f))
- **原生桥接**：支持安全打开聊天连接 ([19797cd](https://github.com/Sparrived/DSH-Deeptop/commit/19797cdfd02f10607bb159521adf2ec04adf938a))
- **桌面桥接**：增加连接原生打开接口 ([dfd3e72](https://github.com/Sparrived/DSH-Deeptop/commit/dfd3e7239d6319327a91b7f837aa271c32dc5f3d))
- **聊天渲染**：将路径与连接显示为桌面卡片 ([c9b9d71](https://github.com/Sparrived/DSH-Deeptop/commit/c9b9d71bc2c6598514e81a2de131d9269388f997))
- **消息实体**：识别聊天路径与连接 ([17036b8](https://github.com/Sparrived/DSH-Deeptop/commit/17036b85c4a9f84d70074c357ad68e0930f521c1))
- **文件看板**：修复复制路径并支持添加到聊天框 ([e41e376](https://github.com/Sparrived/DSH-Deeptop/commit/e41e376cfb597fb5a88cdc5f3f6bbf78113f16bf))
- **插件**：改进桌面插件安装流程 ([749c71e](https://github.com/Sparrived/DSH-Deeptop/commit/749c71e8166fb8348407bf1d6f22581bf2c8029a))
- **终端**：增加原生风格终端渲染 ([0519e21](https://github.com/Sparrived/DSH-Deeptop/commit/0519e21675ceca0bc08df7a5d74907f1f3e354ff))
- **终端**：接入原生 PTY 会话 ([d424708](https://github.com/Sparrived/DSH-Deeptop/commit/d424708ba2f2946bf4e071742424c40b3d239e54))
- **终端**：将 dock 改为内嵌终端页面 ([08f4beb](https://github.com/Sparrived/DSH-Deeptop/commit/08f4beb2c611a0af1c1c3498d0ca534034fc348b))
- **终端**：增加跨平台工作区终端 dock ([2d0905c](https://github.com/Sparrived/DSH-Deeptop/commit/2d0905c8792993eb4adadc21bd285175572eb679))
- **终端**：增加跨平台终端探测与启动 ([6b34352](https://github.com/Sparrived/DSH-Deeptop/commit/6b34352eb393ae4da4c3d65ac3111d22e858e8cb))
- **新会话**：将空状态图标改为 Deeptop 字标 ([42f652b](https://github.com/Sparrived/DSH-Deeptop/commit/42f652b9514545a893594457e490c50b5283d5a6))

## 🐛 修复问题

- **session**：完善置顶交互 ([b260184](https://github.com/Sparrived/DSH-Deeptop/commit/b260184f736098774899dbb025f12080ac67887c))
- **markdown**：修复中文路径误触发删除线 ([cf222d0](https://github.com/Sparrived/DSH-Deeptop/commit/cf222d06a9b4ec25c89ed30edfb1d7fd1a0b4fa7))
- **settings-typography**：修复流光动画循环断层 ([c6d3f34](https://github.com/Sparrived/DSH-Deeptop/commit/c6d3f340c337f05a46863e9b5112ecd646895fa2))
- **startup**：更新 DeepSeek Harness 启动提示 ([c057bd2](https://github.com/Sparrived/DSH-Deeptop/commit/c057bd2af3b2ead2c8440c6fea74e84e3c629618))
- **会话归档**：修复删除停止等待的上下文读取 ([3a2fff2](https://github.com/Sparrived/DSH-Deeptop/commit/3a2fff21bf1ba37db46e6ff6a94c7771284f1c7f))
- **updater**：收紧下载校验与失败恢复 ([78b7aea](https://github.com/Sparrived/DSH-Deeptop/commit/78b7aea3f1a68d0c530c4ebc5825e857fd1f0ff4))
- **updater**：收紧下载校验与失败恢复 ([02d13af](https://github.com/Sparrived/DSH-Deeptop/commit/02d13af7d6307687a0e5d71b22900fd83b13c705))
- **windows-context-menu**：统一使用 Path 参数 ([cecd2e1](https://github.com/Sparrived/DSH-Deeptop/commit/cecd2e19595bff8a1697917aa5d6b3373f2c6951))
- **settings-typography**：稳定运行提示轮换与可访问性 ([9b3fb65](https://github.com/Sparrived/DSH-Deeptop/commit/9b3fb65bc21fe1cc507af508f95d15a4b229ab1f))
- **windows-context-menu**：收窄路径参数类型 ([bbe6e79](https://github.com/Sparrived/DSH-Deeptop/commit/bbe6e7975c63a66da6bbbe23c9ab5b6b6a849b17))
- **updater**：修复更新命令注册换行 ([e837330](https://github.com/Sparrived/DSH-Deeptop/commit/e83733068f5bb45e5bd872dc2e9f12f8a5d54742))
- **window-tray**：补充窗口隐藏权限 ([d5ecf91](https://github.com/Sparrived/DSH-Deeptop/commit/d5ecf9112c65aa3087d94e7eb5b201c1c9f0d3d3))
- **window-tray**：防止首次关闭请求丢失 ([4c08989](https://github.com/Sparrived/DSH-Deeptop/commit/4c08989ce11f7a88bfe99295975355ad21a55df5))
- **window-tray**：增强窗口行为配置替换回滚 ([b954b8e](https://github.com/Sparrived/DSH-Deeptop/commit/b954b8eaa6eea7624f4be5128bd09504655943c3))
- **windows-context-menu**：校验右键注册写入结果 ([b362a4d](https://github.com/Sparrived/DSH-Deeptop/commit/b362a4d55882be422fadea5266db8a18835720bf))
- **settings-general**：保留失败的右键启动请求 ([e37caa4](https://github.com/Sparrived/DSH-Deeptop/commit/e37caa43a1e94c716d35b4e57cbd12ff1cf06286))
- **settings-general**：修复右键启动状态处理 ([1932f6a](https://github.com/Sparrived/DSH-Deeptop/commit/1932f6a6d340b78dbd023784c10444181c68f6b1))
- **runtime**：区分归档与外部运行时清单 ([d72935a](https://github.com/Sparrived/DSH-Deeptop/commit/d72935a10d6a7ed4533338b24940b02722f996aa))
- **runtime**：显式写入解压运行时清单 ([672ebc1](https://github.com/Sparrived/DSH-Deeptop/commit/672ebc14e50ab05be7894b2b419a904a1d268f7d))
- **runtime**：加速 Windows 内嵌运行时解压 ([2f09186](https://github.com/Sparrived/DSH-Deeptop/commit/2f091862ba51e3a66c17045c8074a8f45777bb04))
- **runtime**：修复 Windows 内嵌清单解压 ([6ff2dfe](https://github.com/Sparrived/DSH-Deeptop/commit/6ff2dfef323055e9129dac141e89628aff37c2fc))
- **release**：按版本通道选择发布说明基线 ([06da239](https://github.com/Sparrived/DSH-Deeptop/commit/06da23936fcf704523e84f285bbb7989f0be9866))
- **ci**：准备 Tauri 资源并迁移 macOS x64 runner ([4365820](https://github.com/Sparrived/DSH-Deeptop/commit/4365820dd68ff2cf20c863019b98820ec5dc0dbf))
- **desktop-export**：收敛为 DSH 原生导出链路 ([50778f1](https://github.com/Sparrived/DSH-Deeptop/commit/50778f17acda857585ccd00bb9eb813cb2a88c2d))
- **build**：允许内嵌运行时内部链接解引用 ([d9d9255](https://github.com/Sparrived/DSH-Deeptop/commit/d9d9255a8ca294a6b3794fb892ed68b4ce9b9a26))
- **runtime**：校验缓存树摘要并强化并发安全 ([51e7fe8](https://github.com/Sparrived/DSH-Deeptop/commit/51e7fe8d804251e1348e390faf18205007a0ce27))
- **runtime**：稳定桌面 Profile 补丁迁移格式 ([132563c](https://github.com/Sparrived/DSH-Deeptop/commit/132563c75c4c746b0df7e6831bf3b87144071487))
- **runtime**：补齐内嵌 DSH Host 依赖闭包 ([745e1fa](https://github.com/Sparrived/DSH-Deeptop/commit/745e1fa3b21c9e3cd5e61df48d567300c7e536f6))
- **runtime**：规范化 Windows 内嵌资源路径 ([31652c1](https://github.com/Sparrived/DSH-Deeptop/commit/31652c1a493b4cf44cfc708a0d30156806e3ef7e))
- **readme**：使用稳定的海报资源地址 ([0b5f7eb](https://github.com/Sparrived/DSH-Deeptop/commit/0b5f7ebec9ab9df4935bec328f344f0190016649))
- **文件看板**：修复右键菜单无法操作 ([ea5c86b](https://github.com/Sparrived/DSH-Deeptop/commit/ea5c86b38e3ece3f013939186e9ffa98792341c4))
- **终端**：修复 dock 无法收起 ([caff487](https://github.com/Sparrived/DSH-Deeptop/commit/caff487d69709c0d6a0456716858acf98fef41cb))
- **聊天动作**：使用最新会话解析路径 ([68355a0](https://github.com/Sparrived/DSH-Deeptop/commit/68355a0a32ca923690de725fc244767b924107e5))
- **会话归档**：删除前停止运行会话 ([85b4265](https://github.com/Sparrived/DSH-Deeptop/commit/85b4265a3349f511ca59456a7db7e5c75fb57602))
- **文件看板**：调整路径菜单显示空间 ([635e907](https://github.com/Sparrived/DSH-Deeptop/commit/635e907206e42a049f4945714d7f5ca08e07280c))
- **新会话**：修复 Logo 字形裁切 ([724344c](https://github.com/Sparrived/DSH-Deeptop/commit/724344cf8fb193e35474343bdf5aab0cf2722902))
- **设置界面**：让 Agent Preset 介绍占满卡片整行 ([0d0e010](https://github.com/Sparrived/DSH-Deeptop/commit/0d0e01083888ae7bc4d17b1497a39c0dfb69cb62))
- **设置界面**：放宽设置面板以完整显示插件页 ([dd4e98f](https://github.com/Sparrived/DSH-Deeptop/commit/dd4e98f3348e9be78f90ef6965f481733c1ca377))
- **开发构建**：修复 Windows npm 命令调用 ([af19600](https://github.com/Sparrived/DSH-Deeptop/commit/af19600200b6c1688c8e99deffe6103b51731f96))
- **开发构建**：移除子进程 shell 弃用警告 ([4e972fc](https://github.com/Sparrived/DSH-Deeptop/commit/4e972fce8bd6798e27076271ef238ba19a0be07e))
- **交付物**：显示生成文件打开指示 ([27021a7](https://github.com/Sparrived/DSH-Deeptop/commit/27021a7f6610f8119dd789184b7c4fe5e191b3d2))
- keep subagent dock open with drawer ([2bb8943](https://github.com/Sparrived/DSH-Deeptop/commit/2bb8943a2368b6f705626e1352e7992016b809a4))
- **文件面板**：统一文件行宽并完整显示大小 ([49a5251](https://github.com/Sparrived/DSH-Deeptop/commit/49a5251cf5d193dd67a543b035c71f892e83f566))
- **设置外观**：修正折叠箭头布局优先级 ([ec31ede](https://github.com/Sparrived/DSH-Deeptop/commit/ec31ede147119398fe145b31753357ac22d89b4f))
- **设置外观**：放宽外观导航按钮选择器 ([4ac0193](https://github.com/Sparrived/DSH-Deeptop/commit/4ac0193206bfd429aea1f168693cb167c70d018b))
- **日志**：异步写盘并限制日志快照 ([d691f9d](https://github.com/Sparrived/DSH-Deeptop/commit/d691f9dd9f6ff9a78c3a50a9dc300f418286ce24))
- **日志**：避免日志页面加载时阻塞 ([89027ec](https://github.com/Sparrived/DSH-Deeptop/commit/89027ecfe62a2995067aa5b9afe377a37897d36d))
- **设置外观**：修正外观折叠箭头位置 ([5f1474b](https://github.com/Sparrived/DSH-Deeptop/commit/5f1474b940bbbfdc2948aef9cdb4b681d592868e))
- **文件面板**：增大文件弹窗显示区域 ([d347776](https://github.com/Sparrived/DSH-Deeptop/commit/d3477766a260a237fd1320c67fa9a226b63fe8a6))
- align subagent dock with utility shelf ([fa7d0a6](https://github.com/Sparrived/DSH-Deeptop/commit/fa7d0a6c369dfc8d8e2332aee297b15d9bbee8fc))

## 🛠️ 改进与优化

- **原生桥接**：整理更新与连接接口调用 ([d1fd0b6](https://github.com/Sparrived/DSH-Deeptop/commit/d1fd0b67d17b9f61c3771d68d8e48c5d46d4cbbc))
- **样式**：拆分主样式表为可维护模块 ([f745c64](https://github.com/Sparrived/DSH-Deeptop/commit/f745c64957d307af8b128a308008448a7a0505f9))

## 📝 文档与测试

- **agent**：清理过时的前端设计模板说明 ([993fc3a](https://github.com/Sparrived/DSH-Deeptop/commit/993fc3a2ed413e86723fd95cdbbe6e38e36f0645))
- **agent**：完善项目 Agent 指令 ([732b8f6](https://github.com/Sparrived/DSH-Deeptop/commit/732b8f6f712a424f0f2a46064c8ac9f9e008f623))
- **runtime**：统一归档清单术语 ([2380f5d](https://github.com/Sparrived/DSH-Deeptop/commit/2380f5d8317ca112f40901eed2080c0b60407fdc))
- **runtime**：更新压缩缓存与桌面验收说明 ([8043e54](https://github.com/Sparrived/DSH-Deeptop/commit/8043e5426b56f830b13d4b9ac76aa3a19ca84310))
- **runtime**：说明固定源码构建与内嵌启动流程 ([bb76cf5](https://github.com/Sparrived/DSH-Deeptop/commit/bb76cf58975a47d5404e8132695d205163c7606b))
- **readme**：重写项目首页并添加海报 ([47e2e47](https://github.com/Sparrived/DSH-Deeptop/commit/47e2e47b891deb3501a82670964dfb45cf41f98c))
- **消息实体**：纳入路径连接识别测试 ([8f66a5f](https://github.com/Sparrived/DSH-Deeptop/commit/8f66a5f718a2c6864dbf4e4dd8e279f5bd13c1dd))
- **文件看板**：校验路径复制使用原生桥接 ([b9d2610](https://github.com/Sparrived/DSH-Deeptop/commit/b9d26104c8a436f730375fc1c7bd6c48e1ace169))

## 📦 构建与发布

- **release**：同步版本到 0.1.3 ([88a315e](https://github.com/Sparrived/DSH-Deeptop/commit/88a315ef7e4ef724a66df5337066b9beddea2187))
- **release**：同步版本到 0.1.3-dev.2 ([39b0837](https://github.com/Sparrived/DSH-Deeptop/commit/39b0837fe45ce98741eecbcf41c3748b8c86a31b))
- **release**：同步版本到 0.1.3-dev.1 ([db02e6e](https://github.com/Sparrived/DSH-Deeptop/commit/db02e6e8897ed2eb30a55f62d1656e0cc28259bd))
- **release**：准备 0.1.2-dev.6 开发版 ([fb3ef31](https://github.com/Sparrived/DSH-Deeptop/commit/fb3ef310b458b811daf6eeeb423b7af00243422e))
- **release**：准备 0.1.2-dev.5 开发版 ([aece81d](https://github.com/Sparrived/DSH-Deeptop/commit/aece81dab2627f04b5c3a865cd2b1f241b9d4b08))
- **release**：准备 0.1.2-dev.4 开发版 ([1ed797f](https://github.com/Sparrived/DSH-Deeptop/commit/1ed797f4ad8a6aebb10d9d4cee14d1c0e6cbc736))
- **rust**：按 rustfmt 整理内嵌运行时校验代码 ([b2a48af](https://github.com/Sparrived/DSH-Deeptop/commit/b2a48af49c476dcca4c6dec9ade68df165ad728a))
- **runtime**：按平台构建并校验内嵌 DSH ([942f69f](https://github.com/Sparrived/DSH-Deeptop/commit/942f69f8dd0f408d2f06e6e000e3b75e0d82fd64))
- **runtime**：固定并构建内嵌 DSH 运行时 ([cf1ac98](https://github.com/Sparrived/DSH-Deeptop/commit/cf1ac98df4b34a5ea47846888501f9f9ccdd9ff2))
- **版本**：准备 0.1.2-dev.3 构建版本 ([fc4046e](https://github.com/Sparrived/DSH-Deeptop/commit/fc4046ef2ffd9fd6b32925e38555250f853952cc))
- **版本**：准备 0.1.2-dev.2 构建版本 ([38e6423](https://github.com/Sparrived/DSH-Deeptop/commit/38e642326780b917ae5663f5b4627214e0b05d66))
- **开发构建**：增加统一开发版构建脚本 ([4467e41](https://github.com/Sparrived/DSH-Deeptop/commit/4467e41cf00b1f0605d0252b5586f3a3effe1d3a))
- **版本**：准备 0.1.2-dev.1 构建版本 ([99db374](https://github.com/Sparrived/DSH-Deeptop/commit/99db374ca8703f006e3f8ae6deb11f0dbaf98c82))
- **发布**：更新 macOS x64 Runner ([4ba8c10](https://github.com/Sparrived/DSH-Deeptop/commit/4ba8c10e89a95653823fb47710a6e5a816470f25))

## 📥 安装与升级

请根据你的操作系统下载下方对应安装包。升级前建议关闭正在运行的 Deeptop 实例，并保留必要的配置与数据备份。

## 📋 完整提交记录

- [查看 v0.1.2 到 88a315ef7e4ef724a66df5337066b9beddea2187 的完整提交记录](https://github.com/Sparrived/DSH-Deeptop/compare/v0.1.2...88a315ef7e4ef724a66df5337066b9beddea2187)

感谢每一位参与反馈、测试与贡献的朋友！
