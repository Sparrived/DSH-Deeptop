import { useRef } from "react";
import type { AppearanceSettings } from "../app/model";
import type { AppTheme, ThemeMode } from "../app/model";

type FontPreset = { value: string; label: string };

type SettingsAppearancePanelProps = {
  appearance: AppearanceSettings;
  themeMode: ThemeMode;
  appTheme: AppTheme;
  themesDir: string | null;
  themePathError: string;
  themePathLoading: boolean;
  fontPreset: string;
  codeFontPreset: string;
  fontPresets: FontPreset[];
  codeFontPresets: FontPreset[];
  onUpdate: (patch: Partial<AppearanceSettings>) => void;
  onThemeChange: (mode: ThemeMode) => void;
  onAppThemeChange: (theme: AppTheme) => void;
  onPickThemeCss: () => void;
  onReloadThemeCss: () => void;
  onOpenThemesDirectory: () => void;
  onOpenBackgrounds: () => void;
  onThemeFile: (file: File | undefined) => void;
  onReset: () => void;
};

export function SettingsAppearancePanel({
  appearance,
  themeMode,
  appTheme,
  themesDir,
  themePathError,
  themePathLoading,
  fontPreset,
  codeFontPreset,
  fontPresets,
  codeFontPresets,
  onUpdate,
  onThemeChange,
  onAppThemeChange,
  onPickThemeCss,
  onReloadThemeCss,
  onOpenThemesDirectory,
  onOpenBackgrounds,
  onThemeFile,
  onReset,
}: SettingsAppearancePanelProps) {
  const themeFileInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundCount = Object.values(appearance.backgrounds).filter((bg) => Boolean(bg.image)).length;

  return (
    <div className="settings-page appearance-settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">APPEARANCE</span><h2>外观</h2><p>调整 Deeptop 的阅读界面。</p></div>
        <button type="button" className="settings-header-action" onClick={onReset}>恢复默认</button>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>界面</h3><p>选择应用的明暗主题与深色配色。</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>明暗</strong><small>默认跟随系统颜色</small></span><select value={themeMode} onChange={(event) => onThemeChange(event.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
          <label className="settings-preference-row"><span><strong>主题</strong><small>外部 CSS 主题，同时作用于浅色与深色模式</small></span><select value={appTheme} onChange={(event) => onAppThemeChange(event.target.value as AppTheme)}><option value="monokai-pro">Monokai Pro</option><option value="one-dark">One Dark</option><option value="custom">自定义路径…</option></select></label>
          {appTheme === "custom" && (
            <label className="settings-preference-row appearance-path-row"><span><strong>主题 CSS 路径</strong><small>指向本地 .css 文件的绝对路径</small></span><span className="appearance-theme-path-control"><input value={appearance.themeCssPath} onChange={(event) => onUpdate({ themeCssPath: event.target.value })} placeholder="C:\path\to\my-theme.css" spellCheck={false} /><button type="button" className="settings-header-action" onClick={onPickThemeCss}>浏览</button></span></label>
          )}
          <label className="settings-preference-row"><span><strong>主题文件目录</strong><small>{themesDir || "仅桌面端可用"}</small></span><button type="button" className="settings-header-action" onClick={onOpenThemesDirectory}>打开目录</button></label>
          <label className="settings-preference-row"><span><strong>外部 CSS 主题</strong><small>{themePathLoading ? "正在读取…" : appearance.themeCssPath ? "按当前路径加载" : "未配置"}{themePathError ? ` · ${themePathError}` : ""}</small></span><button type="button" className="settings-header-action" onClick={onReloadThemeCss} disabled={!appearance.themeCssPath || themePathLoading}>重新加载</button></label>
        </div>
      </div>

      <div
        className={`appearance-preview${appearance.backgrounds.global.image ? " has-preview-background" : ""}`}
        style={appearance.backgrounds.global.image ? { backgroundImage: `linear-gradient(rgba(20, 23, 20, .58), rgba(20, 23, 20, .58)), url(${JSON.stringify(appearance.backgrounds.global.image)})`, backgroundSize: appearance.backgrounds.global.size, backgroundPosition: appearance.backgrounds.global.position } : undefined}
      >
        <div className="appearance-preview-bar"><span>DSH DEEPTOP</span><span>预览</span></div>
        <div className="appearance-preview-body">
          <span className="appearance-preview-label">消息预览</span>
          <p style={{ fontFamily: appearance.fontFamily, fontSize: `${appearance.messageFontSize}px`, lineHeight: appearance.messageLineHeight }}>把常用的阅读节奏和工作氛围留给自己。</p>
          <code style={{ fontFamily: appearance.codeFontFamily }}>const workspace = "your-project";</code>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>文字</h3><p>界面文字和消息正文的显示方式。</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>界面字体</strong><small>标题、按钮和消息文字</small></span><select value={fontPreset} onChange={(event) => { if (event.target.value !== "custom") onUpdate({ fontFamily: event.target.value }); }}><option value="custom">自定义字体栈</option>{fontPresets.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          {fontPreset === "custom" && <label className="appearance-custom-field"><span>自定义界面字体栈</span><input value={appearance.fontFamily} onChange={(event) => onUpdate({ fontFamily: event.target.value })} placeholder='例如 "霞鹜文楷", sans-serif' /></label>}
          <label className="settings-preference-row"><span><strong>代码字体</strong><small>代码块和技术信息</small></span><select value={codeFontPreset} onChange={(event) => { if (event.target.value !== "custom") onUpdate({ codeFontFamily: event.target.value }); }}><option value="custom">自定义字体栈</option>{codeFontPresets.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          {codeFontPreset === "custom" && <label className="appearance-custom-field"><span>自定义代码字体栈</span><input value={appearance.codeFontFamily} onChange={(event) => onUpdate({ codeFontFamily: event.target.value })} placeholder='例如 "Fira Code", monospace' /></label>}
          <label className="settings-preference-row"><span><strong>消息字号</strong><small>{appearance.messageFontSize}px</small></span><span className="appearance-range-control"><input type="range" min="14" max="18" step="1" value={appearance.messageFontSize} onChange={(event) => onUpdate({ messageFontSize: Number(event.target.value) })} /><output>{appearance.messageFontSize}px</output></span></label>
          <label className="settings-preference-row"><span><strong>消息行距</strong><small>{appearance.messageLineHeight.toFixed(2)}</small></span><span className="appearance-range-control"><input type="range" min="1.35" max="2.2" step="0.05" value={appearance.messageLineHeight} onChange={(event) => onUpdate({ messageLineHeight: Number(event.target.value) })} /><output>{appearance.messageLineHeight.toFixed(2)}</output></span></label>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div><h3>背景工作台</h3><p>{backgroundCount > 0 ? `已为 ${backgroundCount} 个区域设置背景图` : "尚未设置背景图"}</p></div>
          <button type="button" className="settings-header-action" onClick={onOpenBackgrounds}>打开背景工作台</button>
        </div>
        <p className="background-quick-note">在背景工作台中，可以为全局、标题栏、侧栏、对话栏、对话框与工具面板分别设置背景图与透明度、模糊等细节。</p>
      </div>

      <div className="settings-block appearance-theme-block">
        <div className="settings-block-heading">
          <div><h3>CSS 主题</h3><p>{appearance.customCss ? `${appearance.customCssName || "自定义主题"} · ${appearance.customCss.length.toLocaleString()} 字符` : "尚未导入"}</p></div>
          <div className="appearance-theme-actions">
            <input ref={themeFileInputRef} className="appearance-file-input" type="file" accept=".css,text/css" onChange={(event) => { onThemeFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <button type="button" className="settings-header-action" onClick={() => themeFileInputRef.current?.click()}>导入 CSS</button>
            {appearance.customCss && <button type="button" className="settings-header-action" onClick={() => onUpdate({ customCss: "", customCssName: "", customCssEnabled: false })}>清空</button>}
          </div>
        </div>
        <label className="appearance-theme-toggle"><input type="checkbox" checked={appearance.customCssEnabled && Boolean(appearance.customCss)} disabled={!appearance.customCss} onChange={(event) => onUpdate({ customCssEnabled: event.target.checked })} /><span>启用 CSS 主题</span><small>{appearance.customCssEnabled && appearance.customCss ? "已启用" : "已停用"}</small></label>
        {appearance.customCss && <textarea className="appearance-css-editor" value={appearance.customCss} onChange={(event) => onUpdate({ customCss: event.target.value })} aria-label="CSS 主题内容" spellCheck={false} />}
      </div>
    </div>
  );
}
