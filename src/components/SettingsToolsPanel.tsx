import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  createMcpBinding,
  createMcpServerDraft,
  formatMcpArgs,
  mcpDraftDirty,
  mcpDraftIssue,
  parseMcpArgs,
  withMcpTransport,
} from "../app/tool-settings-model";
import { t, type UiLocale } from "../app/i18n";
import type {
  DshManagedSkill,
  DshMcpServerConfig,
  DshMcpValueBinding,
  DshSkillInstallResult,
  DshToolSettingsDescription,
} from "../lib/desktop";
import { PopupDialog } from "./PopupDialog";

type ToolsTab = "skills" | "mcp";

type EnableTarget = {
  id: string;
  transport: DshMcpServerConfig["transport"];
  endpoint: string;
  fingerprint: string;
  bindings: DshMcpValueBinding[];
};

const TOOLS_TABS: readonly ToolsTab[] = ["skills", "mcp"];
const TOOLS_TAB_IDS: Record<ToolsTab, string> = {
  skills: "tools-tab-skills",
  mcp: "tools-tab-mcp",
};
const TOOLS_PANEL_IDS: Record<ToolsTab, string> = {
  skills: "tools-panel-skills",
  mcp: "tools-panel-mcp",
};

function domIdPart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function bindingTrustSnapshot(binding: DshMcpValueBinding) {
  return {
    name: binding.name,
    source: binding.source,
    prefix: binding.prefix ?? "",
    redacted: binding.redacted === true,
    clearSecret: binding.clearSecret === true,
    // Exact structural comparison avoids accepting a known short-hash collision.
    // The literal itself never renders in the confirmation dialog.
    value: binding.value,
  };
}

/** Include only fields that determine the process or network target. */
function mcpTrustFingerprint(server: DshMcpServerConfig) {
  if (server.transport === "stdio") {
    return JSON.stringify({
      transport: server.transport,
      command: server.command ?? "",
      args: server.args ?? [],
      cwd: server.cwd ?? "",
      env: (server.env ?? []).map(bindingTrustSnapshot),
    });
  }
  return JSON.stringify({
    transport: server.transport,
    url: server.url ?? "",
    headers: (server.headers ?? []).map(bindingTrustSnapshot),
  });
}

function trustBindingSummary(binding: DshMcpValueBinding, locale: UiLocale) {
  const source = binding.source === "literal"
    ? binding.clearSecret
      ? t("tools.mcp.trust.sourceClear", locale)
      : binding.redacted ? t("tools.mcp.trust.sourceSaved", locale) : t("tools.mcp.trust.sourceLiteral", locale)
    : `${t("tools.mcp.trust.sourceEnv", locale)} ${binding.value}`;
  return `${binding.name || t("tools.mcp.trust.unnamed", locale)} ← ${source}${binding.prefix ? ` (${binding.prefix}…)` : ""}`;
}

function enableTargetFor(server: DshMcpServerConfig): EnableTarget {
  return {
    id: server.id,
    transport: server.transport,
    endpoint: server.transport === "stdio" ? server.command ?? "" : server.url ?? "",
    fingerprint: mcpTrustFingerprint(server),
    bindings: (server.transport === "stdio" ? server.env : server.headers) ?? [],
  };
}

type SettingsToolsPanelProps = {
  locale: UiLocale;
  available: boolean;
  description: DshToolSettingsDescription | null;
  mcpDraft: DshMcpServerConfig[];
  loading: boolean;
  loadError: string | null;
  mcpSaving: boolean;
  skillRemoving: string | null;
  skillInstallOperation: { id: string; cancelling: boolean; uncertain: boolean } | null;
  lastSkillInstall: DshSkillInstallResult | null;
  onRefresh: () => void | Promise<unknown>;
  onOpenSkillDirectory: () => void | Promise<void>;
  onBeginSkillInstall: () => void;
  onRemoveSkill: (name: string) => Promise<boolean>;
  onMcpDraftChange: (servers: DshMcpServerConfig[]) => void;
  onResetMcpDraft: () => void;
  onSaveMcp: () => void | Promise<boolean>;
};

function skillStatus(skill: DshManagedSkill, locale: UiLocale) {
  return skill.valid ? t("tools.skills.ready", locale) : t("tools.skills.invalid", locale);
}

function bindingLabel(transport: DshMcpServerConfig["transport"], locale: UiLocale) {
  return transport === "stdio" ? t("tools.mcp.environment", locale) : t("tools.mcp.headers", locale);
}

function bindingPlaceholder(
  transport: DshMcpServerConfig["transport"],
  field: "name" | "value",
  source: DshMcpValueBinding["source"],
) {
  if (field === "name") return transport === "stdio" ? "GITHUB_TOKEN" : "Authorization";
  if (source === "env") return transport === "stdio" ? "GITHUB_TOKEN" : "MCP_TOKEN";
  return transport === "stdio" ? "value" : "application/json";
}

/** Settings page for user Skills and profile-scoped MCP server definitions. */
export function SettingsToolsPanel({
  locale,
  available,
  description,
  mcpDraft,
  loading,
  loadError,
  mcpSaving,
  skillRemoving,
  skillInstallOperation,
  lastSkillInstall,
  onRefresh,
  onOpenSkillDirectory,
  onBeginSkillInstall,
  onRemoveSkill,
  onMcpDraftChange,
  onResetMcpDraft,
  onSaveMcp,
}: SettingsToolsPanelProps) {
  const [tab, setTab] = useState<ToolsTab>("skills");
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [removeSkillTarget, setRemoveSkillTarget] = useState<DshManagedSkill | null>(null);
  const [removeServerTarget, setRemoveServerTarget] = useState<DshMcpServerConfig | null>(null);
  const [enableTarget, setEnableTarget] = useState<EnableTarget | null>(null);
  const [connectionReviewId, setConnectionReviewId] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<ToolsTab, HTMLButtonElement | null>>>({});
  // Tracks a Host-redacted literal through temporary local edits. The key uses
  // the immutable binding name; redacted names are deliberately read-only.
  const savedRedactedBindingsRef = useRef(new Set<string>());
  const dirty = useMemo(
    () => mcpDraftDirty(description?.mcp.servers ?? [], mcpDraft),
    [description, mcpDraft],
  );
  const issue = useMemo(() => mcpDraftIssue(mcpDraft), [mcpDraft]);
  const nativeMcpServers = description?.mcp.nativeServers ?? [];
  const skillMutationBusy = skillRemoving !== null || skillInstallOperation !== null;
  const draftBusy = loading || mcpSaving || skillMutationBusy;

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: ToolsTab) {
    const currentIndex = TOOLS_TABS.indexOf(currentTab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % TOOLS_TABS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + TOOLS_TABS.length) % TOOLS_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TOOLS_TABS.length - 1;
    else return;
    event.preventDefault();
    const nextTab = TOOLS_TABS[nextIndex];
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  function confirmEnable(target: EnableTarget) {
    const current = mcpDraft.find((server) => server.id === target.id);
    if (!current || current.transport !== target.transport || mcpTrustFingerprint(current) !== target.fingerprint) {
      setEnableTarget(null);
      setConnectionReviewId(target.id);
      return;
    }
    updateServer(target.id, { enabled: true });
    setConnectionReviewId((currentId) => currentId === target.id ? null : currentId);
    setEnableTarget(null);
  }

  function updateServer(id: string, patch: Partial<DshMcpServerConfig>) {
    const current = mcpDraft.find((server) => server.id === id);
    const connectionChanged = current?.enabled === true && (
      (current.transport === "stdio" && ["command", "args", "cwd", "env"].some((field) => field in patch))
      || (current.transport === "streamable-http" && ["url", "headers"].some((field) => field in patch))
    );
    if (connectionChanged) setConnectionReviewId(id);
    const safePatch = connectionChanged ? { ...patch, enabled: false } : patch;
    onMcpDraftChange(mcpDraft.map((server) => (
      server.id === id ? { ...server, ...safePatch } as DshMcpServerConfig : server
    )));
  }

  function replaceServer(id: string, next: DshMcpServerConfig) {
    const current = mcpDraft.find((server) => server.id === id);
    const transportChanged = current !== undefined && current.transport !== next.transport;
    if (transportChanged && current.enabled) setConnectionReviewId(id);
    onMcpDraftChange(mcpDraft.map((server) => (
      server.id === id ? (transportChanged ? { ...next, enabled: false } : next) : server
    )));
  }

  function bindingIdentity(server: DshMcpServerConfig, binding: DshMcpValueBinding) {
    return `${server.id}\u0000${server.transport}\u0000${binding.name}`;
  }

  function updateBinding(server: DshMcpServerConfig, index: number, patch: Partial<DshMcpValueBinding>) {
    const key = server.transport === "stdio" ? "env" : "headers";
    const rows = [...(server[key] ?? [])];
    rows[index] = { ...rows[index], ...patch };
    updateServer(server.id, { [key]: rows });
  }

  function updateBindingValue(server: DshMcpServerConfig, index: number, value: string) {
    const binding = (server.transport === "stdio" ? server.env : server.headers)?.[index];
    if (!binding) return;
    const identity = bindingIdentity(server, binding);
    if (binding.redacted === true) savedRedactedBindingsRef.current.add(identity);
    if (value === "" && savedRedactedBindingsRef.current.has(identity)) {
      updateBinding(server, index, { value: "", redacted: true, clearSecret: undefined });
      return;
    }
    if (value !== "") savedRedactedBindingsRef.current.delete(identity);
    updateBinding(server, index, { value, redacted: undefined, clearSecret: undefined });
  }

  function addBinding(server: DshMcpServerConfig) {
    const key = server.transport === "stdio" ? "env" : "headers";
    updateServer(server.id, { [key]: [...(server[key] ?? []), createMcpBinding()] });
  }

  function removeBinding(server: DshMcpServerConfig, index: number) {
    const key = server.transport === "stdio" ? "env" : "headers";
    const binding = server[key]?.[index];
    if (binding) savedRedactedBindingsRef.current.delete(bindingIdentity(server, binding));
    updateServer(server.id, { [key]: (server[key] ?? []).filter((_, rowIndex) => rowIndex !== index) });
  }

  function toggleServer(server: DshMcpServerConfig, enabled: boolean) {
    if (enabled) {
      setEnableTarget(enableTargetFor(server));
      return;
    }
    updateServer(server.id, { enabled: false });
  }

  function addServer() {
    const server = createMcpServerDraft(mcpDraft);
    onMcpDraftChange([...mcpDraft, server]);
    setExpandedServer(server.id);
  }

  if (!available) {
    return (
      <div className="settings-page">
        <div className="settings-page-header">
          <div>
            <span className="settings-overline">TOOLS</span>
            <h2>{t("settings.tools", locale)}</h2>
            <p>{t("tools.subtitle", locale)}</p>
          </div>
        </div>
        <p className="settings-empty">{t("tools.unavailable", locale)}</p>
      </div>
    );
  }

  return (
    <div className="settings-page settings-tools-page">
      <div className="settings-page-header">
        <div>
          <span className="settings-overline">TOOLS / EXTENSIONS</span>
          <h2>{t("settings.tools", locale)}</h2>
          <p>{t("tools.subtitle", locale)}</p>
        </div>
        <button
          type="button"
          className="settings-header-action"
          disabled={draftBusy || dirty}
          onClick={() => void onRefresh()}
        >
          {loading ? t("tools.refreshing", locale) : t("common.refresh", locale)}
        </button>
      </div>

      <div className="settings-tools-tabs" role="tablist" aria-orientation="horizontal" aria-label={t("tools.tabsAria", locale)}>
        <button
          type="button"
          id={TOOLS_TAB_IDS.skills}
          role="tab"
          aria-selected={tab === "skills"}
          aria-controls={TOOLS_PANEL_IDS.skills}
          tabIndex={tab === "skills" ? 0 : -1}
          className={tab === "skills" ? "selected" : ""}
          ref={(element) => { tabRefs.current.skills = element; }}
          onClick={() => setTab("skills")}
          onKeyDown={(event) => handleTabKeyDown(event, "skills")}
        >
          <strong>Skills</strong>
          <small>{description?.skills.entries.length ?? 0}</small>
        </button>
        <button
          type="button"
          id={TOOLS_TAB_IDS.mcp}
          role="tab"
          aria-selected={tab === "mcp"}
          aria-controls={TOOLS_PANEL_IDS.mcp}
          tabIndex={tab === "mcp" ? 0 : -1}
          className={tab === "mcp" ? "selected" : ""}
          ref={(element) => { tabRefs.current.mcp = element; }}
          onClick={() => setTab("mcp")}
          onKeyDown={(event) => handleTabKeyDown(event, "mcp")}
        >
          <strong>MCP</strong>
          <small>{mcpDraft.length + nativeMcpServers.length}</small>
        </button>
      </div>

      {tab === "skills" && (
        <section
          id={TOOLS_PANEL_IDS.skills}
          className="settings-tools-section"
          role="tabpanel"
          aria-labelledby={TOOLS_TAB_IDS.skills}
          tabIndex={0}
        >
          <div className="settings-block-heading tools-section-heading">
            <div>
              <h3>{t("tools.skills.title", locale)}</h3>
              <p>{t("tools.skills.hint", locale)}</p>
            </div>
            <div className="settings-tools-actions">
              <button
                disabled={draftBusy || skillInstallOperation !== null}
                onClick={() => void onOpenSkillDirectory()}
              >
                {t("tools.skills.openDirectory", locale)}
              </button>
              <button
                className="primary"
                disabled={draftBusy || skillInstallOperation !== null}
                onClick={onBeginSkillInstall}
              >
                {t("tools.skills.install", locale)}
              </button>
            </div>
          </div>
          {description && <code className="tools-path">{description.skills.directory}</code>}
          {lastSkillInstall?.warnings.length ? (
            <div className="tools-inline-notice" role="status">
              <strong>{t("tools.skills.installWarnings", locale)}</strong>
              <span>{lastSkillInstall.warnings.join(" · ")}</span>
            </div>
          ) : null}
          {loadError ? (
             <div className="tools-empty-state tools-error-state" role="alert">
               <span aria-hidden="true">!</span>
               <div>
                 <strong>{t("tools.loadErrorTitle", locale)}</strong>
                 <p>{loadError}</p>
               </div>
               <button disabled={draftBusy} onClick={() => void onRefresh()}>{t("common.retry", locale)}</button>
             </div>
           ) : !description || loading ? (
            <p className="settings-empty">{t("tools.loading", locale)}</p>
          ) : description.skills.entries.length === 0 ? (
            <div className="tools-empty-state">
              <span aria-hidden="true">/</span>
              <div>
                <strong>{t("tools.skills.empty", locale)}</strong>
                <p>{t("tools.skills.emptyHint", locale)}</p>
              </div>
              <button
                disabled={draftBusy || skillInstallOperation !== null}
                onClick={onBeginSkillInstall}
              >
                {t("tools.skills.install", locale)}
              </button>
            </div>
          ) : (
            <div className="tools-skill-list">
              {description.skills.entries.map((skill) => (
                <article
                  className={`tools-skill-card${skill.valid ? "" : " invalid"}`}
                  key={skill.directoryName}
                >
                  <div className="tools-skill-mark" aria-hidden="true">/</div>
                  <div className="tools-skill-copy">
                    <div>
                      <strong>{skill.name}</strong>
                      <span data-valid={skill.valid}>{skillStatus(skill, locale)}</span>
                    </div>
                    <p>{skill.description || skill.error}</p>
                    {skill.name !== skill.directoryName && (
                      <small>{t("tools.skills.directoryName", locale, { name: skill.directoryName })}</small>
                    )}
                  </div>
                  <div className="tools-skill-actions">
                    <button
                      className="danger"
                      disabled={!skill.removable || draftBusy || skillRemoving === skill.directoryName || skillInstallOperation !== null}
                      onClick={() => setRemoveSkillTarget(skill)}
                    >
                      {skillRemoving === skill.directoryName ? t("tools.removing", locale) : t("common.delete", locale)}
                    </button>
                    {!skill.removable && <small>{t("tools.skills.readOnly", locale)}</small>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "mcp" && (
        <section
          id={TOOLS_PANEL_IDS.mcp}
          className="settings-tools-section"
          role="tabpanel"
          aria-labelledby={TOOLS_TAB_IDS.mcp}
          tabIndex={0}
        >
          <div className="settings-block-heading tools-section-heading">
            <div>
              <h3>{t("tools.mcp.title", locale)}</h3>
              <p>{t("tools.mcp.hint", locale)}</p>
            </div>
            <button className="settings-header-action" disabled={draftBusy} onClick={addServer}>
              {t("tools.mcp.add", locale)}
            </button>
          </div>
          <div className="tools-security-note">
            <strong>{t("tools.mcp.trustTitle", locale)}</strong>
            <span>{t("tools.mcp.trustHint", locale)}</span>
          </div>
          {nativeMcpServers.length > 0 && (
            <div className="mcp-native-section">
              <div className="mcp-native-heading">
                <div>
                  <strong>{t("tools.mcp.native.title", locale)}</strong>
                  <small>{t("tools.mcp.native.hint", locale)}</small>
                </div>
                <span>{t("tools.mcp.native.readOnly", locale)}</span>
              </div>
              <div className="mcp-server-list">
                {nativeMcpServers.map((server) => (
                  <article
                    className="mcp-server-card native"
                    key={server.entryId}
                  >
                    <div className="mcp-server-header mcp-native-header">
                      <span className="mcp-server-state" aria-hidden="true" />
                      <span>
                        <strong>{server.serverName ?? t("tools.mcp.unnamed", locale)}</strong>
                        <small>
                          {server.transport === "stdio" ? "STDIO" : server.transport === "streamable-http" ? "STREAMABLE HTTP" : "MCP"} · {server.entryId}
                        </small>
                      </span>
                      <em>{t("tools.mcp.native.readOnly", locale)}</em>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          {mcpDraft.length === 0 && nativeMcpServers.length === 0 ? (
            <div className="tools-empty-state">
              <span aria-hidden="true">M</span>
              <div>
                <strong>{t("tools.mcp.empty", locale)}</strong>
                <p>{t("tools.mcp.emptyHint", locale)}</p>
              </div>
              <button disabled={draftBusy} onClick={addServer}>{t("tools.mcp.add", locale)}</button>
            </div>
          ) : mcpDraft.length > 0 ? (
            <div className="mcp-server-list">
              {mcpDraft.map((server) => {
                const open = expandedServer === server.id;
                const bindings = server.transport === "stdio" ? server.env ?? [] : server.headers ?? [];
                const serverDomId = domIdPart(server.id);
                const serverLabelId = `mcp-server-label-${serverDomId}`;
                const editorId = `mcp-server-editor-${serverDomId}`;
                return (
                  <article
                    className={`mcp-server-card${open ? " open" : ""}${server.enabled ? " enabled" : ""}`}
                    key={server.id}
                  >
                    <header className="mcp-server-header">
                      <button
                        type="button"
                        className="mcp-server-expand"
                        onClick={() => setExpandedServer(open ? null : server.id)}
                        aria-expanded={open}
                        aria-controls={editorId}
                      >
                        <span className="mcp-server-state" aria-hidden="true" />
                        <span>
                          <strong id={serverLabelId}>{server.serverName || t("tools.mcp.unnamed", locale)}</strong>
                          <small>
                            {server.transport === "stdio" ? "STDIO" : "STREAMABLE HTTP"} · {server.serverName || "…"} · *
                          </small>
                        </span>
                        <b aria-hidden="true"><ChevronDown /></b>
                      </button>
                      <label
                        className="settings-plugin-toggle"
                        aria-label={t("tools.mcp.enableAria", locale, { name: server.serverName })}
                      >
                        <input
                          type="checkbox"
                          disabled={draftBusy}
                          checked={server.enabled}
                          onChange={(event) => toggleServer(server, event.target.checked)}
                        />
                        <span aria-hidden="true" />
                      </label>
                    </header>
                    {open && (
                      <fieldset
                        id={editorId}
                        disabled={draftBusy}
                        aria-labelledby={serverLabelId}
                        className="mcp-server-editor"
                      >
                        {connectionReviewId === server.id && !server.enabled && (
                          <div className="tools-inline-notice" role="status">
                            <span>{t("tools.mcp.disabledAfterEdit", locale)}</span>
                          </div>
                        )}
                        <div className="mcp-field-grid two">
                          <label>
                            <span>{t("tools.mcp.id", locale)}</span>
                            <input value={server.id} readOnly aria-readonly="true" />
                            <small>{t("tools.mcp.idHint", locale)}</small>
                          </label>
                          <label>
                            <span>{t("tools.mcp.namespace", locale)}</span>
                            <input
                              value={server.serverName}
                              onChange={(event) => updateServer(server.id, { serverName: event.target.value })}
                            />
                          </label>
                        </div>
                        <label className="mcp-full-field">
                          <span>{t("tools.mcp.transport", locale)}</span>
                          <select
                            value={server.transport}
                            onChange={(event) => replaceServer(
                              server.id,
                              withMcpTransport(server, event.target.value as DshMcpServerConfig["transport"]),
                            )}
                          >
                            <option value="stdio">stdio</option>
                            <option value="streamable-http">Streamable HTTP</option>
                          </select>
                        </label>
                        {server.transport === "stdio" ? (
                          <>
                            <div className="mcp-field-grid two">
                              <label>
                                <span>{t("tools.mcp.command", locale)}</span>
                                <input
                                  value={server.command ?? ""}
                                  onChange={(event) => updateServer(server.id, { command: event.target.value })}
                                  placeholder="npx"
                                />
                              </label>
                              <label>
                                <span>{t("tools.mcp.cwd", locale)} <em>{t("tools.optional", locale)}</em></span>
                                <input
                                  value={server.cwd ?? ""}
                                  onChange={(event) => updateServer(server.id, { cwd: event.target.value })}
                                />
                              </label>
                            </div>
                            <label className="mcp-full-field">
                              <span>{t("tools.mcp.args", locale)}</span>
                              <textarea
                                rows={3}
                                value={formatMcpArgs(server.args)}
                                onChange={(event) => updateServer(server.id, { args: parseMcpArgs(event.target.value) })}
                                placeholder={"-y\n@modelcontextprotocol/server-memory"}
                              />
                              <small>{t("tools.mcp.argsHint", locale)}</small>
                            </label>
                          </>
                        ) : (
                          <label className="mcp-full-field">
                            <span>{t("tools.mcp.url", locale)}</span>
                            <input
                              value={server.url ?? ""}
                              onChange={(event) => updateServer(server.id, { url: event.target.value })}
                              placeholder="http://localhost:3000/mcp"
                            />
                          </label>
                        )}
                        <div className="mcp-bindings">
                          <div className="mcp-subheading">
                            <div>
                              <strong>{bindingLabel(server.transport, locale)}</strong>
                              <small>{t("tools.mcp.bindingsHint", locale)}</small>
                            </div>
                            <button onClick={() => addBinding(server)}>{t("tools.mcp.addBinding", locale)}</button>
                          </div>
                          {bindings.length === 0 ? (
                            <p>{t("tools.mcp.noBindings", locale)}</p>
                          ) : (
                            bindings.map((binding, index) => (
                              <div className="mcp-binding-row" key={`${server.id}-${index}`}>
                                <input
                                  aria-label={t("tools.mcp.bindingName", locale)}
                                  value={binding.name}
                                   disabled={binding.redacted === true}
                                  onChange={(event) => updateBinding(server, index, { name: event.target.value })}
                                  placeholder={bindingPlaceholder(server.transport, "name", binding.source)}
                                />
                                <select
                                  aria-label={t("tools.mcp.bindingSource", locale)}
                                  value={binding.source}
                                  onChange={(event) => {
                                    savedRedactedBindingsRef.current.delete(bindingIdentity(server, binding));
                                    updateBinding(server, index, {
                                      source: event.target.value as DshMcpValueBinding["source"],
                                      value: "",
                                      prefix: "",
                                      redacted: undefined,
                                      clearSecret: undefined,
                                    });
                                  }}
                                  >
                                  <option value="env">{t("tools.mcp.fromEnvironment", locale)}</option>
                                  <option value="literal">{t("tools.mcp.literal", locale)}</option>
                                </select>
                                {binding.source === "env" && (
                                  <input
                                    aria-label={t("tools.mcp.bindingPrefix", locale)}
                                    value={binding.prefix ?? ""}
                                    onChange={(event) => updateBinding(server, index, { prefix: event.target.value })}
                                    placeholder={server.transport === "streamable-http" ? "Bearer " : t("tools.mcp.prefix", locale)}
                                  />
                                )}
                                <input
                                  aria-label={t("tools.mcp.bindingValue", locale)}
                                  type={binding.source === "literal" ? "password" : "text"}
                                  value={binding.value}
                                  onChange={(event) => updateBindingValue(server, index, event.target.value)}
                                  placeholder={binding.redacted ? t("tools.mcp.redactedPlaceholder", locale) : bindingPlaceholder(server.transport, "value", binding.source)}
                                />
                                {binding.source === "literal" && binding.redacted === true && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      savedRedactedBindingsRef.current.delete(bindingIdentity(server, binding));
                                      updateBinding(server, index, { value: "", redacted: true, clearSecret: true });
                                    }}
                                  >
                                    {t("tools.mcp.clearSecret", locale)}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="danger"
                                  aria-label={t("tools.mcp.removeBinding", locale)}
                                  onClick={() => removeBinding(server, index)}
                                >
                                  <X aria-hidden="true" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                        <div className="mcp-field-grid four">
                          <label>
                            <span>{t("tools.mcp.timeout", locale)}</span>
                            <input
                              type="number"
                              min={100}
                              max={300000}
                              value={server.toolCallTimeoutMs}
                              onChange={(event) => updateServer(server.id, { toolCallTimeoutMs: Number(event.target.value) })}
                            />
                          </label>
                          <label>
                            <span>{t("tools.mcp.initialDelay", locale)}</span>
                            <input
                              type="number"
                              min={1}
                              max={300000}
                              value={server.reconnect.initialDelayMs}
                              onChange={(event) => updateServer(server.id, {
                                reconnect: { ...server.reconnect, initialDelayMs: Number(event.target.value) },
                              })}
                            />
                          </label>
                          <label>
                            <span>{t("tools.mcp.maxDelay", locale)}</span>
                            <input
                              type="number"
                              min={1}
                              max={300000}
                              value={server.reconnect.maxDelayMs}
                              onChange={(event) => updateServer(server.id, {
                                reconnect: { ...server.reconnect, maxDelayMs: Number(event.target.value) },
                              })}
                            />
                          </label>
                          <label>
                            <span>{t("tools.mcp.maxAttempts", locale)}</span>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={server.reconnect.maxAttempts}
                              onChange={(event) => updateServer(server.id, {
                                reconnect: { ...server.reconnect, maxAttempts: Number(event.target.value) },
                              })}
                            />
                          </label>
                        </div>
                        <div className="mcp-server-footer">
                          <label className="mcp-reconnect-toggle">
                            <input
                              type="checkbox"
                              checked={server.reconnect.enabled}
                              onChange={(event) => updateServer(server.id, {
                                reconnect: { ...server.reconnect, enabled: event.target.checked },
                              })}
                            />
                            <span>{t("tools.mcp.autoReconnect", locale)}</span>
                          </label>
                          <button className="danger" onClick={() => setRemoveServerTarget(server)}>
                            {t("tools.mcp.remove", locale)}
                          </button>
                        </div>
                      </fieldset>
                    )}
                  </article>
                );
              })}
            </div>
          ) : null}
          {(mcpDraft.length > 0 || dirty) && (
            <div className="mcp-save-bar">
              <div>
                <strong>{dirty ? t("tools.mcp.unsaved", locale) : t("tools.mcp.savedState", locale)}</strong>
                <small>
                  {issue ? t(`tools.mcp.validation.${issue}`, locale) : t("tools.mcp.applyHint", locale)}
                </small>
              </div>
              <div>
                <button disabled={!dirty || draftBusy} onClick={onResetMcpDraft}>{t("common.cancel", locale)}</button>
                <button
                  className="primary"
                  disabled={!dirty || Boolean(issue) || draftBusy}
                  onClick={() => void onSaveMcp()}
                >
                  {mcpSaving ? t("tools.mcp.saving", locale) : t("common.save", locale)}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {removeSkillTarget && (
        <PopupDialog
          locale={locale}
          role="alertdialog"
          title={t("tools.skills.removeTitle", locale)}
          eyebrow="SKILLS / REMOVE"
          description={t("tools.skills.removeDescription", locale, { name: removeSkillTarget.name })}
          className="popup-form-dialog"
          onClose={() => setRemoveSkillTarget(null)}
          footer={(
            <>
              <button onClick={() => setRemoveSkillTarget(null)}>{t("common.cancel", locale)}</button>
              <button
                className="confirm danger-button"
                disabled={skillRemoving !== null}
                onClick={() => void onRemoveSkill(removeSkillTarget.directoryName).then((removed) => {
                  if (removed) setRemoveSkillTarget(null);
                })}
              >
                {t("common.delete", locale)}
              </button>
            </>
          )}
        >
          <p className="popup-confirm-message">{t("tools.skills.removeWarning", locale)}</p>
        </PopupDialog>
      )}

      {removeServerTarget && (
        <PopupDialog
          locale={locale}
          role="alertdialog"
          title={t("tools.mcp.removeTitle", locale)}
          eyebrow="MCP / REMOVE"
          description={t("tools.mcp.removeDescription", locale, { name: removeServerTarget.serverName })}
          className="popup-form-dialog"
          onClose={() => setRemoveServerTarget(null)}
          footer={(
            <>
              <button onClick={() => setRemoveServerTarget(null)}>{t("common.cancel", locale)}</button>
              <button
                className="confirm danger-button"
                onClick={() => {
                  onMcpDraftChange(mcpDraft.filter((server) => server.id !== removeServerTarget.id));
                  setRemoveServerTarget(null);
                }}
              >
                {t("tools.mcp.remove", locale)}
              </button>
            </>
          )}
        >
          <p className="popup-confirm-message">{t("tools.mcp.removeHint", locale)}</p>
        </PopupDialog>
      )}

      {enableTarget && (
        <PopupDialog
          locale={locale}
          role="alertdialog"
          title={t(
            enableTarget.transport === "stdio" ? "tools.mcp.enableStdioTitle" : "tools.mcp.enableHttpTitle",
            locale,
          )}
          eyebrow="MCP / TRUST"
          description={t(
            enableTarget.transport === "stdio" ? "tools.mcp.enableStdioDescription" : "tools.mcp.enableHttpDescription",
            locale,
            { command: enableTarget.endpoint },
          )}
          className="popup-confirm-dialog"
          onClose={() => setEnableTarget(null)}
          footer={(
            <>
              <button onClick={() => setEnableTarget(null)}>{t("common.cancel", locale)}</button>
              <button
                className="confirm"
                onClick={() => confirmEnable(enableTarget)}
              >
                {t("tools.mcp.trustAndEnable", locale)}
              </button>
            </>
          )}
        >
          <p className="popup-confirm-message">
            {t(
              enableTarget.transport === "stdio" ? "tools.mcp.enableStdioWarning" : "tools.mcp.enableHttpWarning",
              locale,
            )}
          </p>
          {enableTarget.bindings.length > 0 && (
            <ul className="tools-trust-details">
              {enableTarget.bindings.map((binding, index) => (
                <li key={`${enableTarget.id}-${index}`}>{trustBindingSummary(binding, locale)}</li>
              ))}
            </ul>
          )}
        </PopupDialog>
      )}
    </div>
  );
}
