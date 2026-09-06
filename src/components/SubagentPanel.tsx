import { MarkdownContent } from "../lib/markdown";
import {
  formatClock,
  shortSubagentId,
  type ChildSubagentEntry,
  type SubagentSession,
  type TranscriptItem,
} from "../app/model";
import { displayToolName } from "../app/tool-call-display";
import { t, type UiLocale } from "../app/i18n";
import type { DshSubagentAddress } from "../lib/desktop";

function subagentActivityText(activity: ChildSubagentEntry["activity"], locale: UiLocale) {
  return t(activity === "running" ? "subagent.running" : "subagent.stopped", locale);
}

function subagentModeText(mode: ChildSubagentEntry["mode"], locale: UiLocale) {
  return t(mode === "continuable" ? "subagent.continuable" : "subagent.oneShot", locale);
}

function subagentTitle(entry: ChildSubagentEntry | undefined, index: number, locale: UiLocale) {
  return entry?.label?.trim() || t("subagent.fallbackName", locale, { index: String(index + 1).padStart(2, "0") });
}

type SubagentPanelProps = {
  /** Whether the subagent execution drawer is open. */
  panelOpen: boolean;
  selectedId: string | null;
  selectedIndex: number;
  selectedEntry?: ChildSubagentEntry;
  loadingId: string | null;
  loadError: string | null;
  session: SubagentSession | null;
  transcript: TranscriptItem[];
  composer: string;
  locale?: UiLocale;
  onClose: () => void;
  onComposerChange: (value: string) => void;
  onPrompt: () => void | Promise<void>;
  onInterrupt: (address: DshSubagentAddress) => void | Promise<void>;
};

export function SubagentPanel({
  panelOpen,
  selectedId,
  selectedIndex,
  selectedEntry,
  loadingId,
  loadError,
  session,
  transcript,
  composer,
  locale = "zh",
  onClose,
  onComposerChange,
  onPrompt,
  onInterrupt,
}: SubagentPanelProps) {
  if (!panelOpen) {
    return <section className="subagent-drawer subagent-detail subagent-detail-empty" aria-label={t("subagent.panelAria", locale)}>
      <div className="subagent-drawer-body"><div className="subagent-drawer-empty"><strong>{t("subagent.selectBookmark", locale)}</strong><p>{t("subagent.selectBookmarkHint", locale)}</p></div></div>
    </section>;
  }

  return (
    <aside className="subagent-drawer subagent-detail" aria-label={t("subagent.panelAria", locale)} aria-live="polite">
      <header className="subagent-drawer-header">
        <div className="subagent-drawer-heading">
          <span className={`subagent-drawer-status ${selectedEntry?.activity ?? "inactive"}`} aria-hidden="true" />
          <div>
            <span className="subagent-drawer-kicker">{t("subagent.executionRecord", locale)} / {selectedIndex >= 0 ? String(selectedIndex + 1).padStart(2, "0") : "--"}</span>
            <h2>{selectedEntry ? subagentTitle(selectedEntry, selectedIndex, locale) : t("subagent.title", locale)}</h2>
            <p>{selectedEntry ? `${subagentActivityText(selectedEntry.activity, locale)} · ${subagentModeText(selectedEntry.mode, locale)}` : t("subagent.selectPrompt", locale)}</p>
          </div>
        </div>
        <button className="subagent-drawer-close" type="button" onClick={onClose} aria-label={t("subagent.closePanel", locale)} title={t("common.close", locale)}>×</button>
      </header>

      {selectedEntry && <div className="subagent-drawer-meta"><span><i className={selectedEntry.activity} />{subagentActivityText(selectedEntry.activity, locale)}</span><span>{subagentModeText(selectedEntry.mode, locale)}</span><code title={selectedEntry.id}>{shortSubagentId(selectedEntry.id)}</code></div>}

      <div className="subagent-drawer-body">
        {loadingId === selectedId ? (
          <div className="subagent-drawer-loading"><span className="subagent-loading-pulse" />{t("subagent.loadingRecord", locale)}</div>
        ) : loadError ? (
          <div className="subagent-drawer-empty error"><strong>{t("subagent.loadFailed", locale)}</strong><p>{loadError}</p></div>
        ) : session ? (
          <div className="subagent-history">
            {transcript.map((item) => item.kind === "tool" ? (
              <details className={`subagent-tool-entry ${item.toolResultError ? "error" : ""}`} key={item.key} open={item.toolResultText !== undefined}>
                <summary><span className="subagent-tool-state" /><strong>{displayToolName(item.toolName)}</strong><em>{item.toolResultError ? t("subagent.toolError", locale) : item.toolResultText !== undefined ? t("subagent.toolReturned", locale) : t("subagent.toolRunning", locale)}</em></summary>
                <div className="subagent-tool-content"><pre>{item.text}</pre>{item.toolResultText !== undefined && <div className="subagent-tool-result"><span>{t("subagent.toolResult", locale)}</span><pre>{item.toolResultText}</pre></div>}</div>
              </details>
            ) : (
              <article className={`subagent-message ${item.kind}`} key={item.key}>
                <div className="subagent-message-meta"><strong>{item.label}</strong><time>{formatClock(item.time)}</time></div>
                {item.injected ? <pre>{item.text}</pre> : <MarkdownContent text={item.text} reveal={item.kind === "assistant" && item.key.startsWith("stream-")} locale={locale} />}
              </article>
            ))}
            {transcript.length === 0 && <div className="subagent-drawer-empty"><strong>{t("subagent.noRecords", locale)}</strong><p>{t("subagent.noRecordsHint", locale)}</p></div>}
          </div>
        ) : (
          <div className="subagent-drawer-empty"><strong>{t("subagent.selectBookmark", locale)}</strong><p>{t("subagent.selectBookmarkHint", locale)}</p></div>
        )}
      </div>

      {session?.address.mode === "continuable" && <div className="subagent-compose"><input value={composer} onChange={(event) => onComposerChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void onPrompt(); }} placeholder={t("subagent.followUp", locale)} aria-label={t("subagent.followUp", locale)} /><button type="button" onClick={() => void onInterrupt(session.address)} title={t("subagent.interruptTitle", locale)}>{t("subagent.interrupt", locale)}</button><button type="button" onClick={() => void onPrompt()}>{t("subagent.send", locale)}</button></div>}
    </aside>
  );
}
