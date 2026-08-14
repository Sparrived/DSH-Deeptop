import type { ComposerCandidate, ComposerTrigger } from "../app/model";

type ComposerCandidatesProps = {
  candidates: ComposerCandidate[];
  triggerKind?: ComposerTrigger["kind"];
  dismissed: boolean;
  activeIndex: number;
  onChoose: (candidate: ComposerCandidate) => void;
};

export function ComposerCandidates({ candidates, triggerKind, dismissed, activeIndex, onChoose }: ComposerCandidatesProps) {
  if (candidates.length === 0 || dismissed) return null;

  return (
    <div className="composer-candidates" id="composer-candidates" role="listbox" aria-label="输入候选">
      <div className="composer-candidates-heading">{triggerKind === "skill" ? "Skill" : "Subagent"}</div>
      {candidates.map((candidate, index) => (
        <button
          className={`composer-candidate${index === activeIndex ? " selected" : ""}`}
          id={`composer-candidate-${index}`}
          key={`${candidate.kind}-${candidate.id}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
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
