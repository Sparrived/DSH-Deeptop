import { useEffect, useRef, type CSSProperties, type MouseEvent } from "react";
import { isWindowChromeControl } from "../app/ui-model";
import type { DshRuntimeLog, DshStatus } from "../lib/desktop";
import { WindowControls } from "./WindowControls";

type StartupSplashProps = {
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
  const phaseTitle = failed ? "DeepSeek Harness 暂时无法启动" : status.runtimeStarting ? "正在启动 DeepSeek Harness" : "正在检查 DeepSeek Harness";
  const phaseDescription = status.message || (failed ? "启动过程被中断，请检查环境后重试。" : "正在等待 DeepSeek Harness 桌面宿主就绪...");
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = logViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [logs]);
  const readoutRows = [
    { label: "Node.js", value: status.nodeAvailable ? "已发现" : "未找到", tone: status.nodeAvailable ? "ok" : "bad" },
    { label: "NPM", value: status.npmAvailable ? "可用" : "未找到", tone: status.npmAvailable ? "ok" : "bad" },
    { label: "运行目录", value: status.dshHome, tone: "" },
    { label: "安装包", value: status.packageAvailable ? `${status.packageName} · 已校验` : `${status.packageName} · 校验中`, tone: status.packageAvailable ? "ok" : "" },
    { label: "REGISTRY", value: status.selectedRegistry || "默认源", tone: "" },
    {
      label: "DESKTOP BRIDGE",
      value: status.runtimeAvailable ? "已连接" : status.runtimeStarting ? "连接中" : "等待中",
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
      <section className="startup-content" aria-label="DeepSeek Harness 启动画面">
        <div className="startup-rule" />
        <div className="empty-mark" role="img" aria-label="Deeptop">
          <span className="empty-mark-text" aria-hidden="true">Deeptop</span>
        </div>
        <p className="startup-phase-line">
          {phaseTitle}
          <span className="startup-cursor" aria-hidden="true" />
        </p>
        <p className="startup-message">{phaseDescription}</p>
        <div className="startup-progress" aria-label="启动进度" role="progressbar"><i /></div>
        <div className="startup-readout" aria-label="启动环境">
          {readoutRows.map((row) => (
            <div className={`startup-readout-row${row.tone ? ` tone-${row.tone}` : ""}`} key={row.label}>
              <span>{row.label}</span>
              <code title={row.value}>{row.value}</code>
            </div>
          ))}
        </div>
        <section className={`startup-log-panel ${logs.length > 0 ? "has-logs" : ""}`} aria-label="启动命令与返回内容">
          <div className="startup-log-heading"><span>EXECUTION OUTPUT</span><em>{logs.length ? `${logs.length} 条` : "等待命令"}</em></div>
          <div className="startup-log-viewport" ref={logViewportRef}>
            {logs.length === 0 ? (
              <p className="startup-log-empty">启动命令和返回内容会实时显示在这里。</p>
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
            <button className="startup-retry" onClick={onRetry}>重新启动 DeepSeek Harness</button>
            {!status.nodeAvailable && <button className="startup-nodejs" onClick={onOpenNodejsDownload}>安装 Node.js</button>}
          </div>
        ) : (
          <p className="startup-wait"><i />正在等待桌面桥接就绪</p>
        )}
      </section>
    </main>
  );
}
