import { useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { isWindowChromeControl } from "../app/ui-model";
import type { DshRuntimeLog, DshStatus } from "../lib/desktop";
import { WindowControls } from "./WindowControls";
import { t, type UiLocale } from "../app/i18n";

type StartupSplashProps = {
  locale?: UiLocale;
  status: DshStatus;
  logs: DshRuntimeLog[];
  onOpenNodejsDownload: () => void;
  onRetry: () => void;
  windowMaximized: boolean;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

export function StartupSplash({
  locale = "zh",
  status,
  logs,
  onOpenNodejsDownload,
  onRetry,
  windowMaximized,
  onDrag,
  onMinimize,
  onToggleMaximize,
  onClose,
}: StartupSplashProps) {
  const failed = !status.runtimeStarting && !status.runtimeAvailable;
  const phase = failed ? "error" : status.runtimeStarting ? "start" : "check";
  const phaseTitle = failed ? t("startup.title.failed", locale) : status.runtimeStarting ? t("startup.title.starting", locale) : t("startup.title.checking", locale);
  const phaseDescription = status.message || (failed ? t("startup.desc.interrupted", locale) : t("startup.desc.waiting", locale));
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = logViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [logs]);
  const readoutRows = [
    { label: "Node.js", value: status.nodeAvailable ? t("startup.nodeFound", locale) : t("startup.notFound", locale), tone: status.nodeAvailable ? "ok" : "bad" },
    { label: "NPM", value: status.npmAvailable ? t("startup.available", locale) : t("startup.notFound", locale), tone: status.npmAvailable ? "ok" : "bad" },
    { label: t("startup.workdir", locale), value: status.dshHome, tone: "" },
    { label: t("startup.package", locale), value: status.packageAvailable ? `${status.packageName} · ${t("startup.verified", locale)}` : `${status.packageName} · ${t("startup.verifying", locale)}`, tone: status.packageAvailable ? "ok" : "" },
    { label: "REGISTRY", value: status.selectedRegistry || t("startup.defaultRegistry", locale), tone: "" },
    {
      label: "DESKTOP BRIDGE",
      value: status.runtimeAvailable ? t("startup.connected", locale) : status.runtimeStarting ? t("startup.connecting", locale) : t("startup.waiting", locale),
      tone: status.runtimeAvailable ? "ok" : failed ? "bad" : "",
    },
  ];
  const screenStyle = { "--startup-phase": `"${phase}"` } as CSSProperties;
  return (
    <main className={`startup-screen startup-phase-${phase}`} style={screenStyle} role="status" aria-live="polite">
      <header
        className="window-bar startup-window-bar"
        onMouseDown={onDrag}
        onDoubleClick={(event) => { if (!isWindowChromeControl(event.target)) onToggleMaximize(); }}
      >
        <div className="brand-mark">DSH <span>DEEPTOP</span></div>
        <div className="window-drag-space" />
        <div className="window-actions">
          <WindowControls windowMaximized={windowMaximized} onMinimize={onMinimize} onToggleMaximize={onToggleMaximize} onClose={onClose} />
        </div>
      </header>
      <section className="startup-content" aria-label={t("startup.aria", locale)}>
        <div className="startup-rule" />
        <div className="empty-mark" role="img" aria-label="Deeptop">
          <span className="empty-mark-text" aria-hidden="true">Deeptop</span>
        </div>
        <p className="startup-phase-line">
          {phaseTitle}
          <span className="startup-cursor" aria-hidden="true" />
        </p>
        <p className="startup-message">{phaseDescription}</p>
        <div className="startup-progress" aria-label={t("startup.progressAria", locale)} role="progressbar"><i /></div>
        <div className="startup-readout" aria-label={t("startup.envAria", locale)}>
          {readoutRows.map((row) => (
            <div className={`startup-readout-row${row.tone ? ` tone-${row.tone}` : ""}`} key={row.label}>
              <span>{row.label}</span>
              <code title={row.value}>{row.value}</code>
            </div>
          ))}
        </div>
        <section className={`startup-log-panel ${logs.length > 0 ? "has-logs" : ""}`} aria-label={t("startup.logAria", locale)}>
          <div className="startup-log-heading"><span>EXECUTION OUTPUT</span><em>{logs.length ? t("startup.logCount", locale, { count: logs.length }) : t("startup.waitingCmd", locale)}</em></div>
          <div className="startup-log-viewport" ref={logViewportRef}>
            {logs.length === 0 ? (
              <p className="startup-log-empty">{t("startup.logEmpty", locale)}</p>
            ) : logs.map((log, index) => (
              <div className={`startup-log-line startup-log-${log.stream}`} key={`${index}-${log.text}`}>
                <span>{log.stream === "command" ? "$" : log.stream === "stderr" ? "!" : log.stream === "diagnostic" ? "·" : ">"}</span>
                <b>{log.stream.toUpperCase()}</b>
                <code>{log.text}</code>
              </div>
            ))}
          </div>
        </section>
        {failed ? (
          <div className="startup-actions">
            <button className="startup-retry" onClick={onRetry}>{t("startup.restart", locale)}</button>
            {!status.nodeAvailable && <button className="startup-nodejs" onClick={onOpenNodejsDownload}>{t("startup.installNode", locale)}</button>}
          </div>
        ) : (
          <p className="startup-wait"><i />{t("startup.waitBridge", locale)}</p>
        )}
      </section>
    </main>
  );
}
