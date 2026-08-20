import type { RefObject } from "react";
import type { DshModel, DshSessionModels } from "../lib/desktop";
import { modelPickerGroups } from "../app/ui-model";
import type { ModelMenuPane } from "../app/model";

type ReasoningChoice = {
  key: string;
  id?: string;
  name: string;
  description?: string;
};

type ModelPickerProps = {
  models: DshSessionModels;
  menuRef: RefObject<HTMLDivElement | null>;
  selectedModelValue: string;
  selectedModelName?: string;
  selectedReasoning?: NonNullable<DshModel["reasoning"]>;
  selectedReasoningEffort?: string;
  selectedReasoningLabel?: string;
  reasoningChoices: ReasoningChoice[];
  menuOpen: boolean;
  menuPane: ModelMenuPane;
  onToggleMenu: () => void;
  onSetPane: (pane: ModelMenuPane) => void;
  onChangeModel: (value: string) => void | Promise<void>;
  onChangeReasoningEffort: (value?: string) => void | Promise<void>;
};

export function ModelPicker({
  models,
  menuRef,
  selectedModelValue,
  selectedModelName,
  selectedReasoning,
  selectedReasoningEffort,
  selectedReasoningLabel,
  reasoningChoices,
  menuOpen,
  menuPane,
  onToggleMenu,
  onSetPane,
  onChangeModel,
  onChangeReasoningEffort,
}: ModelPickerProps) {
  const groups = modelPickerGroups(models);
  return (
    <div className="model-picker" ref={menuRef}>
      <button
        className="model-picker-trigger"
        type="button"
        aria-label="选择模型与思考程度"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`${selectedModelName ?? "选择模型"}${selectedReasoningLabel ? ` · ${selectedReasoningLabel}` : ""}`}
        onClick={onToggleMenu}
      >
        <span className="model-picker-label">{selectedModelName ?? "选择模型"}</span>
        {selectedReasoningLabel && <span className="model-picker-effort">· {selectedReasoningLabel}</span>}
        <span className={`model-picker-chevron${menuOpen ? " open" : ""}`} aria-hidden="true">v</span>
      </button>
      {menuOpen && <div className="model-menu" role="menu" aria-label="模型与思考程度">
        {menuPane === "root" && <>
          <button className="model-menu-cell" type="button" role="menuitem" onClick={() => onSetPane("model")}>
            <span>模型</span>
            <span className="model-menu-cell-value">{selectedModelName ?? "选择模型"}</span>
            <span className="model-menu-arrow" aria-hidden="true">&gt;</span>
          </button>
          {selectedReasoning !== undefined && <button className="model-menu-cell" type="button" role="menuitem" onClick={() => onSetPane("effort")}>
            <span>思考程度</span>
            <span className="model-menu-cell-value">{selectedReasoningLabel ?? "默认"}</span>
            <span className="model-menu-arrow" aria-hidden="true">&gt;</span>
          </button>}
        </>}
        {menuPane === "model" && <>
          <div className="model-menu-heading">
            <button type="button" onClick={() => onSetPane("root")} aria-label="返回模型与思考程度">&lt;</button>
            <strong>模型</strong>
          </div>
          <div className="model-menu-list">
            {groups.map((group) => <section className="model-menu-group" key={group.id}>
              <div className="model-menu-group-title">{group.name}</div>
              {group.models.map((model) => {
                const value = `${group.id}\u0000${model.id}`;
                const selected = value === selectedModelValue;
                return <button className={`model-menu-option${selected ? " selected" : ""}`} type="button" role="menuitemradio" aria-checked={selected} key={value} onClick={() => void onChangeModel(value)}>
                  <span className="model-menu-option-copy">
                    <strong>{model.name}</strong>
                    {model.description && <small>{model.description}</small>}
                  </span>
                  <span className="model-menu-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                </button>;
              })}
            </section>)}
            {groups.length === 0 && <div className="model-menu-empty">暂无可用模型</div>}
          </div>
        </>}
        {menuPane === "effort" && selectedReasoning !== undefined && <>
          <div className="model-menu-heading">
            <button type="button" onClick={() => onSetPane("root")} aria-label="返回模型与思考程度">&lt;</button>
            <strong>思考程度</strong>
          </div>
          <div className="model-menu-list">
            {reasoningChoices.length === 0 ? <div className="model-menu-empty">当前模型未提供思考程度。</div> : reasoningChoices.map((choice) => {
              const selected = selectedReasoningEffort === choice.id;
              return <button className={`model-menu-option${selected ? " selected" : ""}`} type="button" role="menuitemradio" aria-checked={selected} key={choice.key} onClick={() => void onChangeReasoningEffort(choice.id)}>
                <span className="model-menu-option-copy">
                  <strong>{choice.name}</strong>
                  {choice.description && <small>{choice.description}</small>}
                </span>
                <span className="model-menu-check" aria-hidden="true">{selected ? "✓" : ""}</span>
              </button>;
            })}
          </div>
        </>}
      </div>}
    </div>
  );
}
