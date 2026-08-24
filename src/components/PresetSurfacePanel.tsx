import { presetDescription, presetDisplayName } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import type { DshPreset } from "../lib/desktop";

type AsyncAction = () => void | Promise<unknown>;

export interface InspectorPresetCopy {
  from: string;
  id: string;
  name: string;
}

export interface InspectorPresetView {
  id: string;
  content: string;
}

interface PresetSurfacePanelProps {
  presets: DshPreset[];
  writable?: boolean;
  authorable: boolean;
  copy: InspectorPresetCopy | null;
  view: InspectorPresetView | null;
  locale?: UiLocale;
  onSetDefault: (id: string) => void | Promise<unknown>;
  onRead: (id: string) => void | Promise<unknown>;
  onOpenDocument: (id: string) => void | Promise<unknown>;
  onBeginCopy: (id: string) => void;
  onCopyChange: (patch: Partial<InspectorPresetCopy>) => void;
  onCopy: AsyncAction;
  onCancelCopy: () => void;
  onCloseView: () => void;
  onRemove: (id: string) => void | Promise<unknown>;
}

export function PresetSurfacePanel({
  presets,
  writable,
  authorable,
  copy,
  view,
  locale = "zh",
  onSetDefault,
  onRead,
  onOpenDocument,
  onBeginCopy,
  onCopyChange,
  onCopy,
  onCancelCopy,
  onCloseView,
  onRemove,
}: PresetSurfacePanelProps) {
  return <div className="surface-content">
    <div className="surface-intro"><strong>Agent Preset</strong><p>{t("presets.intro", locale)}</p></div>
    <label className="surface-field">{t("presets.defaultLabel", locale)}
      <select disabled={writable === false} value={presets.find((preset) => preset.isDefault)?.id || ""} onChange={(event) => void onSetDefault(event.target.value)}>
        {presets.filter((preset) => !preset.broken).map((preset) => <option value={preset.id} key={preset.id}>{presetDisplayName(preset.id, presets, locale)}</option>)}
      </select>
    </label>
    <div className="surface-list">{presets.map((preset) => (
      <div className="surface-row" key={preset.id}>
        <div><strong>{presetDisplayName(preset.id, presets, locale)}</strong><small>{preset.id} · {preset.trust}{preset.isDefault ? t("presets.defaultTag", locale) : ""}</small><p>{presetDescription(preset, locale)}</p>{preset.broken && <p className="surface-error">{preset.broken}</p>}</div>
        <div className="surface-row-actions">{!preset.broken && <button onClick={() => void onRead(preset.id)} title={t("presets.viewTitle", locale)}>{t("presets.view", locale)}</button>}{preset.trust === "user" && <button onClick={() => void onOpenDocument(preset.id)} title={t("presets.openTitle", locale)}>{t("common.open", locale)}</button>}<button disabled={!authorable || Boolean(preset.broken)} onClick={() => onBeginCopy(preset.id)} title={t("presets.copyTitle", locale)}>{t("common.copy", locale)}</button>{preset.trust === "user" && <button onClick={() => void onRemove(preset.id)} title={t("presets.deleteTitle", locale)}>{t("common.delete", locale)}</button>}</div>
      </div>
    ))}</div>
    {!authorable && <p className="surface-muted">{t("presets.notAuthorable", locale)}</p>}
    {authorable && <p className="surface-muted">{t("presets.authorableHint", locale)}</p>}
    {copy && <div className="surface-dialog"><strong>{t("presets.copyDialog", locale, { from: copy.from })}</strong><input placeholder={t("presets.idPlaceholder", locale)} value={copy.id} onChange={(event) => onCopyChange({ id: event.target.value })} /><input placeholder={t("presets.namePlaceholder", locale)} value={copy.name} onChange={(event) => onCopyChange({ name: event.target.value })} /><div className="surface-dialog-actions"><button onClick={onCancelCopy}>{t("common.cancel", locale)}</button><button className="confirm" disabled={!copy.id.trim()} onClick={() => void onCopy()}>{t("presets.create", locale)}</button></div></div>}
    {view && <div className="surface-dialog"><strong>{view.id} / agent.cordis.yml</strong><pre className="surface-code">{view.content}</pre><button onClick={onCloseView}>{t("common.close", locale)}</button></div>}
  </div>;
}
