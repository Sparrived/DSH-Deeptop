# 政务版主题 · 需求与设计

> 适用于中国党政机关、政务服务平台、电子政务窗口的 Deeptop 主题。本文档描述产品诉求与设计基线，作为后续实现 gov.css 与设置面板接入的依据。

## 1. 背景与定位

### 1.1 为什么需要这个主题

Deeptop 当前的 monokai-pro / one-dark 两套主题都是 IDE 编程语境下的暗色配色，更适合开发者在本地做 Agent 实验。在政务场景中，使用方往往是：

- **机关工作人员**：长时间阅读公文、检索法规、起草材料。需要稳定、低刺激的视觉环境。
- **政务服务窗口**：兼顾投屏演示、来访接待和日常操作。需要正式、可识别的视觉语言。
- **电子政务运维**：经常把界面投到大屏或做内部分发截图。需要清晰的品牌识别。

通用 IDE 主题在上述场景中**识别度不足**、**品牌缺失**、**长时间阅读疲劳**。本主题面向"办公"而非"开发"。

### 1.2 与现有主题的关系

- 政务主题与 monokai-pro / one-dark **并列**，不替换、不互斥。
- 政务主题受相同的设置面板"主题"下拉框管控。
- 政务主题的 CSS 走与 monokai-pro / one-dark 相同的**外部主题文件**机制（`<DSH_HOME>/themes/gov.css`），由 Tauri 端在首次启动或升级时随安装包送达。
- 政务主题**不修改** `monokai-pro` 与 `one-dark` 的现有实现。

### 1.3 范围

- ✅ 提供浅色（默认）和深色（夜间值班）两套配色，单一 CSS 文件内含 `:root` 与 `:root[data-theme="dark"]` 两段。
- ✅ 字体：UI 切换为中文衬线（思源宋体 / 方正书宋 / 宋体回落），代码与等宽字体**保持现状**。
- ✅ 品牌色：中国红 + 国徽金。
- ✅ 走"主题"下拉框，无独立入口。
- ❌ 不修改 monokai-pro / one-dark 的实现。
- ❌ 不修改 `AppTheme` 类型以外的模型层。
- ❌ 不引入新的状态机；`data-theme="light|dark"` 切换机制沿用现有实现。
- ❌ 不包含品牌 logo / 国徽图形（避免政治符号使用风险）。

## 2. 设计基线

### 2.1 视觉气质

- **稳重**：避免高饱和度渐变与大面积深色块。整体留白克制、层级清晰。
- **正式**：标题、按钮、表单的圆角**略小于** monokai-pro，接近"公文用纸"直角切角。
- **温暖但不轻佻**：以宣纸米白为底，配合朱红强调色，避免冷蓝。
- **强可读性**：正文行高 1.7，字号不小于 15px，标题字号阶梯 1.25 / 1.5 / 1.85。

### 2.2 品牌色

| 角色 | 名称 | 浅色 | 深色 |
| --- | --- | --- | --- |
| 主色（强调 / 链接 / 主按钮） | 中国红 | `#C8161D` | `#E64C50` |
| 辅色（点缀 / 选中态 / 数据高亮） | 国徽金 | `#D4A24C` | `#E5BB6E` |
| 背景（`--paper`） | 宣纸 | `#F4EEE3` | `#1F1A14` |
| 次级背景（`--paper-deep`） | 米白 | `#EAE2D2` | `#2A231A` |
| 文本主色（`--ink`） | 墨黑 | `#1A1714` | `#F0E6D2` |
| 文本次色（`--muted`） | 灰墨 | `#5A544A` | `#A89A82` |
| 线条（`--line`） | 纸灰 | `#D6CDB8` | `#3B3324` |
| 线条（`--line-strong`） | 焦墨 | `#B8AC92` | `#54483A` |
| 成功（`--good`） | 官绿 | `#5A7D3D` | `#82AC5C` |
| 警告（`--warning`） | 赭石 | `#B6812A` | `#D4A24C` |
| 危险（`--danger`） | 朱砂 | `#A02A2A` | `#E64C50` |
| 信息（`--info`） | 青灰 | `#4A6B7C` | `#7AA0B5` |

> 中国红 `#C8161D` 取自国旗红标准色（GB 12983-2004 国旗红标准色范围）；国徽金 `#D4A24C` 取自国徽五颗星常用金色范围；其余取自传统"五色"系统，避免出现冷蓝、紫、绿等与公文不协调的色相。

### 2.3 字体

UI 字体栈（在主题 CSS 中重写 `--app-font-family`）：

```css
--app-font-family: "Source Han Serif SC", "Noto Serif CJK SC", "FangSong", "STFangsong", "FangSong_GB2312", "SimSun", "Songti SC", serif;
```

**不修改**以下：

- `--mono`（代码/等宽字体）保持 `"Cascadia Mono", Consolas, monospace`。
- 终端、轨迹、设置内嵌代码等所有 `<code>` / `<pre>` 的字体回退。
- 用户在外观 → 排版中**手动**选择的自定义字体栈依然优先（该值通过 `appearance.fontFamily` 注入到 `--app-font-family`，覆盖主题默认值）。

字号阶梯不变（与 monokai-pro / one-dark 保持一致，避免布局抖动）：

- 正文 `var(--message-font-size)`（默认 15px）
- 行高 `var(--message-line-height)`（默认 1.7）
- 一级标题 24–28px，二级 18–20px，三级 16px

### 2.4 圆角与阴影

- 按钮、输入框、卡片圆角从 monokai-pro 的 8–10px **降低到 4–6px**，接近公文"硬卡"感。
- 阴影调浅：主表面投影 `--shadow-panel: 0 12px 32px rgba(60, 30, 12, 0.10)`（浅色）/ `rgba(0, 0, 0, 0.36)`（深色）。
- 头像、状态指示点允许完全直角（`border-radius: 0`）以呼应公文章法。

### 2.5 关键表面规则

- **窗口栏 / 侧边栏**：`--chrome` 略深于 `--paper`，形成层次而非独立色块。
- **对话主区**：底色 `--paper`；用户消息气泡使用 `--accent` 5–8% 的淡色 mix，不再用蓝色框线。
- **主按钮（"发送"、"应用"等）**：背景 `--accent`，文字 `--on-accent`（浅色下为 `#FFFFFF`，深色下为 `#1A1714`）。
- **危险按钮（"删除"、"终止"）**：背景 `--danger`，文字 `--on-danger`。
- **选中态（侧边栏会话、设置导航）**：左侧 3px `--accent` 边条 + 8% `--accent` 背景 mix，**不再**用蓝色边条。
- **状态点**：会话列表"运行中"用 `--good`；"等待"用 `--warning`；"失败"用 `--danger`。不再使用蓝绿色。

## 3. 文件结构

### 3.1 主题文件位置

- 源文件：`src-tauri/resources/themes/gov.css`（与 `monokai-pro.css` / `one-dark.css` 并列）。
- 运行位置：`<DSH_HOME>/themes/gov.css`，由 Tauri 端在首次启动或 `THEME_FILES_VERSION` 递增时送达。
- 大小限制：与现有主题保持一致，单文件 ≤ 512 KB。

### 3.2 与 monokai-pro / one-dark 的变量契约

`gov.css` 必须**完整**重写 monokai-pro 主题用到的全部 CSS 变量，包括但不限于：

```text
--chrome, --chrome-soft, --chrome-line,
--rail, --rail-surface, --rail-line, --rail-inset,
--rail-text, --rail-muted,
--surface, --surface-raised, --surface-soft, --surface-muted,
--ink, --ink-strong, --ink-muted, --ink-faint,
--line, --line-strong,
--accent, --accent-deep, --accent-soft,
--good, --warning, --danger, --info,
--on-accent, --on-danger,
--overlay,
--code-surface, --code-border, --code-ink, --code-muted,
--paper, --paper-deep, --muted, --faint,
--shadow-panel, --shadow-soft
```

**不**新增变量名（避免动 `01-foundation.css` / `07-workbench-theme.css` 等其他样式层）。也不**删除** monokai-pro 留下的别名映射。

> 实现者：先复制 `monokai-pro.css` 全量变量，再按本文件 §2.2 / §2.4 改写值。确保 `:root` 和 `:root[data-theme="dark"]` 两段都覆盖到。

### 3.3 设置面板集成

- 在 `src/app/model-types.ts` 的 `AppTheme` 联合类型追加 `"gov"`。
- 在 `src/components/SettingsAppearancePanel.tsx` 的主题下拉框追加 `<option value="gov">政务</option>`。
- 在 `src/app/useAppearanceSettings.ts` 的 `setAppTheme` 映射中，`"gov"` 指向 `themeFilesInfo.gov` 路径（与 `one-dark` / `monokai-pro` 同处理）。
- 在 `src/lib/desktop.ts` 的 `ThemeFilesInfo` 接口追加 `gov: string` 字段。
- 在 `src-tauri/src/main.rs` 的 `ThemeFilesInfo` 结构体追加 `gov: String` 字段；`ensure_theme_files()` 在版本升级时**追加写入** `gov.css`。
- `src-tauri/capabilities/main.json` 无需新增权限（仍是 `read_theme_css`）。
- `src-tauri/build.rs` 的 `APP_COMMANDS` 无需新增命令。

> 主题在设置面板的可见下拉项**始终显示** "政务"，不依赖 `themeFilesInfo.gov` 是否存在；若文件不存在则弹出主题加载失败的提示（沿用现有 `themePathError` 机制）。

## 4. 验收

### 4.1 视觉

- [ ] 浅色（默认）下窗口栏 / 侧边栏 / 对话主区三者层次清晰，无颜色粘连。
- [ ] 中国红 `#C8161D` 在"主按钮、链接、选中态边条、用户消息气泡边线"四处一致出现。
- [ ] 国徽金 `#D4A24C` 仅用于"次要点缀、运行指示、数据高亮"，不参与大面积背景。
- [ ] UI 字体为衬线（思源宋体或系统回落），代码块保持等宽字体不变。
- [ ] 圆角 4–6px，告别 monokai-pro 风格的"圆角 8–10px"。
- [ ] 阴影明显但不刺眼；浅色下投影略偏暖棕。

### 4.2 功能

- [ ] 设置 → 外观 → 主题下拉框出现"政务"项，选中后实时切换。
- [ ] light / dark 切换时政务主题**两套**都生效，不退化为默认主题。
- [ ] 政务主题在 `<DSH_HOME>/themes/gov.css` 文件被外部修改后，重新启动可加载新内容（验证用户可在不重新安装的前提下微调）。
- [ ] 政务主题不污染 monokai-pro / one-dark 的行为；切换到 monokai-pro 立刻回到原配色。

### 4.3 兼容性

- [ ] Windows / macOS / Linux 三平台打包产物中 `themes/gov.css` 都被正确送达 `<DSH_HOME>/themes/`。
- [ ] Vite 浏览器预览（无 Tauri）时主题下拉可显示"政务"项；选中后因为 `themeFilesInfo` 为 `null` 应给出"桌面端才可使用"提示（沿用现有 `appearance.notice.themeDesktopOnly` 文案）。
- [ ] i18n 字符串沿用现有"主题"标签，不新增 `gov` 翻译键。

## 5. 后续可选

下列条目**不在**本次实现范围，记录在此供未来扩展：

- 红色 / 金色 / 蓝色 / 黑色 / 白色"五色"细分色板（用于表格、表单验证、状态徽章等更细粒度区分）。
- 政务版 Logo 角标（如果合规允许，可作为窗口栏左侧装饰）。
- 公文常用字号映射（仿宋三号 16px、小标宋二号 22px 等）。
- 与外部 OA / WPS 字体栈兼容方案。
- 投屏模式（更大字号、更强对比、屏蔽次要元素）。

## 6. 配套架构改造

本主题的落地需要 `docs/requirements/theming-pluggable.md` 中描述的主题机制改造：

- 主题文件从 `include_str!` 硬编码改为 Tauri bundle 资源；
- 启动时 `ensure_theme_files()` 只补齐缺失文件，版本升级时整体覆盖并保留最近一份 `.css.bak`；
- `THEME_FILES_VERSION` 守卫 + 启动时 `scan_themes()` 扫描 `<DSH_HOME>/themes/`，让用户可以放下新文件作为新主题。

实现 gov.css 时同步完成上述机制改造；如机制改造排期延后，gov.css 可先以 `custom` 主题路径形式交付使用。
