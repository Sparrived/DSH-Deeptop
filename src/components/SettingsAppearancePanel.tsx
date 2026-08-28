import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import type { AppearanceSettings, AppearanceSection, WorkingIndicatorEffect } from "../app/model";
import type { AppTheme, ThemeMode } from "../app/model";
import { SettingsBackgroundPanel } from "./SettingsBackgroundPanel";
import { normalizeWorkingIndicator, workingIndicatorTextAt } from "../app/working-indicator";
import { t, type UiLocale } from "../app/i18n";

type FontPreset = { value: string; labelKey: string };

type SettingsAppearancePanelProps = {
  locale?: UiLocale;
  appearance: AppearanceSettings;
  section: AppearanceSection;
  themeMode: ThemeMode;
  appTheme: AppTheme;
  themesDir: string | null;
  themePathError: string;
  themePathLoading: boolean;
  /** 主题 id 列表：内置 + themes/ 下用户放入的自定义文件，按目录约定拼接路径。 */
  themeIds: string[];
  fontPreset: string;
  codeFontPreset: string;
  fontPresets: FontPreset[];
  codeFontPresets: FontPreset[];
  onSectionChange: (section: AppearanceSection) => void;
  onUpdate: (patch: Partial<AppearanceSettings>) => void;
  onUpdateBackground: SettingsBackgroundPanelProps["onUpdateBackground"];
  onBackgroundFile: SettingsBackgroundPanelProps["onBackgroundFile"];
  onClearBackground: SettingsBackgroundPanelProps["onClearBackground"];
  onThemeChange: (mode: ThemeMode) => void;
  onAppThemeChange: (theme: AppTheme) => void;
  onPickThemeCss: () => void;
  onReloadThemeCss: () => void;
  onOpenThemesDirectory: () => void;
  onRescanThemes: () => void;
  onThemeFile: (file: File | undefined) => void;
  onImport: (file: File | undefined) => void;
  onExport: () => void;
  onResetSection: () => void;
};

type SettingsBackgroundPanelProps = ComponentProps<typeof SettingsBackgroundPanel>;

const subpages: Array<{ id: AppearanceSection; labelKey: string; hintKey: string }> = [
  { id: "theme", labelKey: "settings.theme", hintKey: "appearance.tabHint.theme" },
  { id: "background", labelKey: "settings.background", hintKey: "appearance.tabHint.background" },
  { id: "typography", labelKey: "settings.typography", hintKey: "appearance.tabHint.typography" },
  { id: "css", labelKey: "settings.css", hintKey: "appearance.tabHint.css" },
];

function SectionHeader({ section, onResetSection, locale }: { section: AppearanceSection; onResetSection: () => void; locale: UiLocale }) {
  const current = subpages.find((item) => item.id === section) ?? subpages[0];
  const label = t(current.labelKey, locale);
  return (
    <div className="settings-page-header">
      <div>
        <span className="settings-overline">APPEARANCE / {label.toUpperCase()}</span>
        <h2>{label}</h2>
        <p>{t("appearance.headerHint", locale, { hint: t(current.hintKey, locale) })}</p>
      </div>
      <button type="button" className="settings-header-action" onClick={onResetSection}>{t("appearance.resetSection", locale)}</button>
    </div>
  );
}

export function SettingsAppearancePanel({
  locale = "zh",
  appearance,
  section,
  themeMode,
  appTheme,
  themesDir,
  themePathError,
  themePathLoading,
  themeIds,
  fontPreset,
  codeFontPreset,
  fontPresets,
  codeFontPresets,
  onSectionChange,
  onUpdate,
  onUpdateBackground,
  onBackgroundFile,
  onClearBackground,
  onThemeChange,
  onAppThemeChange,
  onPickThemeCss,
  onReloadThemeCss,
  onOpenThemesDirectory,
  onRescanThemes,
  onThemeFile,
  onImport,
  onExport,
  onResetSection,
}: SettingsAppearancePanelProps) {
  // 下拉项：内置主题（顺序固定） → themes/ 下用户放入的自定义主题（字母序） → custom。
  // 重复 id 优先取 themeIds 中的扫描结果（说明该主题已被 themes/ 接管）。
  const builtinIds = ["monokai-pro", "one-dark", "gov"] as const;
  const builtinOptions = builtinIds
    .map((id) => ({ value: id, label: id }))
    .filter((option) => themeIds.includes(option.value));
  const customOptions = themeIds
    .filter((id) => !builtinIds.includes(id as (typeof builtinIds)[number]))
    .map((id) => ({ value: id, label: id }));
  const themeOptions: Array<{ value: string; label: string }> = [
    ...builtinOptions,
    ...customOptions,
  ];
  const themeFileInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundCount = Object.values(appearance.backgrounds).filter((bg) => Boolean(bg.image)).length;
  const workingIndicator = normalizeWorkingIndicator(appearance.workingIndicator);
  const workingTextCount = workingIndicator.texts.length;
  // 预览与运行中的指示器保持同一轮换节奏，便于在设置里直接核对效果。
  const [previewIndex, setPreviewIndex] = useState(0);
  const previewTextKey = workingIndicator.texts.join("\u0000");

  useEffect(() => {
    setPreviewIndex(0);
  }, [previewTextKey]);

  useEffect(() => {
    if (workingTextCount < 2) return;
    const timer = window.setInterval(() => setPreviewIndex((current) => current + 1), workingIndicator.rotationInterval);
    return () => window.clearInterval(timer);
  }, [workingIndicator.rotationInterval, workingTextCount, previewTextKey]);

  return (
    <div className="settings-page appearance-settings-page">
      <SectionHeader section={section} onResetSection={onResetSection} locale={locale} />

      <div className="appearance-subpage-grid" role="tablist" aria-label={t("appearance.tabsAria", locale)}>
        {subpages.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={`appearance-subpage-card${section === item.id ? " selected" : ""}`}
            onClick={() => onSectionChange(item.id)}
          >
            <strong>{t(item.labelKey, locale)}</strong>
            <small>{t(item.hintKey, locale)}</small>
            {item.id === "background" && <em>{backgroundCount ? t("appearance.zonesConfigured", locale, { count: backgroundCount }) : t("appearance.notYetConfigured", locale)}</em>}
            {item.id === "css" && <em>{appearance.customCss ? (appearance.customCssName || t("appearance.imported", locale)) : t("appearance.notImported", locale)}</em>}
          </button>
        ))}
      </div>

      <div className="appearance-import-export">
        <span>{t("appearance.currentSection", locale, { label: t(subpages.find((item) => item.id === section)?.labelKey ?? "settings.theme", locale) })}</span>
        <input
          ref={importFileInputRef}
          className="appearance-file-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => { onImport(event.target.files?.[0]); event.currentTarget.value = ""; }}
        />
        <button type="button" className="settings-header-action" onClick={() => importFileInputRef.current?.click()}>{t("appearance.importConfig", locale)}</button>
        <button type="button" className="settings-header-action export" onClick={onExport}>{t("appearance.exportConfig", locale)}</button>
      </div>

      {section === "theme" && (
        <div className="settings-block">
          <div className="settings-block-heading"><div><h3>{t("appearance.themeTitle", locale)}</h3><p>{t("appearance.themeHint", locale)}</p></div></div>
          <div className="settings-preference-list">
            <label className="settings-preference-row"><span><strong>{t("appearance.lightDark", locale)}</strong><small>{t("appearance.themeModeHint", locale)}</small></span><select value={themeMode} onChange={(event) => onThemeChange(event.target.value as ThemeMode)}><option value="system">{t("appearance.themeModeSystem", locale)}</option><option value="light">{t("appearance.themeModeLight", locale)}</option><option value="dark">{t("appearance.themeModeDark", locale)}</option></select></label>
            <label className="settings-preference-row"><span><strong>{t("settings.theme", locale)}</strong><small>{t("appearance.themeSelectHint", locale)}</small></span><span className="appearance-theme-picker"><select value={appTheme} onChange={(event) => onAppThemeChange(event.target.value as AppTheme)}>{themeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}<option value="custom">{t("appearance.themeCustomPath", locale)}</option></select><button type="button" className="settings-header-action" onClick={onRescanThemes} title={t("appearance.rescanThemesTitle", locale)}>{t("appearance.rescanThemes", locale)}</button></span></label>
            {appTheme === "custom" && (
              <label className="settings-preference-row appearance-path-row"><span><strong>{t("appearance.themeCssPathLabel", locale)}</strong><small>{t("appearance.themeCssPathHint", locale)}</small></span><span className="appearance-theme-path-control"><input value={appearance.themeCssPath} onChange={(event) => onUpdate({ themeCssPath: event.target.value })} placeholder="C:\\path\\to\\my-theme.css" spellCheck={false} /><button type="button" className="settings-header-action" onClick={onPickThemeCss}>{t("appearance.browse", locale)}</button></span></label>
            )}
            <label className="settings-preference-row"><span><strong>{t("appearance.themesDirLabel", locale)}</strong><small>{themesDir || t("common.desktopOnly", locale)}</small></span><button type="button" className="settings-header-action" onClick={onOpenThemesDirectory}>{t("common.openDirectory", locale)}</button></label>
            <label className="settings-preference-row"><span><strong>{t("appearance.externalCssLabel", locale)}</strong><small>{themePathLoading ? t("appearance.reading", locale) : appearance.themeCssPath ? t("appearance.loadingFromPath", locale) : t("appearance.unconfigured", locale)}{themePathError ? ` · ${themePathError}` : ""}</small></span><button type="button" className="settings-header-action" onClick={onReloadThemeCss} disabled={!appearance.themeCssPath || themePathLoading}>{t("appearance.reload", locale)}</button></label>
          </div>
        </div>
      )}

      {section === "theme" && (
        <div className="appearance-preview" style={appearance.backgrounds.global.image ? { backgroundImage: `linear-gradient(rgba(20, 23, 20, .58), rgba(20, 23, 20, .58)), url(${JSON.stringify(appearance.backgrounds.global.image)})`, backgroundSize: appearance.backgrounds.global.size, backgroundPosition: appearance.backgrounds.global.position } : undefined}>
          <div className="appearance-preview-bar"><span>DSH DEEPTOP</span><span>{t("appearance.preview", locale)}</span></div>
          <div className="appearance-preview-body"><span className="appearance-preview-label">{t("appearance.messagePreview", locale)}</span><p style={{ fontFamily: appearance.fontFamily, fontSize: `${appearance.messageFontSize}px`, lineHeight: appearance.messageLineHeight }}>{t("appearance.previewCopy", locale)}</p><code style={{ fontFamily: appearance.codeFontFamily }}>const workspace = "your-project";</code></div>
        </div>
      )}

      {section === "background" && (
        <SettingsBackgroundPanel
          backgrounds={appearance.backgrounds}
          onUpdateBackground={onUpdateBackground}
          onBackgroundFile={onBackgroundFile}
          onClearBackground={onClearBackground}
          embedded
          locale={locale}
        />
      )}

      {section === "typography" && (
        <div className="settings-block">
          <div className="settings-block-heading"><div><h3>{t("appearance.typographyTitle", locale)}</h3><p>{t("appearance.typographyHint", locale)}</p></div></div>
          <div className="settings-preference-list">
            <label className="settings-preference-row"><span><strong>{t("appearance.uiFont", locale)}</strong><small>{t("appearance.uiFontHint", locale)}</small></span><select value={fontPreset} onChange={(event) => { if (event.target.value !== "custom") onUpdate({ fontFamily: event.target.value }); }}><option value="custom">{t("appearance.customFontStack", locale)}</option>{fontPresets.map((item) => <option value={item.value} key={item.value}>{t(item.labelKey, locale)}</option>)}</select></label>
            {fontPreset === "custom" && <label className="appearance-custom-field"><span>{t("appearance.customUiFontStack", locale)}</span><input value={appearance.fontFamily} onChange={(event) => onUpdate({ fontFamily: event.target.value })} placeholder={t("appearance.uiFontPlaceholder", locale)} /></label>}
            <label className="settings-preference-row"><span><strong>{t("appearance.codeFont", locale)}</strong><small>{t("appearance.codeFontHint", locale)}</small></span><select value={codeFontPreset} onChange={(event) => { if (event.target.value !== "custom") onUpdate({ codeFontFamily: event.target.value }); }}><option value="custom">{t("appearance.customFontStack", locale)}</option>{codeFontPresets.map((item) => <option value={item.value} key={item.value}>{t(item.labelKey, locale)}</option>)}</select></label>
            {codeFontPreset === "custom" && <label className="appearance-custom-field"><span>{t("appearance.customCodeFontStack", locale)}</span><input value={appearance.codeFontFamily} onChange={(event) => onUpdate({ codeFontFamily: event.target.value })} placeholder={t("appearance.codeFontPlaceholder", locale)} /></label>}
            <label className="settings-preference-row"><span><strong>{t("appearance.messageFontSize", locale)}</strong><small>{appearance.messageFontSize}px</small></span><span className="appearance-range-control"><input type="range" min="14" max="18" step="1" value={appearance.messageFontSize} onChange={(event) => onUpdate({ messageFontSize: Number(event.target.value) })} /><output>{appearance.messageFontSize}px</output></span></label>
            <label className="settings-preference-row"><span><strong>{t("appearance.messageLineHeight", locale)}</strong><small>{appearance.messageLineHeight.toFixed(2)}</small></span><span className="appearance-range-control"><input type="range" min="1.35" max="2.2" step="0.05" value={appearance.messageLineHeight} onChange={(event) => onUpdate({ messageLineHeight: Number(event.target.value) })} /><output>{appearance.messageLineHeight.toFixed(2)}</output></span></label>
          </div>
        </div>
      )}

      {section === "typography" && (
        <div className="settings-block working-indicator-settings">
          <div className="settings-block-heading"><div><h3>{t("appearance.workingTitle", locale)}</h3><p>{t("appearance.workingHint", locale)}</p></div></div>
          <div className="settings-preference-list">
            <label className="appearance-custom-field"><span>{t("appearance.workingTextLabel", locale)}</span><textarea value={appearance.workingIndicator.texts.join("\n")} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, texts: event.target.value.split(/\r?\n/) } })} placeholder={t("appearance.workingPlaceholder", locale)} rows={4} maxLength={1500} /></label>
            <label className="settings-preference-row"><span><strong>{t("appearance.workingColor", locale)}</strong><small>{appearance.workingIndicator.color}</small></span><span className="appearance-color-control"><input type="color" value={appearance.workingIndicator.color} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, color: event.target.value } })} /><code>{appearance.workingIndicator.color}</code></span></label>
            <label className="settings-preference-row"><span><strong>{t("appearance.workingEffect", locale)}</strong><small>{t("appearance.workingEffectHint", locale)}</small></span><select value={appearance.workingIndicator.effect} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, effect: event.target.value as WorkingIndicatorEffect } })}><option value="shimmer">{t("appearance.effectShimmer", locale)}</option><option value="pulse">{t("appearance.effectPulse", locale)}</option><option value="glow">{t("appearance.effectGlow", locale)}</option><option value="none">{t("appearance.effectNone", locale)}</option></select></label>
            {workingTextCount > 1 && <label className="settings-preference-row"><span><strong>{t("appearance.rotationSpeed", locale)}</strong><small>{t("appearance.rotationSpeedHint", locale, { seconds: (appearance.workingIndicator.rotationInterval / 1000).toFixed(1) })}</small></span><span className="appearance-range-control"><input type="range" min="1200" max="10000" step="100" value={appearance.workingIndicator.rotationInterval} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, rotationInterval: Number(event.target.value) } })} /><output>{(appearance.workingIndicator.rotationInterval / 1000).toFixed(1)}s</output></span></label>}
          </div>
          <div className="working-indicator-preview" style={{ "--working-indicator-color": workingIndicator.color } as CSSProperties}><span className={`effect-${workingIndicator.effect}`}>{workingIndicatorTextAt(workingIndicator, previewIndex)}</span><small>{t("appearance.previewRotation", locale, { count: workingTextCount })}</small></div>
        </div>
      )}

      {section === "css" && (
        <div className="settings-block appearance-theme-block">
          <div className="settings-block-heading"><div><h3>{t("settings.css", locale)}</h3><p>{appearance.customCss ? `${appearance.customCssName || t("appearance.importedThemeName", locale)} · ${t("appearance.cssCharCount", locale, { count: appearance.customCss.length.toLocaleString() })}` : t("appearance.cssEmptyHint", locale)}</p></div><div className="appearance-theme-actions"><input ref={themeFileInputRef} className="appearance-file-input" type="file" accept=".css,text/css" onChange={(event) => { onThemeFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button type="button" className="settings-header-action" onClick={() => themeFileInputRef.current?.click()}>{t("appearance.importCss", locale)}</button>{appearance.customCss && <button type="button" className="settings-header-action" onClick={() => onUpdate({ customCss: "", customCssName: "", customCssEnabled: false })}>{t("appearance.clear", locale)}</button>}</div></div>
          <label className="appearance-theme-toggle"><input type="checkbox" checked={appearance.customCssEnabled && Boolean(appearance.customCss)} disabled={!appearance.customCss} onChange={(event) => onUpdate({ customCssEnabled: event.target.checked })} /><span>{t("appearance.cssEnabled", locale)}</span><small>{appearance.customCssEnabled && appearance.customCss ? t("appearance.enabled", locale) : t("appearance.disabled", locale)}</small></label>
          {appearance.customCss && <textarea className="appearance-css-editor" value={appearance.customCss} onChange={(event) => onUpdate({ customCss: event.target.value })} aria-label={t("appearance.cssContentAria", locale)} spellCheck={false} />}
        </div>
      )}
    </div>
  );
}
