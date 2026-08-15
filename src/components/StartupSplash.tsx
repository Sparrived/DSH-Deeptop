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
  const installing = status.installing;
  const phase = failed ? "error" : installing ? "install" : status.runtimeStarting ? "start" : "check";
  const phaseLabel = failed ? "RUNTIME UNAVAILABLE" : installing ? "INSTALLING DSH" : status.runtimeStarting ? "STARTING RUNTIME" : "CHECKING ENVIRONMENT";
  const phaseTitle = failed ? "DSH 暂时无法启动" : installing ? "正在准备 DSH" : status.runtimeStarting ? "正在连接 DSH" : "正在检查运行环境";
  const phaseDescription = status.message || (failed ? "启动过程被中断，请检查环境后重试。" : "正在等待 DSH 桌面宿主就绪...");
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = logViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [logs]);
  const statusDetails = [
    { label: "Node.js", active: status.nodeAvailable, detail: status.nodeAvailable ? "已发现" : "未找到" },
    { label: "npm", active: status.npmAvailable, detail: status.npmAvailable ? "已发现" : "未找到" },
    { label: "DSH package", active: status.packageAvailable, detail: status.packageAvailable ? "已就绪" : installing ? "准备安装" : "等待中" },
    { label: "Desktop bridge", active: status.runtimeAvailable, detail: status.runtimeAvailable ? "已连接" : status.runtimeStarting ? "连接中" : "等待中" },
  ];
  const screenStyle = { "--startup-phase": `"${phase}"` } as CSSProperties;
  return (
    <main className={`startup-screen startup-phase-${phase}`} style={screenStyle} role="status" aria-live="polite">
      <div className="startup-atmosphere" aria-hidden="true"><span /><span /><span /></div>
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
      <section className="startup-content" aria-label="DSH 启动画面">
        <div className="startup-rule" />
        <div className="startup-heading-row">
          <p className="startup-kicker">{phaseLabel}</p>
          <span className="startup-phase-chip"><i />{failed ? "ATTENTION" : "LIVE"}</span>
        </div>
        <h1>{phaseTitle}</h1>
        <p className="startup-message">{phaseDescription}</p>
        <div className="startup-progress" aria-label="启动进度" role="progressbar"><i /></div>
        <div className="startup-signal" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /></div>
        <div className="startup-status-list" aria-label="启动过程">
          {statusDetails.map((item) => (
            <div className={`startup-status-item ${item.active ? "active" : ""}`} key={item.label}>
              <i aria-hidden="true" /><span>{item.label}</span><em>{item.detail}</em>
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
            <button className="startup-retry" onClick={onRetry}>重新启动 DSH</button>
            {(!status.nodeAvailable || !status.npmAvailable) && <button className="startup-nodejs" onClick={onOpenNodejsDownload}>安装 Node.js / npm</button>}
          </div>
        ) : (
          <p className="startup-wait"><i />正在等待桌面桥接就绪</p>
        )}
        <p className="startup-package">{status.packageName}</p>
      </section>
    </main>
  );
}
