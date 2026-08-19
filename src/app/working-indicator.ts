import type { WorkingIndicatorEffect, WorkingIndicatorSettings } from "./model-types";

export const WORKING_INDICATOR_DEFAULT_TEXT = "Deep diving...";

export const WORKING_INDICATOR_EFFECTS: WorkingIndicatorEffect[] = ["none", "shimmer", "pulse", "glow"];

export const defaultWorkingIndicator: WorkingIndicatorSettings = {
  texts: [WORKING_INDICATOR_DEFAULT_TEXT],
  color: "#4176e6",
  effect: "shimmer",
  rotationInterval: 2400,
};

const MAX_TEXTS = 12;
const MAX_TEXT_LENGTH = 120;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeTexts(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\r?\n/) : [];
  const texts = values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, MAX_TEXT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_TEXTS);
  return texts.length > 0 ? texts : [...defaultWorkingIndicator.texts];
}

/** Normalize persisted or imported indicator settings without trusting arbitrary CSS values. */
export function normalizeWorkingIndicator(value: unknown): WorkingIndicatorSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaultWorkingIndicator, texts: [...defaultWorkingIndicator.texts] };
  const record = value as Partial<WorkingIndicatorSettings>;
  const effect = WORKING_INDICATOR_EFFECTS.includes(record.effect as WorkingIndicatorEffect)
    ? record.effect as WorkingIndicatorEffect
    : defaultWorkingIndicator.effect;
  const color = typeof record.color === "string" && HEX_COLOR.test(record.color)
    ? record.color
    : defaultWorkingIndicator.color;
  return {
    texts: normalizeTexts(record.texts),
    color,
    effect,
    rotationInterval: boundedNumber(record.rotationInterval, defaultWorkingIndicator.rotationInterval, 1200, 10000),
  };
}

export function workingIndicatorTextAt(settings: WorkingIndicatorSettings, index: number): string {
  const texts = settings.texts.length > 0 ? settings.texts : defaultWorkingIndicator.texts;
  return texts[((index % texts.length) + texts.length) % texts.length] || WORKING_INDICATOR_DEFAULT_TEXT;
}
