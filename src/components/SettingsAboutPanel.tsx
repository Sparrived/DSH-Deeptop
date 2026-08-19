import type { UpdateChannel, UpdateCheckState, UpdateDownloadState } from "../app/update-model";

const PROJECT_URL = "https://github.com/Sparrived/DSH-Deeptop";

type SettingsAboutPanelProps = {
  version: string;
  desktop: boolean;
  updateChannel: UpdateChannel;
  updateState: UpdateCheckState;
  downloadState: UpdateDownloadState;
  onChannelChange: (channel: UpdateChannel) => void;
  onCheckForUpdates: () => void;
  onCancelUpdateCheck: () => void;
  onDownloadUpdate: () => void;
  onCancelDownload: () => void;
  onLaunchInstaller: () => void;
  onOpenProject: () => void | Promise<void>;
  onOpenRelease: () => void | Promise<void>;
};

function updateStatus(state: UpdateCheckState) {
  switch (state.status) {
    case "checking":
      return `正在检查${state.channel === "development" ? "开发版" : "正式版"}发布…`;
    case "up-to-date":
      return `已是最新${state.channel === "development" ? "开发版" : "正式版"} · ${new Date(state.checkedAt).toLocaleString()}`;
    case "available":
      return `发现新版本 ${state.latestVersion} · ${state.assetName} · ${new Date(state.checkedAt).toLocaleString()}`;
    case "error":
      return state.message;
    default:
      return "尚未检查更新";
  }
}

export function SettingsAboutPanel({
  version,
  desktop,
  updateChannel,
  updateState,
  downloadState,
  onChannelChange,
  onCheckForUpdates,
  onCancelUpdateCheck,
  onDownloadUpdate,
  onCancelDownload,
  onLaunchInstaller,
  onOpenProject,
  onOpenRelease,
}: SettingsAboutPanelProps) {
  const updateAvailable = updateState.status === "available";
  const updateFailed = updateState.status === "error";
  const updateChecking = updateState.status === "checking";
  const downloading = downloadState.status === "downloading";
  const verifying = downloadState.status === "verifying";
  const ready = downloadState.status === "ready";
  const launching = downloadState.status === "launching";

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
          <div><h3>更新检查与安装</h3><p>更新由桌面原生桥接下载、校验并启动安装，不经过浏览器下载流程。</p></div>
          <span className={`about-update-indicator${updateAvailable ? " available" : updateFailed || downloadState.status === "error" ? " failed" : ""}`} aria-hidden="true" />
        </div>
        <div className="about-update-channel" role="group" aria-label="更新通道">
          <strong>更新通道</strong>
          <button type="button" className={updateChannel === "stable" ? "selected" : ""} onClick={() => onChannelChange("stable")} disabled={!desktop || updateChecking || downloading || verifying || launching}>正式版</button>
          <button type="button" className={updateChannel === "development" ? "selected" : ""} onClick={() => onChannelChange("development")} disabled={!desktop || updateChecking || downloading || verifying || launching}>开发版</button>
          {updateChannel === "development" && <small>开发版可能包含未完成改动</small>}
        </div>
        <div className={`about-update-card${updateAvailable ? " available" : updateFailed || downloadState.status === "error" ? " failed" : ""}`} role="status" aria-live="polite">
          <div className="about-update-copy">
            <strong>{launching ? "正在启动安装程序" : verifying ? "正在校验更新包" : downloading ? `正在下载 ${downloadState.assetName}` : ready ? "更新包已校验，可以安装" : updateAvailable ? `Deeptop ${updateState.latestVersion} 已发布` : updateFailed ? "暂时无法完成更新检查" : updateChecking ? "正在检查更新" : "当前版本"}</strong>
            <small>{desktop ? updateStatus(updateState) : "浏览器预览模式不会访问更新服务，请在桌面端检查。"}</small>
            {downloading && <progress className="about-update-progress" max={downloadState.totalBytes ?? undefined} value={downloadState.totalBytes ? downloadState.downloadedBytes : undefined} />}
            {downloading && <small>{downloadState.percent === null ? `${downloadState.downloadedBytes} bytes` : `${downloadState.percent}% · ${downloadState.downloadedBytes} / ${downloadState.totalBytes ?? "?"} bytes`}</small>}
            {verifying && <small>已下载完成，正在确认 SHA256…</small>}
            {ready && <small>SHA256：{downloadState.sha256}</small>}
            {downloadState.status === "error" && <small>{downloadState.message}</small>}
          </div>
          <div className="about-update-actions">
            {updateChecking ? <button type="button" onClick={onCancelUpdateCheck}>停止检查</button> : <button type="button" className="confirm" onClick={onCheckForUpdates} disabled={!desktop || downloading || verifying || launching}>检查更新</button>}
            {updateAvailable && <button type="button" onClick={() => void onOpenRelease()}>查看发布说明</button>}
            {updateAvailable && !updateState.installSupported && <small>当前平台暂不支持自动安装，请查看发布说明手动安装。</small>}
            {updateAvailable && updateState.installSupported && !downloading && !verifying && !ready && <button type="button" className="confirm" onClick={onDownloadUpdate}>下载并校验</button>}
            {downloading && <button type="button" onClick={onCancelDownload}>取消下载</button>}
            {ready && <button type="button" className="confirm" onClick={onLaunchInstaller}>启动安装</button>}
            {updateFailed && <button type="button" onClick={onCheckForUpdates} disabled={!desktop}>重试</button>}
            {downloadState.status === "error" && <button type="button" onClick={onDownloadUpdate} disabled={!desktop || !updateAvailable}>重新下载</button>}
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
