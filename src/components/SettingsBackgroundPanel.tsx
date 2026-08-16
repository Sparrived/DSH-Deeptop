import { useRef, useState } from "react";
import type { BackgroundConfig, BackgroundSettings, BackgroundZone } from "../app/model";
import { backgroundZoneLabels, backgroundZones } from "../app/useAppearanceSettings";

type SettingsBackgroundPanelProps = {
  backgrounds: BackgroundSettings;
  onUpdateBackground: (zone: BackgroundZone, patch: Partial<BackgroundConfig>) => void;
  onBackgroundFile: (zone: BackgroundZone, file: File | undefined) => void;
  onClearBackground: (zone: BackgroundZone) => void;
};

const backgroundPositions: BackgroundConfig["position"][] = ["center", "top", "bottom", "left", "right"];
const positionLabels: Record<BackgroundConfig["position"], string> = {
  center: "居中",
  top: "顶部",
  bottom: "底部",
  left: "左侧",
  right: "右侧",
};

export function SettingsBackgroundPanel({
  backgrounds,
  onUpdateBackground,
  onBackgroundFile,
  onClearBackground,
}: SettingsBackgroundPanelProps) {
  const [zone, setZone] = useState<BackgroundZone>("global");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const config = backgrounds[zone];
  const hasImage = Boolean(config.image);

  const schematicClass = (item: BackgroundZone, extra = "") =>
    `${extra}${zone === item ? " selected" : ""}${backgrounds[item].image ? " has-image" : ""}`.trim();

  return (
    <div className="settings-page background-settings-page">
      <div className="settings-page-header">
        <div><span className="settings-overline">BACKGROUND WORKBENCH</span><h2>背景工作台</h2><p>为不同的界面区域单独设置背景图，互不干扰。</p></div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading"><div><h3>区域</h3><p>点击下方分区或示意图中的区域进行编辑。</p></div></div>
        <div className="background-zone-tabs">
          {backgroundZones.map((item) => (
            <button
              key={item}
              type="button"
              className={`background-zone-tab${zone === item ? " selected" : ""}${backgrounds[item].image ? " has-image" : ""}`}
              onClick={() => setZone(item)}
            >
              <strong>{backgroundZoneLabels[item].label}</strong>
              <small>{backgroundZoneLabels[item].hint}</small>
            </button>
          ))}
        </div>

        <div className="background-schematic" role="group" aria-label="界面区域示意图">
          <button type="button" className={schematicClass("windowbar", "bg-schematic-windowbar")} onClick={() => setZone("windowbar")}>
            <span>标题栏</span>
          </button>
          <button type="button" className={schematicClass("sidebar", "bg-schematic-sidebar")} onClick={() => setZone("sidebar")}>
            <span>侧栏</span>
          </button>
          <div className="bg-schematic-main">
            <button type="button" className={schematicClass("conversation", "bg-schematic-header")} onClick={() => setZone("conversation")}>
              <span>对话标题</span>
            </button>
            <button type="button" className={schematicClass("conversation", "bg-schematic-transcript")} onClick={() => setZone("conversation")}>
              <span>消息对话</span>
            </button>
            <button type="button" className={schematicClass("composer", "bg-schematic-composer")} onClick={() => setZone("composer")}>
              <span>输入框</span>
            </button>
          </div>
          <button type="button" className={schematicClass("dock", "bg-schematic-dock")} onClick={() => setZone("dock")}>
            <span>工具面板</span>
          </button>
          <button type="button" className={schematicClass("global", "bg-schematic-global")} onClick={() => setZone("global")}>
            <span>全局背景</span>
          </button>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <div><h3>{backgroundZoneLabels[zone].label}</h3><p>{backgroundZoneLabels[zone].hint}{config.name ? ` · ${config.name}` : ""}</p></div>
          <div className="appearance-theme-actions">
            <input
              ref={fileInputRef}
              className="appearance-file-input"
              type="file"
              accept="image/*"
              onChange={(event) => { onBackgroundFile(zone, event.target.files?.[0]); event.currentTarget.value = ""; }}
            />
            <button type="button" className="settings-header-action" onClick={() => fileInputRef.current?.click()}>导入图片</button>
            {hasImage && <button type="button" className="settings-header-action" onClick={() => onClearBackground(zone)}>清除</button>}
          </div>
        </div>

        <div className="appearance-background-source">
          <label><span>图片地址</span><input type="url" value={config.image.startsWith("data:") ? "" : config.image} placeholder="https://example.com/background.jpg" onChange={(event) => onUpdateBackground(zone, { image: event.target.value.trim(), name: "" })} /></label>
          {hasImage && (
            <span
              className="background-source-preview"
              style={config.image ? { backgroundImage: `url(${JSON.stringify(config.image)})` } : undefined}
              aria-label="背景图预览"
            />
          )}
        </div>

        <div className="appearance-background-grid">
          <label><span>透明度</span><input type="range" min="0.05" max="0.45" step="0.01" value={config.opacity} onChange={(event) => onUpdateBackground(zone, { opacity: Number(event.target.value) })} /><output>{Math.round(config.opacity * 100)}%</output></label>
          <label><span>背景模糊</span><input type="range" min="0" max="16" step="1" value={config.blur} onChange={(event) => onUpdateBackground(zone, { blur: Number(event.target.value) })} /><output>{config.blur}px</output></label>
          <label><span>填充方式</span><select value={config.size} onChange={(event) => onUpdateBackground(zone, { size: event.target.value as BackgroundConfig["size"] })}><option value="cover">填满区域</option><option value="contain">完整显示</option></select></label>
          <label><span>对齐位置</span><select value={config.position} onChange={(event) => onUpdateBackground(zone, { position: event.target.value as BackgroundConfig["position"] })}>{backgroundPositions.map((item) => <option value={item} key={item}>{positionLabels[item]}</option>)}</select></label>
        </div>

        <p className="background-zone-note">
          {backgroundZones.filter((item) => backgrounds[item].image).length > 0
            ? `已配置 ${backgroundZones.filter((item) => backgrounds[item].image).length} 个区域。`
            : "尚未配置任何背景图。"}
          导入的图片以 data URL 保存，建议使用 3 MB 以内的图片。
        </p>
      </div>
    </div>
  );
}
