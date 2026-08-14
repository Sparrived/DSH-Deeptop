import { formatTokens, runtimeLabel, type SessionStats } from "../app/model";
import type { DshStatus } from "../lib/desktop";

interface RuntimeSurfacePanelProps {
  status: DshStatus;
  runtimeDetails: Record<string, unknown> | null;
  sessionStats: SessionStats;
  workspaceCount: number;
  onAddWorkspace: () => void | Promise<unknown>;
}

export function RuntimeSurfacePanel({ status, runtimeDetails, sessionStats, workspaceCount, onAddWorkspace }: RuntimeSurfacePanelProps) {
  return <>
    <div className="inspector-section"><span className="inspector-label">DSH</span><strong className="inspector-value">{runtimeLabel(status)}</strong><p>{status.message}</p></div>
    <div className="inspector-section"><span className="inspector-label">Cordis Profile</span><strong className="inspector-value">desktop</strong><p>{status.packageName}</p></div>
    <div className="inspector-section"><span className="inspector-label">运行目录</span><div className="session-stats-inline">上下文 {formatTokens(sessionStats.contextTokens)} · ↓ {formatTokens(sessionStats.inputTokens)} · ↑ {formatTokens(sessionStats.outputTokens)} · 缓存 {sessionStats.cacheHitRate ? String(sessionStats.cacheHitRate.toFixed(0)) + "%" : "—"} · 首 T {sessionStats.firstTokenMs ? String(Math.round(sessionStats.firstTokenMs)) + "ms" : "—"}</div><code>{status.runtimeDirectory || "未读取"}</code></div>
    {runtimeDetails && <div className="inspector-section"><span className="inspector-label">宿主路由</span><p>{String(runtimeDetails.provider || "默认 provider")} / {String(runtimeDetails.model || "默认 model")}</p><p>{String(runtimeDetails.attachedSessions ?? 0)} 个活动会话</p></div>}
    <div className="inspector-section"><span className="inspector-label">工作区</span><p>{workspaceCount ? String(workspaceCount) + " 个已注册工作区" : "尚未注册工作区"}</p><button className="surface-link" onClick={() => void onAddWorkspace()}>添加目录</button></div>
  </>;
}
