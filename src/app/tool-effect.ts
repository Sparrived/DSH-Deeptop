import type { ToolEffect, ToolEffectSettings } from "./model-types";

/** 工具特效的可选值，顺序即设置面板的下拉顺序。 */
export const TOOL_EFFECTS: ToolEffect[] = ["none", "glow", "marquee", "ants", "sheen"];

/** 默认「无特效」：工具行保持原有静态外观，字形与状态色不变。 */
export const defaultToolEffect: ToolEffectSettings = {
  effect: "none",
  color: "#d6a15b",
  opacity: 0.6,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/** Normalize persisted or imported effect settings without trusting arbitrary CSS values. */
export function normalizeToolEffect(value: unknown): ToolEffectSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaultToolEffect };
  const record = value as Partial<ToolEffectSettings>;
  return {
    effect: TOOL_EFFECTS.includes(record.effect as ToolEffect)
      ? record.effect as ToolEffect
      : defaultToolEffect.effect,
    color: typeof record.color === "string" && HEX_COLOR.test(record.color)
      ? record.color
      : defaultToolEffect.color,
    opacity: boundedNumber(record.opacity, defaultToolEffect.opacity, 0, 1),
  };
}

/** 特效 class：挂在工具行所在的容器上（app-shell），样式表据此选中运行中的工具行边缘。 */
export function toolEffectClass(settings: ToolEffectSettings): string {
  return `tool-effect-${normalizeToolEffect(settings).effect}`;
}

/**
 * 把特效色与不透明度合成一个带 alpha 的 CSS 颜色。直接在 JS 里算好，
 * 样式表就不必依赖 color-mix/calc：工具行的边缘光带与发光阴影都用这一个值。
 */
export function toolEffectInk(settings: ToolEffectSettings): string {
  const safe = normalizeToolEffect(settings);
  const value = Number.parseInt(safe.color.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${Math.round(safe.opacity * 100) / 100})`;
}
