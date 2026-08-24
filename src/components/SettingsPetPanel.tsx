import { useCallback, useEffect, useMemo, useState } from "react";
import type { PetAnimationState, PetBundle, PetBundleDescriptor, PetCareState, PetSettings } from "../lib/desktop";
import { petAnimationDurationMs, petSpritesheetAssetSource } from "../app/pet-model";
import { PetCanvas } from "./PetCanvas";

interface SettingsPetPanelProps {
  desktop: boolean;
  settings: PetSettings;
  entries: PetBundleDescriptor[];
  selectedPet: PetBundleDescriptor | null;
  directory: string;
  warnings: string[];
  loaded: boolean;
  busy: boolean;
  previewBundle: PetBundle | null;
  previewLoading: boolean;
  previewError: string | null;
  careState: PetCareState | null;
  careError: string | null;
  onUpdate: (patch: Partial<PetSettings>) => void | Promise<void>;
  onSelect: (id: string) => void | Promise<void>;
  onImport: () => void | Promise<void>;
  onExport: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onOpenDirectory: () => void | Promise<void>;
}

interface PetSettingsPreviewProps {
  selectedPet: PetBundleDescriptor | null;
  bundle: PetBundle | null;
  loading: boolean;
  error: string | null;
  motionEnabled: boolean;
}

function PetSettingsPreview({ selectedPet, bundle, loading, error, motionEnabled }: PetSettingsPreviewProps) {
  const [animation, setAnimation] = useState<PetAnimationState>("idle");
  const [ready, setReady] = useState(false);
  const source = useMemo(() => bundle ? petSpritesheetAssetSource(bundle) : null, [bundle]);
  const handleReadyChange = useCallback((nextReady: boolean) => setReady(nextReady), []);

  useEffect(() => {
    setAnimation("idle");
    setReady(false);
  }, [selectedPet?.id, source]);

  useEffect(() => {
    if (animation === "idle") return;
    const timer = window.setTimeout(() => setAnimation("idle"), petAnimationDurationMs(animation));
    return () => window.clearTimeout(timer);
  }, [animation]);

  return (
    <div className="pet-settings-preview">
      <button
        type="button"
        className="pet-settings-preview-stage"
        disabled={!source || loading}
        onClick={() => setAnimation((current) => current === "jumping" ? "waving" : "jumping")}
        aria-label={selectedPet ? `预览并互动：${selectedPet.name}` : "尚未安装宠物"}
      >
        {source ? (
          <span className={`pet-settings-preview-visual${ready ? " asset-ready" : ""}`}>
            <PetCanvas
              state={animation}
              source={source}
              lookDirection={null}
              motionEnabled={motionEnabled}
              onReadyChange={handleReadyChange}
            />
          </span>
        ) : <span className="pet-settings-preview-status">{loading ? "正在载入…" : selectedPet ? "暂时无法预览" : "尚未安装宠物"}</span>}
      </button>
      <div className="pet-settings-preview-actions">
        <button type="button" disabled={!source || loading} onClick={() => setAnimation("waving")}>挥手</button>
        <button type="button" disabled={!source || loading} onClick={() => setAnimation("jumping")}>跳跃</button>
      </div>
      {error && <small className="pet-settings-preview-error">预览读取失败：{error}</small>}
    </div>
  );
}

export function SettingsPetPanel({
  desktop,
  settings,
  entries,
  selectedPet,
  directory,
  warnings,
  loaded,
  busy,
  previewBundle,
  previewLoading,
  previewError,
  careState,
  careError,
  onUpdate,
  onSelect,
  onImport,
  onExport,
  onRemove,
  onOpenDirectory,
}: SettingsPetPanelProps) {
  const controlsDisabled = busy || !selectedPet;
  return (
    <div className="settings-page pet-settings-page">
      <div className="settings-page-header">
        <div>
          <span className="settings-overline">DESKTOP PETS</span>
          <h2>宠物</h2>
          <p>可互动的全局桌宠。可以随时关闭，关闭后宠物窗口会立即退出。</p>
        </div>
        <label className="pet-master-switch">
          <span>{settings.enabled ? "已启用" : "已关闭"}</span>
          <span className="settings-plugin-toggle" aria-label="启用桌面宠物">
            <input type="checkbox" checked={settings.enabled} disabled={!loaded || busy || !selectedPet} onChange={(event) => void onUpdate({ enabled: event.target.checked })} />
            <span aria-hidden="true" />
          </span>
        </label>
      </div>

      {!loaded ? <p className="settings-empty">正在读取宠物设置…</p> : (
        <>
          <section className="settings-block pet-current-card">
            <div className="pet-current-showcase">
              <PetSettingsPreview
                selectedPet={selectedPet}
                bundle={previewBundle}
                loading={previewLoading}
                error={previewError}
                motionEnabled={settings.motionEnabled}
              />
              <div className="pet-current-details">
                <div className="settings-block-heading">
                  <div><h3>{selectedPet?.name ?? "尚未安装宠物"}</h3><p>{selectedPet?.description || "安装一个 Deeptop Pet 后即可预览和启用。"}</p></div>
                  {selectedPet && <span className="pet-source-badge">已安装</span>}
                </div>
                <p className="pet-current-hint">{selectedPet ? "点击左侧宠物可以预览动作。" : "可以从宠物库安装别人分享的宠物包。"}</p>
                {selectedPet && settings.careEnabled && careState && (
                  <div className="pet-care-summary" aria-label="宠物养成状态">
                    <span><small>饱食</small><strong>{Math.round(careState.satiety)}</strong></span>
                    <span><small>心情</small><strong>{Math.round(careState.mood)}</strong></span>
                    <span><small>亲密</small><strong>{Math.round(careState.affection)}</strong></span>
                  </div>
                )}
                {careError && <small className="pet-settings-preview-error">养成状态读取失败：{careError}</small>}
              </div>
            </div>
          </section>

          <section className="settings-block">
            <div className="settings-block-heading"><div><h3>显示</h3><p>只控制宠物自己的位置与动作，不改变对话布局。</p></div></div>
            <div className="settings-preference-list">
              <label className="settings-preference-row"><span><strong>当前宠物</strong><small>{entries.length} 个可用宠物</small></span><select value={selectedPet?.id ?? ""} disabled={busy || entries.length === 0} onChange={(event) => void onSelect(event.target.value)}>{entries.length === 0 && <option value="">尚未安装宠物</option>}{entries.map((pet) => <option value={pet.id} key={pet.id}>{pet.name}</option>)}</select></label>
              <label className="settings-preference-row"><span><strong>初始位置</strong><small>启用时停靠在主显示器工作区的一侧，之后可拖到任意显示器</small></span><select value={settings.anchor} disabled={controlsDisabled} onChange={(event) => void onUpdate({ anchor: event.target.value === "bottom-left" ? "bottom-left" : "bottom-right" })}><option value="bottom-right">桌面右下角</option><option value="bottom-left">桌面左下角</option></select></label>
              <label className="settings-preference-row"><span><strong>显示大小</strong><small>选择宠物在桌面上的大小</small></span><select value={settings.size} disabled={controlsDisabled} onChange={(event) => void onUpdate({ size: Number(event.target.value) })}><option value="64">小 · 64 px</option><option value="88">中 · 88 px</option><option value="112">大 · 112 px</option><option value="144">特大 · 144 px</option></select></label>
              <div className="settings-preference-row"><span><strong>置顶显示</strong><small>宠物窗口始终悬浮在其他窗口之上，适合边工作边看</small></span><label className="settings-plugin-toggle" aria-label="宠物窗口置顶显示"><input type="checkbox" checked={settings.alwaysOnTop} disabled={controlsDisabled} onChange={(event) => void onUpdate({ alwaysOnTop: event.target.checked })} /><span aria-hidden="true" /></label></div>
              <div className="settings-preference-row"><span><strong>宠物动作</strong><small>播放待机、互动和任务状态动画</small></span><label className="settings-plugin-toggle" aria-label="启用宠物动作"><input type="checkbox" checked={settings.motionEnabled} disabled={controlsDisabled} onChange={(event) => void onUpdate({ motionEnabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
              <div className="settings-preference-row"><span><strong>允许互动</strong><small>可以点击、拖动宠物并操作任务提醒；关闭后鼠标会穿过宠物窗口</small></span><label className="settings-plugin-toggle" aria-label="允许宠物互动"><input type="checkbox" checked={settings.interactionsEnabled} disabled={controlsDisabled} onChange={(event) => void onUpdate({ interactionsEnabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
              <div className="settings-preference-row"><span><strong>养成互动</strong><small>保存饱食、心情和亲密度；关闭后状态暂停，任务提醒不受影响</small></span><label className="settings-plugin-toggle" aria-label="启用宠物养成互动"><input type="checkbox" checked={settings.careEnabled} disabled={controlsDisabled} onChange={(event) => void onUpdate({ careEnabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
            </div>
          </section>

          <section className="settings-block">
            <div className="settings-block-heading"><div><h3>宠物库</h3><p>安装别人分享的 `.deeptop-pet` 文件，或把当前宠物分享给朋友。</p></div><div className="pet-library-actions"><button type="button" className="settings-header-action" disabled={!desktop || busy} onClick={() => void onImport()}>安装宠物包</button>{selectedPet && <button type="button" className="settings-header-action" disabled={!desktop || busy} onClick={() => void onExport()}>分享当前宠物</button>}{selectedPet && <button type="button" className="settings-header-action danger-button" disabled={!desktop || busy} onClick={() => void onRemove()}>删除</button>}</div></div>
            <details className="pet-library-more">
              <summary>管理与制作</summary>
              <div className="pet-library-more-content">
                <div className="pet-library-directory"><span>本地目录</span><code>{directory || "仅桌面端可用"}</code><button type="button" className="settings-header-action" disabled={!desktop} onClick={() => void onOpenDirectory()}>打开目录</button></div>
                <div className="pet-creator-guide">
                  <strong>制作自己的宠物</strong>
                  <p>准备 Deeptop Pet 动画图集和宠物信息，然后在项目目录运行：</p>
                  <code>npm run pet:pack -- &lt;宠物目录&gt;</code>
                  <small>生成的单文件可以直接分享；宠物市场也会使用同一种文件。</small>
                </div>
              </div>
            </details>
            {warnings.length > 0 && <div className="pet-library-warnings" role="status"><strong>有 {warnings.length} 个宠物包未加载</strong>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
            <p className="pet-library-footnote">宠物包只包含图片和动作配置，不会运行第三方代码。关闭页面顶部的开关即可完整停用。</p>
          </section>
        </>
      )}
    </div>
  );
}
