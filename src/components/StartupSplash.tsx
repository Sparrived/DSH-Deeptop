import type { MouseEvent } from "react";
import { isWindowChromeControl } from "../app/ui-model";
import type { DshStatus } from "../lib/desktop";
import { WindowControls } from "./WindowControls";

type StartupSplashProps = {
  status: DshStatus;
  onRetry: () => void;
  windowMaximized: boolean;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
};

export function StartupSplash({
  status,
  onRetry,
  windowMaximized,
  onDrag,
  onMinimize,
  onToggleMaximize,
  onClose,
}: StartupSplashProps) {
  const failed = !status.runtimeStarting && !status.runtimeAvailable;
  return (
    <main className={`startup-screen ${failed ? "failed" : ""}`} role="status" aria-live="polite">
      <header
        className="window-bar startup-window-bar"
        onMouseDown={onDrag}
        onDoubleClick={(event) => { if (!isWindowChromeControl(event.target)) onToggleMaximize(); }}
      >
        <div className="brand-mark">DSH <span>DESKTOP</span></div>
        <div className="window-drag-space" />
        <div className="window-actions">
          <WindowControls windowMaximized={windowMaximized} onMinimize={onMinimize} onToggleMaximize={onToggleMaximize} onClose={onClose} />
        </div>
      </header>
      <section className="startup-content" aria-label="DSH 启动画面">
        <div className="startup-rule" />
        <p className="startup-kicker">{failed ? "RUNTIME UNAVAILABLE" : "DESKTOP RUNTIME"}</p>
        <h1>{failed ? "DSH 启动失败" : "正在启动 DSH"}</h1>
        <p className="startup-message">{status.message || "正在等待 DSH 桌面宿主就绪..."}</p>
        <div className="startup-progress" aria-hidden="true"><i /></div>
        {failed ? (
          <button className="startup-retry" onClick={onRetry}>重新启动 DSH</button>
        ) : (
          <p className="startup-wait"><i />正在等待桌面桥接就绪</p>
        )}
        <p className="startup-package">{status.packageName}</p>
      </section>
    </main>
  );
}
