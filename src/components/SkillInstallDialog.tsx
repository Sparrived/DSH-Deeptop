import { useState, type FormEvent } from "react";
import type { ManagedSkillInstallDraft } from "../app/useToolSettings";
import { t, type UiLocale } from "../app/i18n";
import { PopupDialog } from "./PopupDialog";

interface SkillInstallDialogProps {
  locale: UiLocale;
  operation: { id: string; cancelling: boolean; uncertain: boolean } | null;
  onClose: () => void;
  onCancelInstall: () => void | Promise<void>;
  onRetryInstall: () => void | Promise<boolean>;
  onDismissInstall: () => void;
  onInstall: (draft: ManagedSkillInstallDraft) => Promise<boolean>;
}

/** Approval-like, cancellable GitHub Skill installer used only by Tools settings. */
export function SkillInstallDialog({ locale, operation, onClose, onCancelInstall, onRetryInstall, onDismissInstall, onInstall }: SkillInstallDialogProps) {
  const [source, setSource] = useState("");
  const [path, setPath] = useState("");
  const [ref, setRef] = useState("");
  const [name, setName] = useState("");
  const [method, setMethod] = useState<"auto" | "download" | "git">("auto");
  const [formError, setFormError] = useState("");
  const busy = operation !== null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSource = source.trim();
    if (!nextSource) {
      setFormError(t("tools.skills.install.sourceRequired", locale));
      return;
    }
    if (name.trim() && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name.trim())) {
      setFormError(t("tools.skills.install.nameInvalid", locale));
      return;
    }
    setFormError("");
    try {
      const installed = await onInstall({
        source: nextSource,
        ...(path.trim() ? { path: path.trim() } : {}),
        ...(ref.trim() ? { ref: ref.trim() } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        method,
      });
      if (installed) onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  function close() {
    if (operation?.uncertain) {
      onClose();
      return;
    }
    if (busy) {
      void Promise.resolve(onCancelInstall()).catch(() => undefined);
      return;
    }
    onClose();
  }

  return (
    <PopupDialog
      locale={locale}
      title={t("tools.skills.install.title", locale)}
      eyebrow="SKILLS / GITHUB"
      description={t("tools.skills.install.description", locale)}
      className="popup-skill-install-dialog"
      onClose={close}
      footer={operation?.uncertain ? <>
        <span className="skill-install-progress" role="status">{t("tools.skills.installUnknown", locale)}</span>
        <button type="button" onClick={() => void Promise.resolve(onRetryInstall()).catch(() => undefined)}>{t("tools.skills.installRetryStatus", locale)}</button>
        <button type="button" onClick={onDismissInstall}>{t("tools.skills.installDismiss", locale)}</button>
      </> : busy ? <>
        <span className="skill-install-progress" role="status">{operation.cancelling ? t("tools.skills.install.cancelling", locale) : t("tools.skills.install.running", locale)}</span>
        <button type="button" className="danger" disabled={operation.cancelling} onClick={() => void Promise.resolve(onCancelInstall()).catch(() => undefined)}>{t("tools.skills.install.cancel", locale)}</button>
      </> : <>
        <button type="button" onClick={onClose}>{t("common.cancel", locale)}</button>
        <button type="submit" form="skill-settings-install-form" className="confirm">{t("tools.skills.install.action", locale)}</button>
      </>}
    >
      <form id="skill-settings-install-form" className="skill-settings-install-form" onSubmit={submit}>
        <label className="popup-field">
          <span>{t("tools.skills.install.source", locale)}</span>
          <input value={source} disabled={busy} onChange={(event) => { setSource(event.target.value); setFormError(""); }} placeholder="https://github.com/owner/repository" autoFocus />
          <small>{t("tools.skills.install.sourceHint", locale)}</small>
        </label>
        <div className="skill-install-pair">
          <label className="popup-field">
            <span>{t("tools.skills.install.path", locale)} <em>{t("tools.optional", locale)}</em></span>
            <input value={path} disabled={busy} onChange={(event) => setPath(event.target.value)} placeholder="skills/example" />
          </label>
          <label className="popup-field">
            <span>{t("tools.skills.install.ref", locale)} <em>{t("tools.optional", locale)}</em></span>
            <input value={ref} disabled={busy} onChange={(event) => setRef(event.target.value)} placeholder="main" />
          </label>
        </div>
        <div className="skill-install-pair">
          <label className="popup-field">
            <span>{t("tools.skills.install.name", locale)} <em>{t("tools.optional", locale)}</em></span>
            <input value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setFormError(""); }} placeholder="my-skill" />
          </label>
          <label className="popup-field">
            <span>{t("tools.skills.install.method", locale)}</span>
            <select value={method} disabled={busy} onChange={(event) => setMethod(event.target.value as typeof method)}>
              <option value="auto">{t("tools.skills.install.methodAuto", locale)}</option>
              <option value="download">{t("tools.skills.install.methodDownload", locale)}</option>
              <option value="git">Git</option>
            </select>
          </label>
        </div>
        {formError && <p className="plugin-install-error" role="alert">{formError}</p>}
        <p className="tools-security-note">{t("tools.skills.install.security", locale)}</p>
      </form>
    </PopupDialog>
  );
}
