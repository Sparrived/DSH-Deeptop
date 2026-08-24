import { useEffect, useState } from "react";
import { formatPetCareCooldown, petCareCooldownRemainingMs } from "../app/pet-model";
import type { PetCareActionKind, PetCareState } from "../lib/desktop";

interface PetCareCardProps {
  petName: string;
  state: PetCareState;
  busy: boolean;
  feedback: string | null;
  error: string | null;
  onAction: (action: PetCareActionKind) => void;
  onClose: () => void;
  onTasks?: () => void;
}

const conditionLabels: Readonly<Record<PetCareState["condition"], string>> = {
  happy: "心情很好",
  content: "悠闲自在",
  hungry: "有点饿了",
  lonely: "想要陪伴",
};

const actions: ReadonlyArray<{ kind: PetCareActionKind; icon: string; label: string; unavailableLabel: string }> = [
  { kind: "meal", icon: "🍚", label: "喂正餐", unavailableLabel: "还不饿" },
  { kind: "treat", icon: "🍪", label: "喂点心", unavailableLabel: "吃不下" },
  { kind: "pet", icon: "♡", label: "摸摸", unavailableLabel: "已满足" },
  { kind: "play", icon: "✦", label: "陪玩", unavailableLabel: "先休息" },
];

function score(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

export function PetCareCard({ petName, state, busy, feedback, error, onAction, onClose, onTasks }: PetCareCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const metrics = [
    { label: "饱食", value: score(state.satiety) },
    { label: "心情", value: score(state.mood) },
    { label: "亲密", value: score(state.affection) },
  ];

  useEffect(() => {
    const updateClock = () => setNowMs(Date.now());
    updateClock();
    if (!Object.values(state.actionReadyAtMs).some((readyAtMs) => readyAtMs > Date.now())) return;
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, [
    state.actionReadyAtMs.meal,
    state.actionReadyAtMs.pet,
    state.actionReadyAtMs.play,
    state.actionReadyAtMs.treat,
  ]);

  return (
    <section className="pet-notice-card pet-care-card" data-condition={state.condition} aria-label={`${petName}的养成状态`}>
      <header className="pet-care-header">
        <div>
          <span className="pet-care-overline"><i aria-hidden="true" />养成日常</span>
          <strong>{petName}</strong>
        </div>
        <span className="pet-notice-header-actions">
          {onTasks && <button type="button" className="pet-notice-care-switch" onClick={onTasks}>会话</button>}
          <button type="button" className="pet-notice-close" aria-label="收起养成面板" onClick={onClose}>×</button>
        </span>
      </header>

      <div className="pet-care-condition">
        <strong>{conditionLabels[state.condition]}</strong>
        <span>换宠物外观也会保留这些状态</span>
      </div>

      <div className="pet-care-metrics">
        {metrics.map((metric) => (
          <div className="pet-care-metric" key={metric.label}>
            <span><strong>{metric.label}</strong><em>{metric.value}</em></span>
            <progress max="100" value={metric.value} aria-label={`${metric.label} ${metric.value}`} />
          </div>
        ))}
      </div>

      <div className="pet-care-actions" aria-label="照顾宠物">
        {actions.map((action) => {
          const remainingMs = petCareCooldownRemainingMs(state, action.kind, nowMs);
          const cooldown = formatPetCareCooldown(remainingMs);
          const isUnavailable = !state.actionAllowed[action.kind];
          const unavailableText = cooldown ? `${cooldown}后` : isUnavailable ? action.unavailableLabel : "";
          return (
            <button
              type="button"
              key={action.kind}
              disabled={busy || remainingMs > 0 || isUnavailable}
              aria-label={unavailableText ? `${action.label}，${unavailableText}` : action.label}
              title={unavailableText || undefined}
              onClick={() => onAction(action.kind)}
            >
              <span className="pet-care-action-icon" aria-hidden="true">{action.icon}</span>
              <span className="pet-care-action-copy">
                <strong>{action.label}</strong>
                {unavailableText && <small>{unavailableText}</small>}
              </span>
            </button>
          );
        })}
      </div>

      <p className={`pet-care-feedback${error ? " is-error" : ""}`} role="status">
        {error || feedback || "轻轻点一下，看看它现在想做什么。"}
      </p>
    </section>
  );
}
