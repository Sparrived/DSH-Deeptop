import type { UpdateChannel, UpdateCheckState, UpdateDownloadState } from "../app/update-model";
import { t, type UiLocale } from "../app/i18n";

const PROJECT_URL = "https://github.com/Sparrived/DSH-Deeptop";

function channelLabel(channel: UpdateChannel, locale: UiLocale): string {
  return t(channel === "development" ? "about.channel.development" : "about.channel.stable", locale);
}

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
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
};

function updateStatus(state: UpdateCheckState, locale: UiLocale) {
  const channel = channelLabel(state.channel, locale);
  switch (state.status) {
    case "checking":
      return t("about.check.checking", locale, { channel });
    case "up-to-date":
      return t("about.check.upToDate", locale, { channel, at: new Date(state.checkedAt).toLocaleString() });
    case "available":
      return t("about.check.available", locale, { version: state.latestVersion, asset: state.assetName, at: new Date(state.checkedAt).toLocaleString() });
    case "error":
      return state.message;
    default:
      return t("about.check.never", locale);
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
  locale = "zh",
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
          <h2>{t("settings.about", locale)} Deeptop</h2>
          <p>{t("about.subtitle", locale)}</p>
        </div>
        <button className="settings-header-action" type="button" onClick={() => void onOpenProject()}>
          {t("about.projectHome", locale)}
        </button>
      </div>

      <section className="about-identity" aria-label={t("about.identityAria", locale)}>
        <div className="about-mark" aria-hidden="true">D</div>
        <div className="about-identity-copy">
          <div className="about-identity-title"><strong>Deeptop</strong><span>Native DSH Workbench</span></div>
          <p>{t("about.description", locale)}</p>
          <div className="about-meta-list">
            <span><b>{t("about.version", locale)}</b><code>{version}</code></span>
            <span><b>{t("about.runtime", locale)}</b><code>Tauri + React + DSH</code></span>
            <span><b>{t("about.source", locale)}</b><code>{PROJECT_URL.replace("https://", "")}</code></span>
          </div>
        </div>
      </section>

      <section className="settings-block about-update-block">
        <div className="settings-block-heading">
          <div><h3>{t("about.updateTitle", locale)}</h3><p>{t("about.updateHint", locale)}</p></div>
          <span className={`about-update-indicator${updateAvailable ? " available" : updateFailed || downloadState.status === "error" ? " failed" : ""}`} aria-hidden="true" />
        </div>
        <div className="about-update-channel" role="group" aria-label={t("about.channel", locale)}>
          <strong>{t("about.channel", locale)}</strong>
          <button type="button" className={updateChannel === "stable" ? "selected" : ""} onClick={() => onChannelChange("stable")} disabled={!desktop || updateChecking || downloading || verifying || launching}>{t("about.channel.stable", locale)}</button>
          <button type="button" className={updateChannel === "development" ? "selected" : ""} onClick={() => onChannelChange("development")} disabled={!desktop || updateChecking || downloading || verifying || launching}>{t("about.channel.development", locale)}</button>
          {updateChannel === "development" && <small>{t("about.channel.developmentNote", locale)}</small>}
        </div>
        <div className={`about-update-card${updateAvailable ? " available" : updateFailed || downloadState.status === "error" ? " failed" : ""}`} role="status" aria-live="polite">
          <div className="about-update-copy">
            <strong>{launching ? t("about.status.launching", locale) : verifying ? t("about.status.verifying", locale) : downloading ? t("about.status.downloading", locale, { name: downloadState.assetName }) : ready ? t("about.status.ready", locale) : updateAvailable ? t("about.status.available", locale, { version: updateState.latestVersion }) : updateFailed ? t("about.status.failed", locale) : updateChecking ? t("about.status.checking", locale) : t("about.status.current", locale)}</strong>
            <small>{desktop ? updateStatus(updateState, locale) : t("about.check.previewNote", locale)}</small>
            {downloading && <progress className="about-update-progress" max={downloadState.totalBytes ?? undefined} value={downloadState.totalBytes ? downloadState.downloadedBytes : undefined} />}
            {downloading && <small>{downloadState.percent === null ? `${downloadState.downloadedBytes} bytes` : `${downloadState.percent}% · ${downloadState.downloadedBytes} / ${downloadState.totalBytes ?? "?"} bytes`}</small>}
            {verifying && <small>{t("about.check.verifyingSha", locale)}</small>}
            {ready && <small>{t("about.check.sha256", locale, { hash: downloadState.sha256 })}</small>}
            {downloadState.status === "error" && <small>{downloadState.message}</small>}
          </div>
          <div className="about-update-actions">
            {updateChecking ? <button type="button" onClick={onCancelUpdateCheck}>{t("about.stopCheck", locale)}</button> : <button type="button" className="confirm" onClick={onCheckForUpdates} disabled={!desktop || downloading || verifying || launching}>{t("about.checkForUpdates", locale)}</button>}
            {updateAvailable && <button type="button" onClick={() => void onOpenRelease()}>{t("about.viewReleaseNotes", locale)}</button>}
            {updateAvailable && !updateState.installSupported && <small>{t("about.installUnsupported", locale)}</small>}
            {updateAvailable && updateState.installSupported && !downloading && !verifying && !ready && <button type="button" className="confirm" onClick={onDownloadUpdate}>{t("about.downloadVerify", locale)}</button>}
            {downloading && <button type="button" onClick={onCancelDownload}>{t("about.cancelDownload", locale)}</button>}
            {ready && <button type="button" className="confirm" onClick={onLaunchInstaller}>{t("about.launchInstall", locale)}</button>}
            {updateFailed && <button type="button" onClick={onCheckForUpdates} disabled={!desktop}>{t("common.retry", locale)}</button>}
            {downloadState.status === "error" && downloadState.canInstall ? <button type="button" className="confirm" onClick={onLaunchInstaller}>{t("about.retryInstall", locale)}</button> : downloadState.status === "error" && <button type="button" onClick={onDownloadUpdate} disabled={!desktop || !updateAvailable}>{t("about.redownload", locale)}</button>}
          </div>
        </div>
      </section>

      <section className="settings-block about-links-block">
        <div className="settings-block-heading"><div><h3>{t("about.projectTitle", locale)}</h3><p>{t("about.projectHint", locale)}</p></div></div>
        <div className="about-link-list">
          <button type="button" onClick={() => void onOpenProject()}><span><strong>{t("about.githubRepo", locale)}</strong><small>{t("about.githubRepoHint", locale)}</small></span><b>↗</b></button>
          <div className="about-link-row"><span><strong>{t("about.status.current", locale)}</strong><small>{t("about.currentVersionHint", locale)}</small></span><code>v{version}</code></div>
        </div>
      </section>
    </div>
  );
}
