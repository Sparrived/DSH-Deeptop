import type { DshHostModelCatalog } from "../app/model";
import { t, type UiLocale } from "../app/i18n";

interface SettingsModelCatalogProps {
  catalog: DshHostModelCatalog | null;
  locale?: UiLocale;
}

export function SettingsModelCatalog({ catalog, locale = "zh" }: SettingsModelCatalogProps) {
  return <div className="settings-block">
    <div className="settings-block-heading"><div><h3>{t("settings.modelsCatalog.available", locale)}</h3><p>{t("settings.modelsCatalog.hint", locale)}</p></div></div>
    {!catalog || catalog.groups.length === 0 ? <p className="settings-empty">{t("settings.modelsCatalog.unavailable", locale)}</p> : <div className="settings-model-catalog">{catalog.groups.map((group) => <div className="settings-model-group" key={group.id}><div><strong>{group.name}</strong><small>{group.id}</small></div><span>{t("settings.modelsCatalog.modelCount", locale, { count: group.models.length })}</span><p>{group.models.map((model) => model.name).join(" · ")}</p></div>)}</div>}
  </div>;
}
