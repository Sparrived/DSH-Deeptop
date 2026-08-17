# CI/CD 与 GitHub Release

本项目使用 GitHub Actions 完成持续集成、跨平台桌面构建和 GitHub Release。工作流文件位于：

- `.github/workflows/ci.yml`：Pull Request、`main`/`master` 推送和手动触发时运行质量检查；
- `.github/workflows/release.yml`：稳定版或开发版 SemVer Tag、以及手动触发时构建并发布安装包。

## CI 流程

每次 Pull Request 和主分支推送会并行执行三组检查：

1. **Frontend build and tests**
   - Node.js 22.19.0；
   - `npm ci`，使用 `package-lock.json` 的确定性依赖安装；
   - `npm run version:check`，确保 npm、Bridge、Tauri 和 Cargo 清单版本一致；
   - `npm run build`，执行 TypeScript 检查和 Vite 构建；
   - `npm test`，执行 Bridge、Session runtime 和 message retry 测试。
2. **Rust checks**
   - 安装 Tauri Linux 编译依赖；
   - `cargo fmt --all -- --check`；
   - `cargo check --locked`；
   - `cargo test --locked`；
   - `cargo clippy --locked --all-targets -- -D warnings`。
3. **Linux desktop bundle smoke test**
   - 在 Ubuntu runner 上执行 `tauri build --bundles deb --ci --no-sign`；
   - 上传 Debian bundle 作为 7 天保留的验证制品。

Frontend `dist` 也会作为 7 天保留的 CI 制品上传。CI 使用 npm cache 和 Rust cache，并为同一分支的新提交取消仍在运行的旧检查。

## 发布前准备

应用版本必须同时出现在以下位置：

- `package.json`；
- `package-lock.json` 的根版本和 `packages[""]` 版本；
- `deeptop-bridge/package.json`；
- `src-tauri/tauri.conf.json`；
- `src-tauri/Cargo.toml`；
- `src-tauri/Cargo.lock` 中 `deeptop` package 的版本。

使用版本脚本更新全部清单：

```powershell
npm run version:set -- 0.2.0
npm run version:check
npm run build
npm test
```

脚本支持 SemVer prerelease，例如 `0.2.0-rc.1`。不要只修改其中一个清单，否则 CI 和 Release 的版本校验会失败。

### 本地开发版构建脚本

后续本地开发版构建建议直接使用统一脚本：

```powershell
npm run build:dev -- 0.1.2-dev.2
```

脚本会依次同步并检查全部版本清单、运行 JavaScript 测试、构建前端、执行 Rust 格式/编译/测试/Clippy 检查，最后构建 Windows x64 NSIS 安装包并输出文件大小与 SHA256。脚本只修改本地版本清单和构建产物，不执行 `git push`、Tag 或 GitHub Release。

如果只需要查看帮助：

```powershell
npm run build:dev -- --help
```

## 自动 Release

### Tag 触发

将同步版本提交到默认分支后，创建并推送稳定版 Tag：

```powershell
npm run version:set -- 0.2.0
npm run version:check
git add package.json package-lock.json deeptop-bridge/package.json src-tauri scripts .github docs README.md README.zh.md
git commit -m "chore: prepare release v0.2.0"
git tag v0.2.0
git push origin main --follow-tags
```

开发版使用带 prerelease 标识的版本号。版本清单必须先同步到完整版本，再创建 Tag：

```powershell
npm run version:set -- 0.1.1-dev.1
npm run version:check
npm run build
npm test
git add package.json package-lock.json deeptop-bridge/package.json src-tauri scripts .github docs README.md README.zh.md
git commit -m "chore: prepare development release v0.1.1-dev.1"
git tag v0.1.1-dev.1
git push origin master --follow-tags
```

`vMAJOR.MINOR.PATCH` Tag 会创建稳定 Release；`vMAJOR.MINOR.PATCH-identifier` Tag 会创建标记为 **Pre-release** 的开发版 Release。开发版不会被 GitHub 标记为 Latest。

工作流会：

1. 从 Tag 检出完全一致的源码；
2. 验证 Tag 是 `v` 开头的 SemVer，并与所有应用清单一致；
3. 在原生 runner 上并行构建：
   - 稳定版 Windows x64：NSIS `.exe` 和 MSI `.msi`；
   - 开发版 Windows x64：NSIS `.exe`；Windows MSI 要求 prerelease 标识为纯数字且范围不超过 65535，因此带 `-dev.1` 的版本会自动跳过 MSI；
   - Linux x64：Debian `.deb` 和 AppImage；
   - macOS x64：DMG；
   - macOS arm64：DMG；
4. 对 Tauri 输出进行稳定命名；
5. 先上传 GitHub Actions 制品（保留 14 天）；
6. 汇总所有平台资产，生成 `SHA256SUMS`；
7. 根据 Tag 生成稳定版或 Development 标题；开发版自动传递 `--prerelease`，不会成为 Latest；
8. 创建 GitHub Release 并生成 GitHub release notes。若同一 Tag 的 Release 已存在，重跑时会覆盖同名资产并同步 Release 的 prerelease 状态，不会创建重复 Release。

### 手动触发

也可以在 GitHub Actions 页面手动运行 **Release**，输入已经存在的 Tag，例如 `v0.2.0` 或 `v0.1.1-dev.1`，并选择 `auto`、`stable` 或 `development` 通道。`auto` 会根据 Tag 自动判断；显式通道与 Tag 类型不一致时工作流会失败。

手动运行仍会从该 Tag 构建，不会从当前分支构建，也不会自动改写版本或创建 Tag。只有已经推送到远端的 Tag 才能通过 Release 的 `--verify-tag` 校验。

### GitHub 仓库设置

Release 工作流默认使用 `contents: read`，仅 `publish` job 提升为 `contents: write` 创建或更新 Release：

```yaml
permissions:
  contents: read

jobs:
  publish:
    permissions:
      contents: write
```

如果仓库级别的 Actions 权限被限制为只读，需要在 **Settings → Actions → General → Workflow permissions** 中允许 workflow 写入仓库内容。若组织策略禁止 `GITHUB_TOKEN` 创建 Release，需要由仓库管理员调整策略；工作流不使用个人访问令牌。

## Bundle 与签名

`src-tauri/tauri.conf.json` 已启用 `bundle.active`，并显式声明通用图标资源。未配置 `targets`，由 Release workflow 的 `--bundles` 参数按平台收窄目标。

Release workflow 使用 `tauri build --ci --no-sign`，当前流程生成**未签名**安装包：

- Windows 安装包可以安装，但可能显示 SmartScreen 警告；
- macOS DMG/应用未进行 Apple Developer 签名与公证，首次打开可能需要用户在系统设置中允许；
- Linux 包没有额外的发行版签名。

生产发布如需可信安装体验，应在 GitHub Environments 或 Organization Secrets 中配置签名材料，并在对应平台构建步骤中加入：

- Windows 代码签名证书和时间戳服务；
- Apple Developer 证书、App Store Connect API 或公证凭据；
- Linux 包签名和发布仓库元数据。

签名密钥不得提交到仓库、Tag、构建日志或 Tauri 配置文件。

## 故障排查

- **版本校验失败**：执行 `npm run version:set -- <版本>`，检查 `git diff`，再重新创建 Tag。已推送的 Tag 不应指向版本不一致的提交。
- **找不到安装包**：查看对应矩阵任务的 Tauri 构建日志；`collect-release-assets.mjs` 只接受预期的 `nsis`、`msi`、`deb`、`appimage` 和 `dmg` 输出。
- **Release 已存在**：重新运行工作流会使用 `gh release upload --clobber` 更新同名资产；不要同时启动同一个 Tag 的多个 Release 工作流。
- **手动输入不合法 Tag**：工作流将输入作为环境变量传给 Bash，并要求 `v<SemVer>`；不会从分支最新提交或用户输入的任意字符串构建。
- **Windows 开发版 MSI 构建失败**：Windows MSI 不接受 `dev` 这样的非数字 prerelease identifier；工作流会自动为开发版只构建 NSIS，稳定版仍构建 NSIS + MSI。
- **开发版未显示为 Pre-release**：检查 Tag 是否包含 `-` prerelease 段，例如 `v0.1.1-dev.1`；稳定版本号不能强制选择 `development` 通道。
- **macOS 打开受阻**：这是未签名/未公证包的预期行为，不是构建失败；完成 Apple 签名和公证后再用于正式分发。
- **DSH 运行时问题**：构建矩阵会先从 `vendor/dsh` 子模块生成并校验平台对应的 `dsh-runtime`；应用运行时只通过系统 Node.js 执行安装包内嵌入口，不访问 npm registry，也不回退到 PATH 或全局 npm。
