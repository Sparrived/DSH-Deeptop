import { useEffect, useMemo, useRef, useState } from "react";
import { formatRuntimeLogTime, runtimeLogMatches } from "../app/model";
import type { DshRuntimeLog } from "../lib/desktop";
import { t, type UiLocale } from "../app/i18n";

// Keep opening the settings page responsive during stderr/error bursts.
const MAX_RENDERED_LOGS = 500;

type SettingsLogsPanelProps = {
  logs: DshRuntimeLog[];
  exportPath: string | null;
  exporting: boolean;
  onRefresh: () => void | Promise<unknown>;
  onExport: () => void | Promise<unknown>;
  onOpenLogsDirectory: () => void | Promise<unknown>;
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
};

export function SettingsLogsPanel({
  logs,
  exportPath,
  exporting,
  onRefresh,
  onExport,
  onOpenLogsDirectory,
  locale = "zh",
}: SettingsLogsPanelProps) {
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const shown = useMemo(() => {
    const filtered = query.trim()
      ? logs.filter((log) => runtimeLogMatches(log, query))
      : logs;
    return filtered.slice(-MAX_RENDERED_LOGS);
  }, [logs, query]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && follow) viewport.scrollTop = viewport.scrollHeight;
  }, [shown.length, follow]);

  const summary = useMemo(() => {
    const counts: Partial<Record<DshRuntimeLog["stream"], number>> = {};
    for (const log of shown) {
      counts[log.stream] = (counts[log.stream] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([stream, count]) => `${t(`logs.stream.${stream as DshRuntimeLog["stream"]}`, locale)} ${count}`)
      .join(" · ");
  }, [shown]);

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">LOGS</span><h2>{t("settings.logs", locale)}</h2><p>{t("logs.subtitle", locale)}</p></div>
        <div className="settings-log-actions">
          <button className="settings-header-action" onClick={() => void onRefresh()}>{t("logs.refresh", locale)}</button>
          <button className="settings-header-action" onClick={() => void onOpenLogsDirectory()}>{t("logs.openDirectory", locale)}</button>
          <button className="settings-header-action" onClick={() => void onExport()} disabled={exporting}>{exporting ? t("logs.exporting", locale) : t("logs.export", locale)}</button>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div><h3>{t("logs.title", locale)}</h3><p>{t("logs.hint", locale)}</p></div>
          <span className="settings-count">{t("logs.count", locale, { count: shown.length })}{summary ? ` · ${summary}` : ""}</span>
        </div>
        <div className="settings-log-toolbar">
          <input className="settings-log-filter" type="search" placeholder={t("logs.filterPlaceholder", locale)} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("logs.filterAria", locale)} />
          <label className="settings-log-follow"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />{t("logs.autoScroll", locale)}</label>
        </div>
        {shown.length === 0 ? (
          <p className="settings-empty">{t("logs.empty", locale)}</p>
        ) : (
          <div className="settings-log-viewer" ref={viewportRef} aria-label={t("logs.viewerAria", locale)}>
            {shown.map((log, index) => (
              <code className={`settings-log-line settings-log-${log.stream}`} key={`${log.time}-${index}`}>
                <span className="settings-log-time">{formatRuntimeLogTime(log.time)}</span>
                <span className="settings-log-stream">{log.stream}</span>
                <span className="settings-log-text">{log.text}</span>
              </code>
            ))}
          </div>
        )}
        {exportPath && <p className="settings-hint">{t("logs.exportedTo", locale)}<code>{exportPath}</code></p>}
      </div>
    </div>
  );
}
