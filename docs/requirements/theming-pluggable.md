# 主题机制改造 · 主题可外部插拔

> 把"主题内容"从 Rust 源码 `include_str!` 解耦，让 monokai-pro / one-dark / gov 都作为"打包资源"送达 `<DSH_HOME>/themes/`，并允许用户在目录里放新文件作为新主题。配套 `docs/requirements/gov-theme.md` 的设计落地。

## 1. 改造后形态

```
打包资源(src-tauri/resources/themes/*.css)
   │
   │  Tauri bundle.resources
   ▼
安装目录($INSTDIR/resources/themes/*.css)
   │
   │  启动时 ensure_theme_files() 检查
   ▼
用户数据目录(<DSH_HOME>/themes/*.css)   ←── 启动时实际读取位置
   │
   │  scan_themes() 扫描
   ▼
前端 useAppearanceSettings 缓存主题 id 列表
   │
   │  setAppTheme(<id>)
   ▼
前端 themeCssPath = <DSH_HOME>/themes/<id>.css
   │
   │  read_theme_css(path)
   ▼
前端 <style id="deeptop-theme-path">
```

## 2. 关键决策（已与用户确认）

| # | 决策 | 选择 |
| --- | --- | --- |
| 1 | `THEME_FILES_VERSION` 升级时遇到目标文件已存在 | **覆盖现有文件，旧文件改名为 `*.css.bak`；仅保留最近一个 .bak，多余的旧 .bak 在覆盖前被删除** |
| 2 | 内置主题清单存放位置 | **Rust 源码 `const BUNDLED_THEMES: &[(&str, &str)]`** |
| 3 | 打包资源缺失时是否回退到 `include_str!` | **不提供 fallback，构建/打包问题 fail-fast** |
| 4 | 启动时是否扫描 themes/ 下所有 .css | **是，启动时自动扫；下拉项 = 内置置顶 + 外部按字母序** |

## 3. 变更清单

按模块拆分，每块独立 commit。

### 模块 A：Rust 资源改为 bundle 资源

- **`src-tauri/src/main.rs`**
  - 删除 `MONOKAI_PRO_THEME_CSS` / `ONE_DARK_THEME_CSS` 两个 `include_str!`。
  - 引入 `const BUNDLED_THEMES: &[(&str, &str)] = &[("monokai-pro", "themes/monokai-pro.css"), ("one-dark", "themes/one-dark.css"), ("gov", "themes/gov.css")];`。
  - 保留 `THEME_FILES_VERSION`（递增时仍触发整体覆盖 + .bak 流程）。
  - 重写 `ensure_theme_files()`：
    1. 创建 `<DSH_HOME>/themes/`。
    2. 读 `<DSH_HOME>/themes/.version`；如落后，对每个内置主题：
       - 如果 `.bak` 已存在，删除它（保证覆盖前只有一份 .bak）。
       - 如果目标 `.css` 存在，把它改名为 `.css.bak`。
       - 从 `app.path().resource_dir().join(bundled_path)` 复制新内容到目标 `.css`。
    3. 写 `.version`。
    4. **不**返回具体主题路径；只返回 `themes_dir`。
  - 新增 `#[tauri::command] fn scan_themes() -> Result<Vec<String>, String>`：扫描 `<DSH_HOME>/themes/*.css`（排除 `.bak` 与 `.version`），按文件名去后缀排序。
  - `struct ThemeFilesInfo` 简化为 `struct ThemeFilesInfo { themes_dir: String }`。
- **`src-tauri/tauri.conf.json`**
  - `bundle.resources` 增加三条映射：
    - `resources/themes/monokai-pro.css` → `themes/monokai-pro.css`
    - `resources/themes/one-dark.css` → `themes/one-dark.css`
    - `resources/themes/gov.css` → `themes/gov.css`
- **`src-tauri/build.rs`**
  - `APP_COMMANDS` 增 `"scan_themes"`。
- **`src-tauri/capabilities/main.json`**
  - `permissions` 增 `"allow-scan-themes"`。
- **`docs/DSH_NATIVE_COORDINATION.md`**
  - 增补"主题资源由 bundle 提供 + 用户可手动放入新文件"说明（如果该文档当前未涉及主题机制，跳过）。
- **`docs/PROJECT_GUIDE.md`**
  - 第 4 节"测试与构建"补"主题随包复制 + `<DSH_HOME>/themes/` 用途"。

### 模块 B：前端切到"按目录约定拼路径 + 动态下拉"

- **`src/lib/desktop.ts`**
  - `ThemeFilesInfo` 字段从 `{ themesDir, monokaiPro, oneDark }` 简化为 `{ themesDir }`。
  - 新增 `scanThemes(): Promise<string[]>`。
- **`src/app/useAppearanceSettings.ts`**
  - `readAppTheme` 接受任意 `string`；`localStorage["deeptop.dark-theme"]` 存的是主题 id 字符串。
  - 在 `useEffect` 拿到 `themeFilesInfo.themesDir` 后，调 `scanThemes()` 缓存到 `themeIds: string[]`。
  - 选中 monokai-pro / one-dark / gov 时 `themeCssPath = themesDir/<id>.css`。
  - 提供 `themeIds` 与 `rescanThemes()`。
- **`src/app/model-types.ts`**
  - `AppTheme` 联合类型简化为 `export type AppTheme = string;`，由前端运行时校验。
- **`src/components/SettingsAppearancePanel.tsx`**
  - 主题下拉从硬编码三 option 改为：
    - 内置项（顺序固定：`monokai-pro` → `one-dark` → `gov`），仅当 `themeIds` 含对应 id 时显示。
    - 外部 `themeIds` 中不属于内置的项，按字母序跟在后面。
    - `custom` 始终是最后一项。
  - 主题子页面加"重新扫描"按钮，调用 `rescanThemes()`，刷新下拉项并把列表写入状态。
- **`src/App.tsx`**
  - 涉及 `appTheme` 的类型收窄（`if (nextTheme === "one-dark" || nextTheme === "monokai-pro" || nextTheme === "custom")` 等）改为 `if (nextTheme === "custom" || !nextTheme)` 这种"非空即主题 id"判断。
  - `setAppTheme("monokai-pro")` 这种 reset 路径保持原状（monokai-pro 是稳定内置）。
  - 导入/导出配置里 `appTheme` 字符串直接读写，依赖 `themeIds` 提供校验。

### 模块 C：政务主题落盘

- 新增 `src-tauri/resources/themes/gov.css`（按 `docs/requirements/gov-theme.md` §2.2 / §2.4 实现：宣纸 + 中国红 + 国徽金 + 思源宋体 + 4–6px 圆角）。
- `src-tauri/tauri.conf.json` 的 `bundle.resources` 增 `resources/themes/gov.css` 映射（在模块 A 一起改）。
- `src-tauri/src/main.rs` 的 `BUNDLED_THEMES` 增 `("gov", "themes/gov.css")`（在模块 A 一起改）。
- `SettingsAppearancePanel.tsx` 内置下拉项增 `gov`（在模块 B 一起改）。
- i18n 不新增键；下拉项 "Monokai Pro" / "One Dark" / "政务" 直接以中文字面量写在组件里。

### 模块 D：测试与文档同步

- `npm test` 跑全部。
- `npm run test:bridge`。
- `cargo fmt --all -- --check`。
- `cargo check --locked`。
- `cargo test --locked`（含 `every_registered_command_is_acl_listed_in_build_script` 与 `materializes_every_local_bridge_export`）。
- 同步 `docs/DSH_NATIVE_COORDINATION.md` 与 `docs/PROJECT_GUIDE.md` 相关段落。

## 4. 验收

- [ ] `npm run build` 通过；`npm test` 通过；`npm run test:bridge` 通过。
- [ ] `cargo fmt --all -- --check` 通过；`cargo check --locked` 通过；`cargo test --locked` 通过。
- [ ] 全新安装（`th\themes\` 不存在）：monokai-pro / one-dark / gov 三个文件**都被自动创建**。
- [ ] 用户在 monokai-pro.css 里改一行色值后再次启动，**不**被覆盖（前提：THEME_FILES_VERSION 不变）。
- [ ] `THEME_FILES_VERSION` 递增后的首次启动：每个内置主题都被新内容覆盖，旧文件改名为 `*.css.bak`，且 themes/ 中最多只有一个 `.bak` 文件。
- [ ] 用户在 `themes/` 放一个 `custom-theme.css`，启动后下拉框出现"custom-theme"项，选中后立即生效。
- [ ] 删除 monokai-pro.css 后再次启动，文件被自动补齐。
- [ ] Vite 浏览器预览：主题下拉仍出现 monokai-pro / one-dark / gov 三个内置项；选中后给出"桌面端才可使用"提示。
- [ ] `tauri build` 产出的安装包中 `resources/themes/*.css` 三个文件都存在（macOS .app、Linux AppImage、Windows nsis 三平台都覆盖）。

## 5. 风险与回退

- **风险 1：.bak 仅保留最近一份时，被覆盖前的最后一次用户编辑也会丢失**。用户如果希望保留全部历史，需要主动在外部做版本管理。
- **风险 2：Tauri 2 的 resources 在 `app.path().resource_dir()` 下的路径在 macOS / Windows / Linux 三平台行为不同**，需要在三平台验证 `themes/monokai-pro.css` 实际位置。
- **风险 3：移除 `include_str!` 后，`cargo build` 不再校验主题 CSS 语法**。语法错误要到运行期才暴露。补救：在 `cargo test` 里加一个解析 smoke test，读取 bundle 资源确认非空。
- **回退**：每模块独立 commit；任一模块失败可单独 revert，不影响其他模块。

## 6. 实施顺序

1. 模块 A（Rust 资源化 + scan_themes + 旧字面量清理）
2. 模块 B（前端动态下拉 + 主题 id 拼路径 + rescan 按钮）
3. 模块 C（政务主题 CSS 落盘 + 同步接入 A/B 的清单）
4. 模块 D（测试与文档同步）

每完成一个模块立即 commit，commit 信息遵循仓库约定 `<type>(<scope>): <中文摘要>`。
