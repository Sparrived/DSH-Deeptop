# Deeptop Cordis plugins

This directory is the source of the embedded `deeptop-bridge` runtime package. The package name remains stable so existing desktop Profiles continue to resolve it, while every built-in Cordis plugin owns an independent folder and `index.mjs` entry.

| Directory | Responsibility |
| --- | --- |
| `desktop-bridge/` | `deeptop/1` JSONL transport, desktop API allowlist, native boundary adapters and repair helpers |
| `message-annotations/` | Durable message-annotation Cordis service |
| `message-annotations-ui/` | Host registration for the built-in message-annotation Client Plugin |
| `session-pins/` | Durable workspace session-pin service and its pure model |
| `skill-installer/` | Skill installer plugin (approval-gated; the prompt is skipped under a user-chosen never-approval policy such as the full-access preset) and shared installer implementation |
| `theme-settings/` | Host registration for desktop theme and locale settings |
| `ui-registry/` | UI Plugin registry, manifest validation, scoped routes and storage |

## 嵌入式桌面 Bridge 辅助模块

- `desktop-bridge/dsh-home.mjs`：从挂载的 Cordis 上下文解析当前 DSH 主目录（优先 boot 提供的 `dshHomePath` 访问器，其次启动器提供的 `dshHome` 插槽；未挂载的独立调用方读取 `DSH_HOME`）。
- `desktop-bridge/profile-patch.mjs`：提供 Profile patch 的受管区块定位、格式规范化，以及进程内和跨进程的串行写入锁。
- `desktop-bridge/tool-config.mjs`：读取、校验并脱敏用户 Skills 与 Deeptop 受管 MCP 配置；设置页另从已运行的 Loader 投影 Profile 原生 MCP 条目为只读内容，并以 revision 和事务方式更新受管 MCP 配置。
- `skill-installer/managed-registry.mjs`：独立的 Skill 安装登记表；只有同时匹配 marker 与登记记录（含随机 installationId）的目录才允许从设置中删除，损坏的登记不会阻塞库存读取。

`cordis.patch.yml`, `desktop-profile.json`, `profile.patch.yml` and `presets/` describe the containing desktop Profile rather than one plugin, so they stay at this directory root.

Tauri embeds these sources and materializes the same nested layout under `$DSH_HOME/profiles/node_modules/deeptop-bridge`. Do not edit that generated directory. When adding a plugin, create a new folder with an `index.mjs`, add an explicit package export and Profile entry, update `bundled_bridge_files()` in `src-tauri/src/main.rs`, and extend `structure.test.mjs`.
