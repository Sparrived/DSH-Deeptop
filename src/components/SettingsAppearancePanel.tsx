import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import type { AppearanceSettings, AppearanceSection, WorkingIndicatorEffect } from "../app/model";
import type { AppTheme, ThemeMode } from "../app/model";
import { SettingsBackgroundPanel } from "./SettingsBackgroundPanel";
import { normalizeWorkingIndicator, workingIndicatorTextAt } from "../app/working-indicator";

type FontPreset = { value: string; label: string };

type SettingsAppearancePanelProps = {
  appearance: AppearanceSettings;
  section: AppearanceSection;
  themeMode: ThemeMode;
  appTheme: AppTheme;
  themesDir: string | null;
  themePathError: string;
  themePathLoading: boolean;
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
  onThemeFile: (file: File | undefined) => void;
  onImport: (file: File | undefined) => void;
  onExport: () => void;
  onResetSection: () => void;
};

type SettingsBackgroundPanelProps = ComponentProps<typeof SettingsBackgroundPanel>;

const subpages: Array<{ id: AppearanceSection; label: string; hint: string }> = [
  { id: "theme", label: "主题", hint: "明暗模式与配色方案" },
  { id: "background", label: "背景工作台", hint: "为界面区域设置背景" },
  { id: "typography", label: "文字", hint: "字体、字号与阅读节奏" },
  { id: "css", label: "CSS 主题", hint: "导入并编辑自定义样式" },
];

function SectionHeader({ section, onResetSection }: { section: AppearanceSection; onResetSection: () => void }) {
  const current = subpages.find((item) => item.id === section) ?? subpages[0];
  return (
    <div className="settings-page-header">
      <div>
        <span className="settings-overline">APPEARANCE / {current.label.toUpperCase()}</span>
        <h2>{current.label}</h2>
        <p>{current.hint}。每个子页面都可以单独导入或导出配置。</p>
      </div>
      <button type="button" className="settings-header-action" onClick={onResetSection}>恢复本页默认</button>
    </div>
  );
}

export function SettingsAppearancePanel({
  appearance,
  section,
  themeMode,
  appTheme,
  themesDir,
  themePathError,
  themePathLoading,
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
  onThemeFile,
  onImport,
  onExport,
  onResetSection,
}: SettingsAppearancePanelProps) {
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
      <SectionHeader section={section} onResetSection={onResetSection} />

      <div className="appearance-subpage-grid" role="tablist" aria-label="外观子页面">
        {subpages.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            className={`appearance-subpage-card${section === item.id ? " selected" : ""}`}
            onClick={() => onSectionChange(item.id)}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
            {item.id === "background" && <em>{backgroundCount ? `${backgroundCount} 个区域已配置` : "尚未配置"}</em>}
            {item.id === "css" && <em>{appearance.customCss ? (appearance.customCssName || "已导入") : "尚未导入"}</em>}
          </button>
        ))}
      </div>

      <div className="appearance-import-export">
        <span>当前子页面：{subpages.find((item) => item.id === section)?.label}</span>
        <input
          ref={importFileInputRef}
          className="appearance-file-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => { onImport(event.target.files?.[0]); event.currentTarget.value = ""; }}
        />
        <button type="button" className="settings-header-action" onClick={() => importFileInputRef.current?.click()}>导入配置</button>
        <button type="button" className="settings-header-action export" onClick={onExport}>导出配置</button>
      </div>

      {section === "theme" && (
        <div className="settings-block">
          <div className="settings-block-heading"><div><h3>界面主题</h3><p>选择应用的明暗主题与深色配色。</p></div></div>
          <div className="settings-preference-list">
            <label className="settings-preference-row"><span><strong>明暗</strong><small>默认跟随系统颜色</small></span><select value={themeMode} onChange={(event) => onThemeChange(event.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
            <label className="settings-preference-row"><span><strong>主题</strong><small>外部 CSS 主题，同时作用于浅色与深色模式</small></span><select value={appTheme} onChange={(event) => onAppThemeChange(event.target.value as AppTheme)}><option value="monokai-pro">Monokai Pro</option><option value="one-dark">One Dark</option><option value="custom">自定义路径…</option></select></label>
            {appTheme === "custom" && (
              <label className="settings-preference-row appearance-path-row"><span><strong>主题 CSS 路径</strong><small>指向本地 .css 文件的绝对路径</small></span><span className="appearance-theme-path-control"><input value={appearance.themeCssPath} onChange={(event) => onUpdate({ themeCssPath: event.target.value })} placeholder="C:\\path\\to\\my-theme.css" spellCheck={false} /><button type="button" className="settings-header-action" onClick={onPickThemeCss}>浏览</button></span></label>
            )}
            <label className="settings-preference-row"><span><strong>主题文件目录</strong><small>{themesDir || "仅桌面端可用"}</small></span><button type="button" className="settings-header-action" onClick={onOpenThemesDirectory}>打开目录</button></label>
            <label className="settings-preference-row"><span><strong>外部 CSS 主题</strong><small>{themePathLoading ? "正在读取…" : appearance.themeCssPath ? "按当前路径加载" : "未配置"}{themePathError ? ` · ${themePathError}` : ""}</small></span><button type="button" className="settings-header-action" onClick={onReloadThemeCss} disabled={!appearance.themeCssPath || themePathLoading}>重新加载</button></label>
          </div>
        </div>
      )}

      {section === "theme" && (
        <div className="appearance-preview" style={appearance.backgrounds.global.image ? { backgroundImage: `linear-gradient(rgba(20, 23, 20, .58), rgba(20, 23, 20, .58)), url(${JSON.stringify(appearance.backgrounds.global.image)})`, backgroundSize: appearance.backgrounds.global.size, backgroundPosition: appearance.backgrounds.global.position } : undefined}>
          <div className="appearance-preview-bar"><span>DSH DEEPTOP</span><span>预览</span></div>
          <div className="appearance-preview-body"><span className="appearance-preview-label">消息预览</span><p style={{ fontFamily: appearance.fontFamily, fontSize: `${appearance.messageFontSize}px`, lineHeight: appearance.messageLineHeight }}>把常用的阅读节奏和工作氛围留给自己。</p><code style={{ fontFamily: appearance.codeFontFamily }}>const workspace = "your-project";</code></div>
        </div>
      )}

      {section === "background" && (
        <SettingsBackgroundPanel
          backgrounds={appearance.backgrounds}
          onUpdateBackground={onUpdateBackground}
          onBackgroundFile={onBackgroundFile}
          onClearBackground={onClearBackground}
          embedded
        />
      )}

      {section === "typography" && (
        <div className="settings-block">
          <div className="settings-block-heading"><div><h3>阅读文字</h3><p>界面文字和消息正文的显示方式。</p></div></div>
          <div className="settings-preference-list">
            <label className="settings-preference-row"><span><strong>界面字体</strong><small>标题、按钮和消息文字</small></span><select value={fontPreset} onChange={(event) => { if (event.target.value !== "custom") onUpdate({ fontFamily: event.target.value }); }}><option value="custom">自定义字体栈</option>{fontPresets.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            {fontPreset === "custom" && <label className="appearance-custom-field"><span>自定义界面字体栈</span><input value={appearance.fontFamily} onChange={(event) => onUpdate({ fontFamily: event.target.value })} placeholder='例如 "霞鹜文楷", sans-serif' /></label>}
            <label className="settings-preference-row"><span><strong>代码字体</strong><small>代码块和技术信息</small></span><select value={codeFontPreset} onChange={(event) => { if (event.target.value !== "custom") onUpdate({ codeFontFamily: event.target.value }); }}><option value="custom">自定义字体栈</option>{codeFontPresets.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
            {codeFontPreset === "custom" && <label className="appearance-custom-field"><span>自定义代码字体栈</span><input value={appearance.codeFontFamily} onChange={(event) => onUpdate({ codeFontFamily: event.target.value })} placeholder='例如 "Fira Code", monospace' /></label>}
            <label className="settings-preference-row"><span><strong>消息字号</strong><small>{appearance.messageFontSize}px</small></span><span className="appearance-range-control"><input type="range" min="14" max="18" step="1" value={appearance.messageFontSize} onChange={(event) => onUpdate({ messageFontSize: Number(event.target.value) })} /><output>{appearance.messageFontSize}px</output></span></label>
            <label className="settings-preference-row"><span><strong>消息行距</strong><small>{appearance.messageLineHeight.toFixed(2)}</small></span><span className="appearance-range-control"><input type="range" min="1.35" max="2.2" step="0.05" value={appearance.messageLineHeight} onChange={(event) => onUpdate({ messageLineHeight: Number(event.target.value) })} /><output>{appearance.messageLineHeight.toFixed(2)}</output></span></label>
          </div>
        </div>
      )}

      {section === "typography" && (
        <div className="settings-block working-indicator-settings">
          <div className="settings-block-heading"><div><h3>运行中提示</h3><p>模型工作时显示的提示语。每行一条，运行期间会按顺序轮换。</p></div></div>
          <div className="settings-preference-list">
            <label className="appearance-custom-field"><span>提示文本（支持多文本轮换）</span><textarea value={appearance.workingIndicator.texts.join("\n")} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, texts: event.target.value.split(/\r?\n/) } })} placeholder="Deep diving...\n整理上下文…\n正在执行工具" rows={4} maxLength={1500} /></label>
            <label className="settings-preference-row"><span><strong>文本颜色</strong><small>{appearance.workingIndicator.color}</small></span><span className="appearance-color-control"><input type="color" value={appearance.workingIndicator.color} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, color: event.target.value } })} /><code>{appearance.workingIndicator.color}</code></span></label>
            <label className="settings-preference-row"><span><strong>文字特效</strong><small>仅作用于运行中提示，不改变消息正文</small></span><select value={appearance.workingIndicator.effect} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, effect: event.target.value as WorkingIndicatorEffect } })}><option value="shimmer">流光</option><option value="pulse">呼吸</option><option value="glow">发光</option><option value="none">静态</option></select></label>
            {workingTextCount > 1 && <label className="settings-preference-row"><span><strong>轮换速度</strong><small>{(appearance.workingIndicator.rotationInterval / 1000).toFixed(1)} 秒切换一次</small></span><span className="appearance-range-control"><input type="range" min="1200" max="10000" step="100" value={appearance.workingIndicator.rotationInterval} onChange={(event) => onUpdate({ workingIndicator: { ...appearance.workingIndicator, rotationInterval: Number(event.target.value) } })} /><output>{(appearance.workingIndicator.rotationInterval / 1000).toFixed(1)}s</output></span></label>}
          </div>
          <div className="working-indicator-preview" style={{ "--working-indicator-color": workingIndicator.color } as CSSProperties}><span className={`effect-${workingIndicator.effect}`}>{workingIndicatorTextAt(workingIndicator, previewIndex)}</span><small>预览 · 运行时轮换 {workingTextCount} 条</small></div>
        </div>
      )}

      {section === "css" && (
        <div className="settings-block appearance-theme-block">
          <div className="settings-block-heading"><div><h3>CSS 主题</h3><p>{appearance.customCss ? `${appearance.customCssName || "自定义主题"} · ${appearance.customCss.length.toLocaleString()} 字符` : "导入一份 CSS 文件，快速应用界面样式。"}</p></div><div className="appearance-theme-actions"><input ref={themeFileInputRef} className="appearance-file-input" type="file" accept=".css,text/css" onChange={(event) => { onThemeFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button type="button" className="settings-header-action" onClick={() => themeFileInputRef.current?.click()}>导入 CSS</button>{appearance.customCss && <button type="button" className="settings-header-action" onClick={() => onUpdate({ customCss: "", customCssName: "", customCssEnabled: false })}>清空</button>}</div></div>
          <label className="appearance-theme-toggle"><input type="checkbox" checked={appearance.customCssEnabled && Boolean(appearance.customCss)} disabled={!appearance.customCss} onChange={(event) => onUpdate({ customCssEnabled: event.target.checked })} /><span>启用 CSS 主题</span><small>{appearance.customCssEnabled && appearance.customCss ? "已启用" : "已停用"}</small></label>
          {appearance.customCss && <textarea className="appearance-css-editor" value={appearance.customCss} onChange={(event) => onUpdate({ customCss: event.target.value })} aria-label="CSS 主题内容" spellCheck={false} />}
        </div>
      )}
    </div>
  );
}
