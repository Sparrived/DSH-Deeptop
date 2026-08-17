import type { UpdateCheckState } from "../app/update-model";

const PROJECT_URL = "https://github.com/Sparrived/DSH-Deeptop";

type SettingsAboutPanelProps = {
  version: string;
  desktop: boolean;
  updateState: UpdateCheckState;
  onCheckForUpdates: () => void;
  onCancelUpdateCheck: () => void;
  onOpenProject: () => void | Promise<void>;
  onOpenRelease: () => void | Promise<void>;
};

function updateStatus(state: UpdateCheckState) {
  switch (state.status) {
    case "checking":
      return "正在连接 GitHub 检查稳定版发布…";
    case "up-to-date":
      return `已是最新版本 · ${new Date(state.checkedAt).toLocaleString()}`;
    case "available":
      return `发现新版本 ${state.latestVersion} · ${new Date(state.checkedAt).toLocaleString()}`;
    case "error":
      return state.message;
    default:
      return "尚未检查更新";
  }
}

export function SettingsAboutPanel({
  version,
  desktop,
  updateState,
  onCheckForUpdates,
  onCancelUpdateCheck,
  onOpenProject,
  onOpenRelease,
}: SettingsAboutPanelProps) {
  const updateAvailable = updateState.status === "available";
  const updateFailed = updateState.status === "error";
  const updateChecking = updateState.status === "checking";

  return (
    <div className="settings-page settings-about-page">
      <div className="settings-page-header">
        <div>
          <span className="settings-overline">ABOUT / DEEPTOP</span>
          <h2>关于 Deeptop</h2>
          <p>把 DSH 的运行时带到一个更顺手、更可靠的原生桌面工作台。</p>
        </div>
        <button className="settings-header-action" type="button" onClick={() => void onOpenProject()}>
          项目主页
        </button>
      </div>

      <section className="about-identity" aria-label="项目介绍">
        <div className="about-mark" aria-hidden="true">D</div>
        <div className="about-identity-copy">
          <div className="about-identity-title"><strong>Deeptop</strong><span>Native DSH Workbench</span></div>
          <p>Deeptop 是 DeepSeek Harness（DSH）的轻量级原生桌面客户端。Tauri 负责窗口、进程管理与系统能力，React 负责交互界面，DSH 继续保留 Agent、Session、Tool、Model 和插件等领域语义。</p>
          <div className="about-meta-list">
            <span><b>版本</b><code>{version}</code></span>
            <span><b>运行方式</b><code>Tauri + React + DSH</code></span>
            <span><b>源码</b><code>{PROJECT_URL.replace("https://", "")}</code></span>
          </div>
        </div>
      </section>

      <section className="settings-block about-update-block">
        <div className="settings-block-heading">
          <div><h3>更新检查</h3><p>只检查 GitHub 上的稳定版发布，不会在后台下载或替换安装包。</p></div>
          <span className={`about-update-indicator${updateAvailable ? " available" : updateFailed ? " failed" : ""}`} aria-hidden="true" />
        </div>
        <div className={`about-update-card${updateAvailable ? " available" : updateFailed ? " failed" : ""}`} role="status" aria-live="polite">
          <div className="about-update-copy">
            <strong>{updateAvailable ? `Deeptop ${updateState.latestVersion} 已发布` : updateFailed ? "暂时无法完成更新检查" : updateChecking ? "正在检查更新" : "当前版本"}</strong>
            <small>{desktop ? updateStatus(updateState) : "浏览器预览模式不会访问更新服务，请在桌面端检查。"}</small>
          </div>
          <div className="about-update-actions">
            {updateChecking ? <button type="button" onClick={onCancelUpdateCheck}>停止检查</button> : <button type="button" className="confirm" onClick={onCheckForUpdates} disabled={!desktop}>检查更新</button>}
            {updateAvailable && <button type="button" onClick={() => void onOpenRelease()}>查看发布说明</button>}
            {updateFailed && <button type="button" onClick={onCheckForUpdates} disabled={!desktop}>重试</button>}
          </div>
        </div>
      </section>

      <section className="settings-block about-links-block">
        <div className="settings-block-heading"><div><h3>项目</h3><p>问题反馈、功能建议和版本记录都维护在项目仓库中。</p></div></div>
        <div className="about-link-list">
          <button type="button" onClick={() => void onOpenProject()}><span><strong>GitHub 仓库</strong><small>查看源码、文档与贡献指南</small></span><b>↗</b></button>
          <div className="about-link-row"><span><strong>当前版本</strong><small>发布说明不会自动安装更新，下载与安装由你确认。</small></span><code>v{version}</code></div>
        </div>
      </section>
    </div>
  );
}
