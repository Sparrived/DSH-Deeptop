import { useEffect, useState } from "react";
import type { DshSettingsDescription } from "../lib/desktop";
import { PROMPT_INJECTION_NS } from "../app/prompt-injection-model";
import { t, type UiLocale } from "../app/i18n";

/**
 * 全局提示词注入设置卡片（设置 → 通用）。
 *
 * 只负责编辑草稿并交给上层保存：文本由 `deeptop-prompt-injection` 命名空间承载，
 * 由 `cordis/prompt-injection` 注入每个 Session 的 system prompt。命名空间的读写与
 * 刷新都在 App 里完成，本组件不直接调用 Bridge。
 */

type PromptInjectionPanelProps = {
  current: string;
  settings: DshSettingsDescription | null;
  saving: boolean;
  locale: UiLocale;
  onSave: (next: string) => void | Promise<void>;
};

export function PromptInjectionPanel({ current, settings, saving, locale, onSave }: PromptInjectionPanelProps) {
  const [draft, setDraft] = useState(current);
  // 保存后设置视图会重读；值变化时重新同步草稿，避免丢弃用户的未保存编辑。
  useEffect(() => {
    setDraft(current);
  }, [current]);

  const writable = settings?.writable ?? false;
  const namespaceAvailable = settings?.namespaces.some((namespace) => namespace.ns === PROMPT_INJECTION_NS) ?? false;
  const dirty = draft !== current;
  const canSave = writable && namespaceAvailable && dirty && !saving;

  return (
    <div className="settings-block">
      <div className="settings-block-heading">
        <div><h3>{t("promptInjection.title", locale)}</h3><p>{t("promptInjection.hint", locale)}</p></div>
      </div>

      {!namespaceAvailable && <p className="settings-empty">{t("promptInjection.unavailable", locale)}</p>}

      <label className="prompt-injection-field">
        <span>{t("promptInjection.text", locale)}</span>
        <textarea
          value={draft}
          disabled={!writable || !namespaceAvailable}
          placeholder={t("promptInjection.placeholder", locale)}
          rows={5}
          onChange={(event) => setDraft(event.target.value)}
        />
        <small>{draft.trim() === "" ? t("promptInjection.emptyHint", locale) : t("promptInjection.effectiveHint", locale)}</small>
      </label>

      <div className="prompt-injection-actions">
        <button type="button" disabled={!dirty || saving} onClick={() => setDraft(current)}>{t("promptInjection.reset", locale)}</button>
        <button type="button" className="confirm" disabled={!canSave} onClick={() => void onSave(draft)}>
          {saving ? t("promptInjection.saving", locale) : t("promptInjection.save", locale)}
        </button>
      </div>
    </div>
  );
}
