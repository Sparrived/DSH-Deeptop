import { formatTokens, type SessionStats } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { PermissionPicker, permissionDescription } from "./PermissionPicker";
import type { DshCommandDescriptor, DshPermissionSelect, DshPlanProjection, DshStatus } from "../lib/desktop";

function runtimeStatusLabel(status: DshStatus, locale: UiLocale) {
  if (status.installing) return t("runtime.installing", locale);
  if (status.runtimeStarting) return t("runtime.starting", locale);
  if (status.runtimeAvailable) return t("runtime.connected", locale);
  return t("runtime.disconnected", locale);
}

interface RuntimeSurfacePanelProps {
  status: DshStatus;
  runtimeDetails: Record<string, unknown> | null;
  sessionStats: SessionStats;
  workspaceCount: number;
  commands: DshCommandDescriptor[];
  permissions: DshPermissionSelect | null;
  plan: DshPlanProjection | null;
  locale?: UiLocale;
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
  locale = "zh",
  onAddWorkspace,
  onRunCommand,
  onInsertCommand,
  onSetPermission,
  onTogglePlan,
}: RuntimeSurfacePanelProps) {
  return <>
    <div className="inspector-section"><span className="inspector-label">DSH</span><strong className="inspector-value">{runtimeStatusLabel(status, locale)}</strong><p>{status.message}</p></div>
    <div className="inspector-section"><span className="inspector-label">Cordis Profile</span><strong className="inspector-value">desktop</strong><p>{status.packageName}</p></div>
    <div className="inspector-section"><span className="inspector-label">{t("runtime.workingDirectory", locale)}</span><div className="session-stats-inline">{t("runtime.context", locale)} {sessionStats.contextTokensAvailable ? formatTokens(sessionStats.contextTokens) : t("runtime.notProvided", locale)} · ↓ {formatTokens(sessionStats.inputTokens)} · ↑ {formatTokens(sessionStats.outputTokens)} · {t("runtime.cache", locale)} {sessionStats.cacheHitRate ? String(sessionStats.cacheHitRate.toFixed(0)) + "%" : t("runtime.notProvided", locale)}</div>{sessionStats.turns !== undefined && <div className="session-stats-inline">{t("runtime.officialStats", locale, { turns: sessionStats.turns, steps: sessionStats.steps ?? 0 })}</div>}<code>{status.runtimeDirectory || t("runtime.notRead", locale)}</code></div>
    {runtimeDetails && <div className="inspector-section"><span className="inspector-label">{t("runtime.hostRoutes", locale)}</span><p>{String(runtimeDetails.provider || t("runtime.defaultProvider", locale))} / {String(runtimeDetails.model || t("runtime.defaultModel", locale))}</p><p>{t("runtime.activeSessions", locale, { count: String(runtimeDetails.attachedSessions ?? 0) })}</p></div>}
    {permissions && <div className="inspector-section">
      <span className="inspector-label">{t("runtime.permissions", locale)}</span>
      <PermissionPicker permissions={permissions} onSetPermission={onSetPermission} locale={locale} />
      {permissionDescription(permissions.options.find((option) => option.value === permissions.currentValue), locale) && <p>{permissionDescription(permissions.options.find((option) => option.value === permissions.currentValue), locale)}</p>}
    </div>}
    {plan && <div className="inspector-section">
      <span className="inspector-label">Plan</span>
      <div className="surface-inline-actions"><strong className="inspector-value">{plan.active ? t("runtime.planEnabled", locale) : t("runtime.planDisabled", locale)}</strong><button className="surface-link" onClick={() => void onTogglePlan()}>{plan.active ? t("runtime.planExit", locale) : t("runtime.planEnter", locale)}</button></div>
      {plan.pending && <p>{t("runtime.planPending", locale)}</p>}
    </div>}
    <div className="inspector-section">
      <span className="inspector-label">{t("runtime.commandDirectory", locale)}</span>
      {commands.length > 0 ? <div className="command-directory">{commands.map((command) => <div className="command-directory-row" key={command.name}>
        <div><strong>/{command.name}</strong><p>{command.description}</p></div>
        <button className="surface-link" onClick={() => command.input ? onInsertCommand(`/${command.name} `) : void onRunCommand(`/${command.name}`)}>{command.input ? t("runtime.insert", locale) : t("runtime.run", locale)}</button>
      </div>)}</div> : <p>{t("runtime.noCommands", locale)}</p>}
    </div>
    <div className="inspector-section"><span className="inspector-label">{t("runtime.workspace", locale)}</span><p>{workspaceCount ? t("runtime.workspaceCount", locale, { count: String(workspaceCount) }) : t("runtime.noWorkspaces", locale)}</p><button className="surface-link" onClick={() => void onAddWorkspace()}>{t("runtime.addDirectory", locale)}</button></div>
  </>;
}
