import { useState, type FormEvent } from "react";
import { PopupDialog } from "./PopupDialog";
import { t, type UiLocale } from "../app/i18n";

export type PluginInstallSource = "local" | "package";

export interface PluginInstallDraft {
  id: string;
  name: string;
  source: PluginInstallSource;
}

interface PluginInstallDialogProps {
  existingIds: string[];
  pickingEntry: boolean;
  onClose: () => void;
  onPickEntry: () => Promise<string | null>;
  onSubmit: (draft: PluginInstallDraft) => string | null;
  /** 界面语言；可选，默认 "zh"，保持向后兼容。 */
  locale?: UiLocale;
}

function suggestedIdFromEntry(path: string) {
  const fileName = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  const candidate = fileName.toLocaleLowerCase() === "index"
    ? "my-plugin"
    : fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return candidate || "my-plugin";
}

export function PluginInstallDialog({
  existingIds,
  pickingEntry,
  onClose,
  onPickEntry,
  onSubmit,
  locale = "zh",
}: PluginInstallDialogProps) {
  const [source, setSource] = useState<PluginInstallSource>("local");
  const [id, setId] = useState("my-plugin");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");

  async function pickEntry() {
    setFormError("");
    const path = await onPickEntry();
    if (!path) return;
    setSource("local");
    setName(path);
    if (id === "my-plugin") setId(suggestedIdFromEntry(path));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextId = id.trim();
    const nextName = name.trim();
    if (!nextId || !nextName) {
      setFormError(t("pluginInstall.errorRequired", locale));
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(nextId)) {
      setFormError(t("pluginInstall.errorIdFormat", locale));
      return;
    }
    const duplicate = existingIds.some((existingId) => existingId === nextId);
    if (duplicate) {
      setFormError(t("pluginInstall.errorDuplicate", locale, { id: nextId }));
      return;
    }
    const error = onSubmit({ id: nextId, name: nextName, source });
    if (error) setFormError(error);
  }

  return (
    <PopupDialog
      title={t("pluginInstall.title", locale)}
      eyebrow="DESKTOP PLUGINS / ADD"
      description={t("pluginInstall.description", locale)}
      className="popup-plugin-install-dialog"
      locale={locale}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>{t("common.cancel", locale)}</button>
        <button type="submit" form="plugin-install-form" className="confirm">{t("pluginInstall.addToList", locale)}</button>
      </>}
    >
      <form id="plugin-install-form" className="plugin-install-form" onSubmit={submit}>
        <fieldset className="plugin-install-source-picker">
          <legend>{t("pluginInstall.source", locale)}</legend>
          <label className={source === "local" ? "selected" : ""}>
            <input type="radio" name="plugin-source" checked={source === "local"} onChange={() => { setSource("local"); setName(""); setFormError(""); }} />
            <span><strong>{t("pluginInstall.sourceLocal", locale)}</strong><small>{t("pluginInstall.sourceLocalHint", locale)}</small></span>
          </label>
          <label className={source === "package" ? "selected" : ""}>
            <input type="radio" name="plugin-source" checked={source === "package"} onChange={() => { setSource("package"); setName(""); setFormError(""); }} />
            <span><strong>{t("pluginInstall.sourcePackage", locale)}</strong><small>{t("pluginInstall.sourcePackageHint", locale)}</small></span>
          </label>
        </fieldset>

        <label className="popup-field">
          <span>{t("plugins.id", locale)}</span>
          <input value={id} onChange={(event) => { setId(event.target.value); setFormError(""); }} placeholder={t("pluginInstall.idPlaceholder", locale)} autoFocus />
          <small className="plugin-install-help">{t("pluginInstall.idHelp", locale)}</small>
        </label>

        <label className="popup-field">
          <span>{source === "local" ? t("pluginInstall.entryPath", locale) : t("pluginInstall.packageOrModule", locale)}</span>
          <div className="plugin-install-path-control">
            <input value={name} onChange={(event) => { setName(event.target.value); setFormError(""); }} placeholder={source === "local" ? t("pluginInstall.entryPlaceholder", locale) : t("pluginInstall.packagePlaceholder", locale)} />
            {source === "local" && <button type="button" onClick={() => void pickEntry()} disabled={pickingEntry}>{pickingEntry ? t("pluginInstall.picking", locale) : t("pluginInstall.pickFile", locale)}</button>}
          </div>
          <small className="plugin-install-help">{source === "local" ? t("pluginInstall.localHelp", locale) : t("pluginInstall.packageHelp", locale)}</small>
        </label>

        {formError && <p className="plugin-install-error" role="alert">{formError}</p>}
        <div className="plugin-install-steps" aria-label={t("pluginInstall.stepsAria", locale)}>
          <span><b>1</b><small>{t("pluginInstall.stepEntry", locale)}</small></span>
          <span><b>2</b><small>{t("pluginInstall.stepAdd", locale)}</small></span>
          <span><b>3</b><small>{t("pluginInstall.stepSave", locale)}</small></span>
        </div>
      </form>
    </PopupDialog>
  );
}
