import type { RefObject } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { DshModel, DshSessionModels } from "../lib/desktop";
import { modelPickerGroups } from "../app/ui-model";
import type { ModelMenuPane } from "../app/model";
import { t, type UiLocale } from "../app/i18n";
import { ReasoningSlider, type ReasoningSliderChoice as ReasoningChoice } from "./ReasoningSlider";

type ModelPickerProps = {
  /** 界面语言：模型菜单文案按语言渲染。 */
  locale?: UiLocale;
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
  locale = "zh",
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
  const groups = modelPickerGroups(models, locale);
  return (
    <div className="model-picker" ref={menuRef}>
      <button
        className="model-picker-trigger"
        type="button"
        aria-label={t("modelPicker.chooseAria", locale)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`${selectedModelName ?? t("modelPicker.chooseModel", locale)}${selectedReasoningLabel ? ` · ${selectedReasoningLabel}` : ""}`}
        onClick={onToggleMenu}
      >
        <span className="model-picker-label">{selectedModelName ?? t("modelPicker.chooseModel", locale)}</span>
        {selectedReasoningLabel && <span className="model-picker-effort">· {selectedReasoningLabel}</span>}
        <span className={`model-picker-chevron${menuOpen ? " open" : ""}`} aria-hidden="true"><ChevronDown /></span>
      </button>
      {menuOpen && <div className="model-menu" role="menu" aria-label={t("modelPicker.menuAria", locale)}>
        {menuPane === "root" && <>
          <button className="model-menu-cell" type="button" role="menuitem" onClick={() => onSetPane("model")}>
            <span>{t("modelPicker.model", locale)}</span>
            <span className="model-menu-cell-value">{selectedModelName ?? t("modelPicker.chooseModel", locale)}</span>
            <span className="model-menu-arrow" aria-hidden="true"><ChevronRight /></span>
          </button>
          {/* 思考程度直接在一级菜单里滑选，不再进入二级菜单。 */}
          {selectedReasoning !== undefined && <section className="model-menu-effort" role="group" aria-label={t("modelPicker.reasoningEffort", locale)}>
            <div className="model-menu-effort-title">
              <span>{t("modelPicker.reasoningEffort", locale)}</span>
              <span className="model-menu-effort-value">{selectedReasoningLabel ?? t("modelPicker.default", locale)}</span>
            </div>
            {reasoningChoices.length === 0
              ? <div className="model-menu-empty">{t("modelPicker.noEfforts", locale)}</div>
              : <ReasoningSlider
                locale={locale}
                choices={reasoningChoices}
                value={selectedReasoningEffort}
                onChange={onChangeReasoningEffort}
              />}
          </section>}
        </>}
        {menuPane === "model" && <>
          <div className="model-menu-heading">
            <button type="button" onClick={() => onSetPane("root")} aria-label={t("modelPicker.backAria", locale)}><ChevronLeft aria-hidden="true" /></button>
            <strong>{t("modelPicker.model", locale)}</strong>
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
                  <span className="model-menu-check" aria-hidden="true">{selected && <Check />}</span>
                </button>;
              })}
            </section>)}
            {groups.length === 0 && <div className="model-menu-empty">{t("modelPicker.noModels", locale)}</div>}
          </div>
        </>}
      </div>}
    </div>
  );
}
