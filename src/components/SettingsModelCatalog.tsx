import type { DshHostModelCatalog } from "../app/model";

interface SettingsModelCatalogProps {
  catalog: DshHostModelCatalog | null;
}

export function SettingsModelCatalog({ catalog }: SettingsModelCatalogProps) {
  return <div className="settings-block">
    <div className="settings-block-heading"><div><h3>可用模型</h3><p>来自 Host 的模型目录，不直接修改会话历史。</p></div></div>
    {!catalog || catalog.groups.length === 0 ? <p className="settings-empty">模型目录暂不可用。</p> : <div className="settings-model-catalog">{catalog.groups.map((group) => <div className="settings-model-group" key={group.id}><div><strong>{group.name}</strong><small>{group.id}</small></div><span>{group.models.length} 个模型</span><p>{group.models.map((model) => model.name).join(" · ")}</p></div>)}</div>}
  </div>;
}
