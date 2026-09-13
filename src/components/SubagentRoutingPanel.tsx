import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { DshProvider, DshSettingsDescription } from "../lib/desktop";
import type { DshHostModelCatalog } from "../app/model-types";
import { providerModels, sameJson } from "../app/settings-model";
import {
  SUBAGENT_MODEL_SELECTION_NS,
  SUBAGENT_ROUTING_NS,
  duplicateRoutingKey,
  type SubagentRoutingRow,
  type SubagentRoutingSave,
} from "../app/subagent-routing-model";
import { t, type UiLocale } from "../app/i18n";

/**
 * 子代理模型路由设置卡片（设置 → 模型）。
 *
 * 只负责编辑草稿并交给上层保存：白名单由官方 `subagent-model-selection` 强制，
 * 「何时使用」由 Deeptop 的路由命名空间承载；两层命名空间的读写与刷新都在
 * App 里完成，本组件不直接调用 Bridge。
 */

type SubagentRoutingPanelProps = {
  current: SubagentRoutingSave;
  providers: DshProvider[];
  settings: DshSettingsDescription | null;
  hostModels: DshHostModelCatalog | null;
  saving: boolean;
  locale: UiLocale;
  onSave: (next: SubagentRoutingSave) => void | Promise<void>;
};

type ModelOption = { id: string; name: string };

/** 一个 provider 可选的路由目标：已配置模型优先，其次 Host 目录公布的同名分组。 */
function modelOptionsFor(
  provider: DshProvider,
  settings: DshSettingsDescription | null,
  hostModels: DshHostModelCatalog | null,
): ModelOption[] {
  const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
  const options = new Map<string, string>();
  for (const model of providerModels(provider, namespace)) {
    const id = String(model.id);
    options.set(id, typeof model.name === "string" && model.name.trim() ? model.name : id);
  }
  const group = hostModels?.groups.find((candidate) => candidate.id === provider.provider
    || candidate.id.startsWith(`${provider.provider}:`)
    || candidate.id.includes(provider.provider));
  for (const model of group?.models ?? []) {
    if (!options.has(model.id)) options.set(model.id, model.name);
  }
  return [...options.entries()].map(([id, name]) => ({ id, name }));
}

export function SubagentRoutingPanel({ current, providers, settings, hostModels, saving, locale, onSave }: SubagentRoutingPanelProps) {
  const [draft, setDraft] = useState<SubagentRoutingSave>(current);
  // 保存后设置视图会重读；以序列化值做同步键，避免每次渲染都重置草稿。
  const syncKey = useMemo(() => JSON.stringify(current), [current]);
  useEffect(() => {
    setDraft(current);
  }, [syncKey]);

  const modelOptions = useMemo(() => new Map(providers.map((provider) => [
    provider.provider,
    modelOptionsFor(provider, settings, hostModels),
  ])), [providers, settings, hostModels]);

  const writable = settings?.writable ?? false;
  // 两个命名空间缺一不可：白名单缺失时委派策略无从生效，说明命名空间缺失时
  // 保存会丢掉用户填写的说明。
  const namespacesAvailable = settings?.namespaces.some((namespace) => namespace.ns === SUBAGENT_MODEL_SELECTION_NS) ?? false;
  const routingAvailable = settings?.namespaces.some((namespace) => namespace.ns === SUBAGENT_ROUTING_NS) ?? false;
  const policyAvailable = namespacesAvailable && routingAvailable;
  const dirty = !sameJson(draft, current);
  const duplicate = duplicateRoutingKey(draft.rows);
  const canSave = writable && policyAvailable && dirty && duplicate === undefined && !saving;

  function updateRow(index: number, patch: Partial<SubagentRoutingRow>) {
    setDraft((value) => ({ ...value, rows: value.rows.map((row, at) => at === index ? { ...row, ...patch } : row) }));
  }

  function removeRow(index: number) {
    setDraft((value) => ({ ...value, rows: value.rows.filter((_, at) => at !== index) }));
  }

  function addRow() {
    setDraft((value) => ({
      ...value,
      rows: [...value.rows, { provider: providers[0]?.provider ?? "", model: "", note: "" }],
    }));
  }

  return (
    <div className="settings-block">
      <div className="settings-block-heading">
        <div><h3>{t("subagentRouting.title", locale)}</h3><p>{t("subagentRouting.hint", locale)}</p></div>
        <button type="button" className="subagent-route-add" onClick={addRow} disabled={!writable || providers.length === 0}>
          <Plus aria-hidden="true" />{t("subagentRouting.addRow", locale)}
        </button>
      </div>

      {!policyAvailable && <p className="settings-empty">{t("subagentRouting.unavailable", locale)}</p>}

      <label className="subagent-routing-toggle">
        <input
          type="checkbox"
          checked={draft.enabled && draft.rows.length > 0}
          disabled={!writable || draft.rows.length === 0}
          onChange={(event) => setDraft((value) => ({ ...value, enabled: event.target.checked }))}
        />
        <span>
          <strong>{t("subagentRouting.enabled", locale)}</strong>
          <small>{draft.rows.length === 0 ? t("subagentRouting.enabledNeedsRoute", locale) : t("subagentRouting.enabledHint", locale)}</small>
        </span>
      </label>

      {draft.rows.length === 0
        ? <p className="settings-empty">{providers.length === 0 ? t("subagentRouting.noProviders", locale) : t("subagentRouting.empty", locale)}</p>
        : <div className="subagent-route-list">{draft.rows.map((row, index) => {
          const options = modelOptions.get(row.provider) ?? [];
          const unlisted = row.model !== "" && !options.some((option) => option.id === row.model);
          return <div className="subagent-route-row" key={`${index}-${row.provider}`}>
            <label>
              <span>{t("subagentRouting.provider", locale)}</span>
              <select
                value={row.provider}
                disabled={!writable}
                onChange={(event) => updateRow(index, { provider: event.target.value, model: "" })}
              >
                <option value="">{t("subagentRouting.selectProvider", locale)}</option>
                {providers.map((provider) => <option value={provider.provider} key={provider.provider}>{provider.displayName || provider.provider}</option>)}
              </select>
            </label>
            <label>
              <span>{t("subagentRouting.model", locale)}</span>
              <select
                value={row.model}
                disabled={!writable || row.provider === ""}
                onChange={(event) => updateRow(index, { model: event.target.value })}
              >
                <option value="">{t("subagentRouting.selectModel", locale)}</option>
                {options.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}
                {unlisted && <option value={row.model}>{row.model}</option>}
              </select>
            </label>
            <label className="subagent-route-note">
              <span>{t("subagentRouting.note", locale)}</span>
              <input
                type="text"
                value={row.note}
                disabled={!writable}
                placeholder={t("subagentRouting.notePlaceholder", locale)}
                onChange={(event) => updateRow(index, { note: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="subagent-route-remove"
              disabled={!writable}
              aria-label={t("subagentRouting.remove", locale)}
              title={t("subagentRouting.remove", locale)}
              onClick={() => removeRow(index)}
            ><Trash2 aria-hidden="true" /></button>
          </div>;
        })}</div>}

      {duplicate !== undefined && <p className="settings-custom-provider-error">{t("subagentRouting.duplicate", locale, { key: duplicate })}</p>}

      <label className="subagent-routing-guidance">
        <span>{t("subagentRouting.guidance", locale)}</span>
        <textarea
          value={draft.guidance}
          disabled={!writable}
          placeholder={t("subagentRouting.guidancePlaceholder", locale)}
          rows={3}
          onChange={(event) => setDraft((value) => ({ ...value, guidance: event.target.value }))}
        />
        <small>{t("subagentRouting.guidanceHint", locale)}</small>
      </label>

      <div className="subagent-routing-actions">
        <small>{t("subagentRouting.effectiveHint", locale)}</small>
        <button type="button" disabled={!dirty || saving} onClick={() => setDraft(current)}>{t("subagentRouting.reset", locale)}</button>
        <button type="button" className="confirm" disabled={!canSave} onClick={() => void onSave(draft)}>
          {saving ? t("subagentRouting.saving", locale) : t("subagentRouting.save", locale)}
        </button>
      </div>
    </div>
  );
}
