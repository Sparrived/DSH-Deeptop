import { useEffect, useState } from "react";
import { formatPetCareCooldown, petCareCooldownRemainingMs } from "../app/pet-model";
import { t, type UiLocale } from "../app/i18n";
import type { PetCareActionKind, PetCareState } from "../lib/desktop";

interface PetCareCardProps {
  petName: string;
  state: PetCareState;
  busy: boolean;
  feedback: string | null;
  error: string | null;
  locale?: UiLocale;
  onAction: (action: PetCareActionKind) => void;
  onClose: () => void;
  onTasks?: () => void;
}

const conditionLabelKeys: Readonly<Record<PetCareState["condition"], string>> = {
  happy: "pet.care.condition.happy",
  content: "pet.care.condition.content",
  hungry: "pet.care.condition.hungry",
  lonely: "pet.care.condition.lonely",
};

const actions: ReadonlyArray<{
  kind: PetCareActionKind;
  icon: string;
  labelKey: string;
  unavailableKey: string;
}> = [
  { kind: "meal", icon: "🍚", labelKey: "pet.care.action.meal", unavailableKey: "pet.care.action.mealUnavailable" },
  { kind: "treat", icon: "🍪", labelKey: "pet.care.action.treat", unavailableKey: "pet.care.action.treatUnavailable" },
  { kind: "pet", icon: "♡", labelKey: "pet.care.action.pet", unavailableKey: "pet.care.action.petUnavailable" },
  { kind: "play", icon: "✦", labelKey: "pet.care.action.play", unavailableKey: "pet.care.action.playUnavailable" },
];

function score(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

export function PetCareCard({ petName, state, busy, feedback, error, locale = "zh", onAction, onClose, onTasks }: PetCareCardProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const metrics = [
    { key: "pet.care.stat.satiety", value: score(state.satiety) },
    { key: "pet.care.stat.mood", value: score(state.mood) },
    { key: "pet.care.stat.affection", value: score(state.affection) },
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
    <section className="pet-notice-card pet-care-card" data-condition={state.condition} aria-label={t("pet.care.aria.status", locale, { name: petName })}>
      <header className="pet-care-header">
        <div>
          <span className="pet-care-overline"><i aria-hidden="true" />{t("pet.care.overlineDaily", locale)}</span>
          <strong>{petName}</strong>
        </div>
        <span className="pet-notice-header-actions">
          {onTasks && <button type="button" className="pet-notice-care-switch" onClick={onTasks}>{t("pet.care.sessionsSwitch", locale)}</button>}
          <button type="button" className="pet-notice-close" aria-label={t("pet.care.aria.collapse", locale)} onClick={onClose}>×</button>
        </span>
      </header>

      <div className="pet-care-condition">
        <strong>{t(conditionLabelKeys[state.condition], locale)}</strong>
        <span>{t("pet.care.statePersists", locale)}</span>
      </div>

      <div className="pet-care-metrics">
        {metrics.map((metric) => (
          <div className="pet-care-metric" key={metric.key}>
            <span><strong>{t(metric.key, locale)}</strong><em>{metric.value}</em></span>
            <progress max="100" value={metric.value} aria-label={`${t(metric.key, locale)} ${metric.value}`} />
          </div>
        ))}
      </div>

      <div className="pet-care-actions" aria-label={t("pet.care.aria.actions", locale)}>
        {actions.map((action) => {
          const remainingMs = petCareCooldownRemainingMs(state, action.kind, nowMs);
          const cooldown = formatPetCareCooldown(remainingMs, locale);
          const isUnavailable = !state.actionAllowed[action.kind];
          const label = t(action.labelKey, locale);
          const unavailableText = cooldown
            ? t("pet.care.cooldownSuffix", locale, { cooldown })
            : isUnavailable
              ? t(action.unavailableKey, locale)
              : "";
          return (
            <button
              type="button"
              key={action.kind}
              disabled={busy || remainingMs > 0 || isUnavailable}
              aria-label={unavailableText ? `${label}，${unavailableText}` : label}
              title={unavailableText || undefined}
              onClick={() => onAction(action.kind)}
            >
              <span className="pet-care-action-icon" aria-hidden="true">{action.icon}</span>
              <span className="pet-care-action-copy">
                <strong>{label}</strong>
                {unavailableText && <small>{unavailableText}</small>}
              </span>
            </button>
          );
        })}
      </div>

      <p className={`pet-care-feedback${error ? " is-error" : ""}`} role="status">
        {error || feedback || t("pet.care.fallback", locale)}
      </p>
    </section>
  );
}
