import { transcriptFromHistory, type ChildSubagentEntry, type SubagentSession } from "../app/model";
import { MarkdownContent } from "../lib/markdown";
import { t, type UiLocale } from "../app/i18n";
import type { DshSubagentCatalog } from "../lib/desktop";

type AsyncAction = () => void | Promise<unknown>;

interface SubagentsSurfacePanelProps {
  locale?: UiLocale;
  subagents: DshSubagentCatalog | null;
  session: SubagentSession | null;
  composer: string;
  onOpen: (entry: ChildSubagentEntry) => void | Promise<unknown>;
  onCloseSession: () => void;
  onComposerChange: (value: string) => void;
  onPrompt: AsyncAction;
  onInterrupt: (address: SubagentSession["address"]) => void | Promise<unknown>;
}

export function SubagentsSurfacePanel({ locale = "zh", subagents, session, composer, onOpen, onCloseSession, onComposerChange, onPrompt, onInterrupt }: SubagentsSurfacePanelProps) {
  return <div className="surface-content"><div className="surface-intro"><strong>Subagents</strong><p>{t("subagentSurface.intro", locale)}</p></div><div className="surface-list">{!subagents || subagents.entries.length === 0 ? <p className="surface-muted">{t("subagentSurface.empty", locale)}</p> : subagents.entries.map((entry) => entry.kind === "diagnostic" ? <div className="surface-row compact" key={entry.id}><div><strong>{entry.id}</strong><small>{t("subagentSurface.diagnostic", locale, { reason: entry.reason })}</small></div></div> : <div className="surface-row compact" key={entry.id}><div><strong>{entry.label || entry.id}</strong><small>{entry.mode} · {entry.activity === "running" ? t("subagent.running", locale) : t("subagent.stopped", locale)}</small></div><button onClick={() => void onOpen(entry)}>{t("common.open", locale)}</button></div>)}</div>{session && <div className="subagent-view"><div className="subagent-view-head"><strong>{session.address.childSessionId}</strong><button onClick={onCloseSession}>{t("common.close", locale)}</button></div><div className="subagent-history">{transcriptFromHistory(session.history, locale).map((item) => <div className={"subagent-message " + item.kind} key={item.key}><small>{item.label}</small><MarkdownContent text={item.text} reveal={item.kind === "assistant" && item.key.startsWith("stream-")} locale={locale} /></div>)}</div>{session.address.mode === "continuable" && <div className="subagent-compose"><input value={composer} onChange={(event) => onComposerChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onPrompt(); }} placeholder={t("subagentSurface.placeholder", locale)} /><button onClick={() => void onInterrupt(session.address)} title={t("subagentSurface.interruptTitle", locale)}>{t("subagentSurface.stop", locale)}</button><button onClick={() => void onPrompt()}>{t("subagentSurface.send", locale)}</button></div>}</div>}</div>;
}