import { useRef, type RefObject } from "react";
import type { AppearanceSettings } from "../app/model";
import type { ThemeMode } from "../app/model";

type FontPreset = { value: string; label: string };

type SettingsAppearancePanelProps = {
  appearance: AppearanceSettings;
  themeMode: ThemeMode;
  fontPreset: string;
  codeFontPreset: string;
  fontPresets: FontPreset[];
  codeFontPresets: FontPreset[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onUpdate: (patch: Partial<AppearanceSettings>) => void;
  onThemeChange: (mode: ThemeMode) => void;
  onBackgroundFile: (file: File | undefined) => void;
  onThemeFile: (file: File | undefined) => void;
  onReset: () => void;
};

export function SettingsAppearancePanel({
  appearance,
  themeMode,
  fontPreset,
  codeFontPreset,
  fontPresets,
  codeFontPresets,
  fileInputRef,
  onUpdate,
  onThemeChange,
  onBackgroundFile,
  onThemeFile,
  onReset,
}: SettingsAppearancePanelProps) {
  const themeFileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="settings-page appearance-settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">APPEARANCE</span><h2>外观</h2><p>调整 Deeptop 的阅读界面。</p></div>
        <button type="button" className="settings-header-action" onClick={onReset}>恢复默认</button>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>界面</h3><p>选择应用的明暗主题。</p></div></div>
        <div className="settings-preference-list">
          <label className="settings-preference-row"><span><strong>主题</strong><small>默认跟随系统颜色</small></span><select value={themeMode} onChange={(event) => onThemeChange(event.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
        </div>
      </div>

      <div
        className={`appearance-preview${appearance.backgroundImage ? " has-preview-background" : ""}`}
        style={appearance.backgroundImage ? { backgroundImage: `linear-gradient(rgba(20, 23, 20, .58), rgba(20, 23, 20, .58)), url(${JSON.stringify(appearance.backgroundImage)})`, backgroundSize: appearance.backgroundSize, backgroundPosition: appearance.backgroundPosition } : undefined}
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
        <div className="settings-block-heading"><div><h3>背景图</h3><p>{appearance.backgroundImage ? (appearance.backgroundName || "已设置图片地址") : "尚未设置"}</p></div><input ref={fileInputRef} className="appearance-file-input" type="file" accept="image/*" onChange={(event) => { onBackgroundFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><button className="settings-header-action" onClick={() => fileInputRef.current?.click()}>导入图片</button></div>
        <div className="appearance-background-source">
          <label><span>图片地址</span><input type="url" value={appearance.backgroundImage.startsWith("data:") ? "" : appearance.backgroundImage} placeholder="https://example.com/background.jpg" onChange={(event) => onUpdate({ backgroundImage: event.target.value.trim(), backgroundName: "" })} /></label>
          {appearance.backgroundImage && <button type="button" onClick={() => onUpdate({ backgroundImage: "", backgroundName: "" })}>清除</button>}
        </div>
        <div className="appearance-background-grid">
          <label><span>透明度</span><input type="range" min="0.05" max="0.45" step="0.01" value={appearance.backgroundOpacity} onChange={(event) => onUpdate({ backgroundOpacity: Number(event.target.value) })} /><output>{Math.round(appearance.backgroundOpacity * 100)}%</output></label>
          <label><span>背景模糊</span><input type="range" min="0" max="16" step="1" value={appearance.backgroundBlur} onChange={(event) => onUpdate({ backgroundBlur: Number(event.target.value) })} /><output>{appearance.backgroundBlur}px</output></label>
          <label><span>填充方式</span><select value={appearance.backgroundSize} onChange={(event) => onUpdate({ backgroundSize: event.target.value as AppearanceSettings["backgroundSize"] })}><option value="cover">填满窗口</option><option value="contain">完整显示</option></select></label>
          <label><span>对齐位置</span><select value={appearance.backgroundPosition} onChange={(event) => onUpdate({ backgroundPosition: event.target.value as AppearanceSettings["backgroundPosition"] })}><option value="center">居中</option><option value="top">顶部</option><option value="bottom">底部</option><option value="left">左侧</option><option value="right">右侧</option></select></label>
        </div>
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
