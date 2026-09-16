// Client module of the global prompt-injection plugin. It ships the settings
// panel the plugin itself owns: the host side (`cordis/prompt-injection`)
// registers the namespace and injects the text into every Session prompt,
// while this module renders the card and writes through the scoped settings
// facade. Nothing in `src/App.tsx` names this namespace any more.

import { useEffect, useState } from "react";
import type { DshSettingsNamespace } from "../desktop";
import { PROMPT_INJECTION_NS, promptInjectionOps, readPromptInjection } from "../../app/prompt-injection-model";
import { t } from "../../app/i18n";
import type { DeeptopClientContext, ScopedSettings, SlotRenderContext } from "./types";

/** One panel per plugin; the nav entry and the content column share this id. */
const CONTRIBUTION_ID = "prompt-injection.panel";

interface PanelProps {
  scoped: ScopedSettings;
  context: SlotRenderContext;
}

function PromptInjectionPanel({ scoped, context }: PanelProps) {
  const [namespace, setNamespace] = useState<DshSettingsNamespace | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const locale = context.locale;

  // Selecting the settings section mounts this panel, so every visit re-reads
  // the live namespace instead of trusting a value cached at activation.
  useEffect(() => {
    let active = true;
    scoped.describe(PROMPT_INJECTION_NS).then(
      (view) => {
        if (!active) return;
        setNamespace(view);
        setDraft(readPromptInjection(view));
      },
      () => {
        // The facade rejects once the plugin context is disposed and when the
        // Host does not register the namespace; both mean "not configurable".
        if (active) setUnavailable(true);
      },
    );
    return () => {
      active = false;
    };
  }, [scoped]);

  const current = readPromptInjection(namespace ?? undefined);
  const dirty = draft !== current;
  const canSave = namespace !== null && dirty && !saving;

  async function save() {
    if (!namespace || !dirty || saving) return;
    const ops = promptInjectionOps(current, draft);
    if (ops.length === 0) return;
    setSaving(true);
    try {
      // The revision read above fences the write: a concurrent edit makes the
      // Host answer `settings/conflict` rather than clobbering it.
      const next = await scoped.mutate(PROMPT_INJECTION_NS, ops, namespace.revision);
      setNamespace(next);
      setDraft(readPromptInjection(next));
      context.host.notify(t("promptInjection.saved", locale));
    } catch (error) {
      context.host.notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-block">
      <div className="settings-block-heading">
        <div>
          <h3>{t("promptInjection.title", locale)}</h3>
          <p>{t("promptInjection.hint", locale)}</p>
        </div>
      </div>

      {unavailable && <p className="settings-empty">{t("promptInjection.unavailable", locale)}</p>}

      <label className="prompt-injection-field">
        <span>{t("promptInjection.text", locale)}</span>
        <textarea
          value={draft}
          disabled={unavailable || saving}
          placeholder={t("promptInjection.placeholder", locale)}
          rows={5}
          onChange={(event) => setDraft(event.target.value)}
        />
        <small>{draft.trim() === "" ? t("promptInjection.emptyHint", locale) : t("promptInjection.effectiveHint", locale)}</small>
      </label>

      <div className="prompt-injection-actions">
        <button type="button" disabled={!dirty || saving} onClick={() => setDraft(current)}>
          {t("promptInjection.reset", locale)}
        </button>
        <button type="button" className="confirm" disabled={!canSave} onClick={() => void save()}>
          {saving ? t("promptInjection.saving", locale) : t("promptInjection.save", locale)}
        </button>
      </div>
    </div>
  );
}

export function activate(context: DeeptopClientContext): void {
  const scoped = context.settings;
  context.ui.register("settings.sections", {
    kind: "panel",
    id: CONTRIBUTION_ID,
    // A function label, not a captured string: `activate()` runs once, so the
    // nav retranslates from the live locale on every render.
    label: (locale) => t("promptInjection.title", locale),
    render: (slot: SlotRenderContext) => <PromptInjectionPanel scoped={scoped} context={slot} />,
  });
}
