import { useEffect, useMemo, useRef, useState } from "react";
import { formatRuntimeLogTime, runtimeLogMatches, runtimeLogStreamLabel } from "../app/model";
import type { DshRuntimeLog } from "../lib/desktop";

// Keep opening the settings page responsive during stderr/error bursts.
const MAX_RENDERED_LOGS = 500;

type SettingsLogsPanelProps = {
  logs: DshRuntimeLog[];
  exportPath: string | null;
  exporting: boolean;
  onRefresh: () => void | Promise<unknown>;
  onExport: () => void | Promise<unknown>;
  onOpenLogsDirectory: () => void | Promise<unknown>;
};

export function SettingsLogsPanel({
  logs,
  exportPath,
  exporting,
  onRefresh,
  onExport,
  onOpenLogsDirectory,
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
      .map(([stream, count]) => `${runtimeLogStreamLabel(stream as DshRuntimeLog["stream"])} ${count}`)
      .join(" · ");
  }, [shown]);

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">LOGS</span><h2>日志</h2><p>查看 DSH 运行时、桌面桥接与前端错误的堆栈日志。日志会实时写入运行目录下的 logs 文件夹，也可在此导出后分享给开发者排查问题。</p></div>
        <div className="settings-log-actions">
          <button className="settings-header-action" onClick={() => void onRefresh()}>刷新</button>
          <button className="settings-header-action" onClick={() => void onOpenLogsDirectory()}>打开日志目录</button>
          <button className="settings-header-action" onClick={() => void onExport()} disabled={exporting}>{exporting ? "导出中…" : "导出日志"}</button>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div><h3>运行日志</h3><p>诊断与 stderr 堆栈、DSH 启动输出以及前端错误会按时间顺序记录；保留最近若干条，并持续追加到日志文件。</p></div>
          <span className="settings-count">{shown.length} 条{summary ? ` · ${summary}` : ""}</span>
        </div>
        <div className="settings-log-toolbar">
          <input className="settings-log-filter" type="search" placeholder="筛选：error、stderr、registry、session…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="筛选日志" />
          <label className="settings-log-follow"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />自动滚动</label>
        </div>
        {shown.length === 0 ? (
          <p className="settings-empty">没有匹配的日志。启动 DSH 或触发操作后，日志会实时出现在这里。</p>
        ) : (
          <div className="settings-log-viewer" ref={viewportRef} aria-label="日志内容">
            {shown.map((log, index) => (
              <code className={`settings-log-line settings-log-${log.stream}`} key={`${log.time}-${index}`}>
                <span className="settings-log-time">{formatRuntimeLogTime(log.time)}</span>
                <span className="settings-log-stream">{log.stream}</span>
                <span className="settings-log-text">{log.text}</span>
              </code>
            ))}
          </div>
        )}
        {exportPath && <p className="settings-hint">已导出到：<code>{exportPath}</code></p>}
      </div>
    </div>
  );
}
