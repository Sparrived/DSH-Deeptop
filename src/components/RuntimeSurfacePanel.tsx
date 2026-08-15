import { formatTokens, runtimeLabel, type SessionStats } from "../app/model";
import { PermissionPicker, permissionDescription } from "./PermissionPicker";
import type { DshCommandDescriptor, DshPermissionSelect, DshPlanProjection, DshStatus } from "../lib/desktop";

interface RuntimeSurfacePanelProps {
  status: DshStatus;
  runtimeDetails: Record<string, unknown> | null;
  sessionStats: SessionStats;
  workspaceCount: number;
  commands: DshCommandDescriptor[];
  permissions: DshPermissionSelect | null;
  plan: DshPlanProjection | null;
  onAddWorkspace: () => void | Promise<unknown>;
  onRunCommand: (line: string) => void | Promise<unknown>;
  onInsertCommand: (line: string) => void;
  onSetPermission: (value: string) => void | Promise<unknown>;
  onTogglePlan: () => void | Promise<unknown>;
}

export function RuntimeSurfacePanel({
  status,
  runtimeDetails,
  sessionStats,
  workspaceCount,
  commands,
  permissions,
  plan,
  onAddWorkspace,
  onRunCommand,
  onInsertCommand,
  onSetPermission,
  onTogglePlan,
}: RuntimeSurfacePanelProps) {
  return <>
    <div className="inspector-section"><span className="inspector-label">DSH</span><strong className="inspector-value">{runtimeLabel(status)}</strong><p>{status.message}</p></div>
    <div className="inspector-section"><span className="inspector-label">Cordis Profile</span><strong className="inspector-value">desktop</strong><p>{status.packageName}</p></div>
    <div className="inspector-section"><span className="inspector-label">运行目录</span><div className="session-stats-inline">上下文 {formatTokens(sessionStats.contextTokens)} · ↓ {formatTokens(sessionStats.inputTokens)} · ↑ {formatTokens(sessionStats.outputTokens)} · 缓存 {sessionStats.cacheHitRate ? String(sessionStats.cacheHitRate.toFixed(0)) + "%" : "未提供"} · 首 T {sessionStats.firstTokenMs ? String(Math.round(sessionStats.firstTokenMs)) + "ms" : "未提供"}</div>{sessionStats.turns !== undefined && <div className="session-stats-inline">官方统计 {sessionStats.turns} 轮 · {sessionStats.steps ?? 0} 步</div>}<code>{status.runtimeDirectory || "未读取"}</code></div>
    {runtimeDetails && <div className="inspector-section"><span className="inspector-label">宿主路由</span><p>{String(runtimeDetails.provider || "默认 provider")} / {String(runtimeDetails.model || "默认 model")}</p><p>{String(runtimeDetails.attachedSessions ?? 0)} 个活动会话</p></div>}
    {permissions && <div className="inspector-section">
      <span className="inspector-label">权限</span>
      <PermissionPicker permissions={permissions} onSetPermission={onSetPermission} />
      {permissionDescription(permissions.options.find((option) => option.value === permissions.currentValue)) && <p>{permissionDescription(permissions.options.find((option) => option.value === permissions.currentValue))}</p>}
    </div>}
    {plan && <div className="inspector-section">
      <span className="inspector-label">Plan</span>
      <div className="surface-inline-actions"><strong className="inspector-value">{plan.active ? "已启用" : "未启用"}</strong><button className="surface-link" onClick={() => void onTogglePlan()}>{plan.active ? "退出" : "进入"}</button></div>
      {plan.pending && <p>将在下一步生效</p>}
    </div>}
    <div className="inspector-section">
      <span className="inspector-label">命令目录</span>
      {commands.length > 0 ? <div className="command-directory">{commands.map((command) => <div className="command-directory-row" key={command.name}>
        <div><strong>/{command.name}</strong><p>{command.description}</p></div>
        <button className="surface-link" onClick={() => command.input ? onInsertCommand(`/${command.name} `) : void onRunCommand(`/${command.name}`)}>{command.input ? "插入" : "执行"}</button>
      </div>)}</div> : <p>当前会话没有可用命令</p>}
    </div>
    <div className="inspector-section"><span className="inspector-label">工作区</span><p>{workspaceCount ? String(workspaceCount) + " 个已注册工作区" : "尚未注册工作区"}</p><button className="surface-link" onClick={() => void onAddWorkspace()}>添加目录</button></div>
  </>;
}
