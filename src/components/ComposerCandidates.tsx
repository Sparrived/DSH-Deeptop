import { useEffect, useRef } from "react";
import type { ComposerCandidate, ComposerTrigger } from "../app/model";
import { t, type UiLocale } from "../app/i18n";

type ComposerCandidatesProps = {
  /** 界面语言：候选面板文案按语言渲染。 */
  locale?: UiLocale;
  candidates: ComposerCandidate[];
  triggerKind?: ComposerTrigger["kind"];
  dismissed: boolean;
  activeIndex: number;
  onChoose: (candidate: ComposerCandidate) => void;
};

export function ComposerCandidates({ locale = "zh", candidates, triggerKind, dismissed, activeIndex, onChoose }: ComposerCandidatesProps) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (candidates.length === 0 || dismissed) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, candidates.length, dismissed]);

  if (candidates.length === 0 || dismissed) return null;

  return (
    <div className="composer-candidates" id="composer-candidates" role="listbox" aria-label={t("composer.candidates.aria", locale)}>
      <div className="composer-candidates-heading">{triggerKind === "skill" ? "Command / Skill" : triggerKind === "reference" ? "File / Session / Subagent" : "Subagent"}</div>
      {candidates.map((candidate, index) => (
        <button
          ref={(element) => { optionRefs.current[index] = element; }}
          className={`composer-candidate${index === activeIndex ? " selected" : ""}`}
          id={`composer-candidate-${index}`}
          key={`${candidate.kind}-${candidate.id}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseEnter={() => optionRefs.current[index]?.scrollIntoView({ block: "nearest" })}
          onMouseDown={(event) => {
            event.preventDefault();
            onChoose(candidate);
          }}
        >
          <strong>{candidate.label}</strong>
          {candidate.detail && <small>{candidate.detail}</small>}
        </button>
      ))}
    </div>
  );
}
