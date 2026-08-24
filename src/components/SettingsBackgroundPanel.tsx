import { useRef, useState } from "react";
import type { BackgroundConfig, BackgroundSettings, BackgroundZone } from "../app/model";
import { backgroundZones } from "../app/useAppearanceSettings";
import { t, type UiLocale } from "../app/i18n";

export type SettingsBackgroundPanelProps = {
  backgrounds: BackgroundSettings;
  onUpdateBackground: (zone: BackgroundZone, patch: Partial<BackgroundConfig>) => void;
  onBackgroundFile: (zone: BackgroundZone, file: File | undefined) => void;
  onClearBackground: (zone: BackgroundZone) => void;
  embedded?: boolean;
  locale?: UiLocale;
};

const backgroundPositions: BackgroundConfig["position"][] = ["center", "top", "bottom", "left", "right"];

const positionLabelKeys: Record<BackgroundConfig["position"], string> = {
  center: "background.position.center",
  top: "background.position.top",
  bottom: "background.position.bottom",
  left: "background.position.left",
  right: "background.position.right",
};

const zoneLabelKey = (zone: BackgroundZone) => `background.zone.${zone}.label`;
const zoneHintKey = (zone: BackgroundZone) => `background.zone.${zone}.hint`;

export function SettingsBackgroundPanel({
  backgrounds,
  onUpdateBackground,
  onBackgroundFile,
  onClearBackground,
  embedded = false,
  locale = "zh",
}: SettingsBackgroundPanelProps) {
  const [zone, setZone] = useState<BackgroundZone>("global");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const config = backgrounds[zone];
  const hasImage = Boolean(config.image);

  const schematicClass = (item: BackgroundZone, extra = "") =>
    `${extra}${zone === item ? " selected" : ""}${backgrounds[item].image ? " has-image" : ""}`.trim();

  return (
    <div className={embedded ? "background-settings-page embedded-background-settings-page" : "settings-page background-settings-page"}>
      {!embedded && <div className="settings-page-header">
        <div><span className="settings-overline">BACKGROUND WORKBENCH</span><h2>{t("settings.background", locale)}</h2><p>{t("background.workbenchHint", locale)}</p></div>
      </div>}

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>{t("background.zonesTitle", locale)}</h3><p>{t("background.zonesHint", locale)}</p></div></div>
        <div className="background-zone-tabs">
          {backgroundZones.map((item) => (
            <button
              key={item}
              type="button"
              className={`background-zone-tab${zone === item ? " selected" : ""}${backgrounds[item].image ? " has-image" : ""}`}
              onClick={() => setZone(item)}
            >
              <strong>{t(zoneLabelKey(item), locale)}</strong>
              <small>{t(zoneHintKey(item), locale)}</small>
            </button>
          ))}
        </div>

        <div className="background-schematic" role="group" aria-label={t("background.schematicAria", locale)}>
          <button type="button" className={schematicClass("windowbar", "bg-schematic-windowbar")} onClick={() => setZone("windowbar")}>
            <span>{t(zoneLabelKey("windowbar"), locale)}</span>
          </button>
          <button type="button" className={schematicClass("sidebar", "bg-schematic-sidebar")} onClick={() => setZone("sidebar")}>
            <span>{t(zoneLabelKey("sidebar"), locale)}</span>
          </button>
          <div className="bg-schematic-main">
            <button type="button" className={schematicClass("conversation", "bg-schematic-header")} onClick={() => setZone("conversation")}>
              <span>{t("background.schematic.conversationTitle", locale)}</span>
            </button>
            <button type="button" className={schematicClass("conversation", "bg-schematic-transcript")} onClick={() => setZone("conversation")}>
              <span>{t("background.schematic.transcript", locale)}</span>
            </button>
            <button type="button" className={schematicClass("composer", "bg-schematic-composer")} onClick={() => setZone("composer")}>
              <span>{t("background.schematic.composer", locale)}</span>
            </button>
          </div>
          <button type="button" className={schematicClass("dock", "bg-schematic-dock")} onClick={() => setZone("dock")}>
            <span>{t(zoneLabelKey("dock"), locale)}</span>
          </button>
          <button type="button" className={schematicClass("global", "bg-schematic-global")} onClick={() => setZone("global")}>
            <span>{t("background.schematic.global", locale)}</span>
          </button>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div><h3>{t(zoneLabelKey(zone), locale)}</h3><p>{t(zoneHintKey(zone), locale)}{config.name ? ` · ${config.name}` : ""}</p></div>
          <div className="appearance-theme-actions">
            <input
              ref={fileInputRef}
              className="appearance-file-input"
              type="file"
              accept="image/*"
              onChange={(event) => { onBackgroundFile(zone, event.target.files?.[0]); event.currentTarget.value = ""; }}
            />
            <button type="button" className="settings-header-action" onClick={() => fileInputRef.current?.click()}>{t("background.importImage", locale)}</button>
            {hasImage && <button type="button" className="settings-header-action" onClick={() => onClearBackground(zone)}>{t("background.clear", locale)}</button>}
          </div>
        </div>

        <div className="appearance-background-source">
          <label><span>{t("background.imageUrl", locale)}</span><input type="url" value={config.image.startsWith("data:") ? "" : config.image} placeholder="https://example.com/background.jpg" onChange={(event) => onUpdateBackground(zone, { image: event.target.value.trim(), name: "" })} /></label>
          {hasImage && (
            <span
              className="background-source-preview"
              style={config.image ? { backgroundImage: `url(${JSON.stringify(config.image)})` } : undefined}
              aria-label={t("background.previewAria", locale)}
            />
          )}
        </div>

        {zone !== "global" && (
          <label className="background-panel-opacity-row">
            <span><strong>{t("background.panelOpacity", locale)}</strong><small>{t("background.panelOpacityHint", locale)}</small></span>
            <span className="appearance-range-control"><input type="range" min="0" max="100" step="1" value={config.panelOpacity} onChange={(event) => onUpdateBackground(zone, { panelOpacity: Number(event.target.value) })} /><output>{Math.round(config.panelOpacity)}%</output></span>
          </label>
        )}

        <div className="appearance-background-grid">
          <label><span>{t("background.imageOpacity", locale)}</span><input type="range" min="0.05" max="0.45" step="0.01" value={config.opacity} onChange={(event) => onUpdateBackground(zone, { opacity: Number(event.target.value) })} /><output>{Math.round(config.opacity * 100)}%</output></label>
          <label><span>{t("background.blur", locale)}</span><input type="range" min="0" max="16" step="1" value={config.blur} onChange={(event) => onUpdateBackground(zone, { blur: Number(event.target.value) })} /><output>{config.blur}px</output></label>
          <label><span>{t("background.size", locale)}</span><select value={config.size} onChange={(event) => onUpdateBackground(zone, { size: event.target.value as BackgroundConfig["size"] })}><option value="cover">{t("background.sizeCover", locale)}</option><option value="contain">{t("background.sizeContain", locale)}</option></select></label>
          <label><span>{t("background.positionLabel", locale)}</span><select value={config.position} onChange={(event) => onUpdateBackground(zone, { position: event.target.value as BackgroundConfig["position"] })}>{backgroundPositions.map((item) => <option value={item} key={item}>{t(positionLabelKeys[item], locale)}</option>)}</select></label>
        </div>

        <p className="background-zone-note">
          {backgroundZones.filter((item) => backgrounds[item].image).length > 0
            ? t("background.configuredCount", locale, { count: backgroundZones.filter((item) => backgrounds[item].image).length })
            : t("background.noneConfigured", locale)}
          {t("background.dataUrlNote", locale)}
        </p>
      </div>
    </div>
  );
}
