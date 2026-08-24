import type {
  PetActivityState,
  PetAnimationState,
  PetBundle,
  PetBundleDescriptor,
  PetCareActionKind,
  PetCareState,
  PetInteraction,
  PetInteractionEvent,
  PetSettings,
} from "../lib/desktop";
import { t, type UiLocale } from "./i18n.ts";

export const DEEPTOP_PET_CELL = { width: 192, height: 208 } as const;
export const DEEPTOP_PET_ATLAS = { columns: 8, rows: 11, width: 1536, height: 2288 } as const;

export interface PetAnimationSpec {
  state: PetAnimationState;
  row: number;
  frameDurationsMs: readonly number[];
  loop: boolean;
}

export interface PetLookCell {
  row: 9 | 10;
  column: number;
}

export const defaultPetSettings: PetSettings = {
  enabled: false,
  selectedPetId: "",
  anchor: "bottom-right",
  size: 112,
  motionEnabled: true,
  interactionsEnabled: true,
  careEnabled: true,
  alwaysOnTop: true,
};

export const petAnimationSpecs: Readonly<Record<PetAnimationState, PetAnimationSpec>> = {
  idle: { state: "idle", row: 0, frameDurationsMs: [280, 110, 110, 140, 140, 320], loop: true },
  "running-right": { state: "running-right", row: 1, frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  "running-left": { state: "running-left", row: 2, frameDurationsMs: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  waving: { state: "waving", row: 3, frameDurationsMs: [140, 140, 140, 280], loop: false },
  jumping: { state: "jumping", row: 4, frameDurationsMs: [140, 140, 140, 140, 280], loop: false },
  failed: { state: "failed", row: 5, frameDurationsMs: [140, 140, 140, 140, 140, 140, 140, 240], loop: false },
  waiting: { state: "waiting", row: 6, frameDurationsMs: [150, 150, 150, 150, 150, 260], loop: true },
  running: { state: "running", row: 7, frameDurationsMs: [120, 120, 120, 120, 120, 220], loop: true },
  review: { state: "review", row: 8, frameDurationsMs: [150, 150, 150, 150, 150, 280], loop: false },
};

const defaultInteractions: readonly PetInteraction[] = [
  { on: "pointerEnter", play: "waving", then: "idle", cooldownMs: 3_000 },
  { on: "tap", play: "waving", then: "idle", cooldownMs: 350 },
  { on: "doubleTap", play: "jumping", then: "idle", cooldownMs: 500 },
  { on: "longPress", play: "waving", then: "idle", cooldownMs: 700 },
  { on: "dragEnd", play: "jumping", then: "idle", cooldownMs: 0 },
  { on: "idleTimeout", play: "waving", then: "idle", cooldownMs: 4_000 },
  { on: "idleTimeout", play: "jumping", then: "idle", cooldownMs: 4_000 },
];

const PET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

function boundedSize(value: unknown): number {
  const size = Number(value);
  return Number.isFinite(size) ? Math.round(Math.min(160, Math.max(56, size))) : defaultPetSettings.size;
}

/** 返回某项照顾动作距离再次可用的毫秒数。 */
export function petCareCooldownRemainingMs(
  state: PetCareState,
  action: PetCareActionKind,
  nowMs: number,
): number {
  return Math.max(0, state.actionReadyAtMs[action] - nowMs);
}

/** 将照顾动作冷却格式化为卡片中的紧凑倒计时。 */
export function formatPetCareCooldown(remainingMs: number, locale: UiLocale = "zh"): string {
  if (remainingMs <= 0) return "";
  if (remainingMs < 60_000) return t("pet.cooldownSeconds", locale, { value: Math.ceil(remainingMs / 1_000) });
  return t("pet.cooldownMinutes", locale, { value: Math.ceil(remainingMs / 60_000) });
}

/** 归一化来自原生设置文件的展示字段；缺失宠物切换到首个可用项。 */
export function normalizePetSettings(value: unknown, availableIds?: ReadonlySet<string>): PetSettings {
  if (!value || typeof value !== "object") return { ...defaultPetSettings };
  const record = value as Partial<PetSettings>;
  const candidate = typeof record.selectedPetId === "string" && PET_ID_PATTERN.test(record.selectedPetId)
    ? record.selectedPetId
    : "";
  const selectedPetId = candidate && (!availableIds || availableIds.has(candidate))
    ? candidate
    : availableIds?.values().next().value ?? "";
  return {
    enabled: record.enabled === true && Boolean(selectedPetId),
    selectedPetId,
    anchor: record.anchor === "bottom-left" ? "bottom-left" : "bottom-right",
    size: boundedSize(record.size),
    motionEnabled: record.motionEnabled !== false,
    interactionsEnabled: record.interactionsEnabled !== false,
    careEnabled: record.careEnabled !== false,
    alwaysOnTop: record.alwaysOnTop !== false,
  };
}

/** 丢弃宠物库中的重复 id。 */
export function petLibraryEntries(installed: readonly PetBundleDescriptor[]): PetBundleDescriptor[] {
  const entries: PetBundleDescriptor[] = [];
  const seen = new Set<string>();
  for (const pet of installed) {
    if (seen.has(pet.id)) continue;
    seen.add(pet.id);
    entries.push({ ...pet, builtIn: false });
  }
  return entries;
}

/** 删除当前宠物后选择剩余首项；没有剩余宠物时关闭桌宠。 */
export function petSettingsAfterRemoval(
  settings: PetSettings,
  remaining: readonly PetBundleDescriptor[],
): PetSettings {
  const availableIds = new Set(remaining.map((pet) => pet.id));
  const selectedPetId = remaining[0]?.id ?? "";
  return normalizePetSettings({
    ...settings,
    enabled: settings.enabled && Boolean(selectedPetId),
    selectedPetId,
  }, availableIds);
}

export function petAnimationDurationMs(state: PetAnimationState): number {
  return petAnimationSpecs[state].frameDurationsMs.reduce((total, duration) => total + duration, 0);
}

/** 按 Deeptop Pet 的逐帧时长返回当前列，不用 React 状态驱动帧动画。 */
export function petFrameColumn(state: PetAnimationState, elapsedMs: number): number {
  const spec = petAnimationSpecs[state];
  const duration = petAnimationDurationMs(state);
  const position = spec.loop
    ? Math.max(0, elapsedMs) % duration
    : Math.min(Math.max(0, elapsedMs), Math.max(0, duration - 1));
  let cursor = 0;
  for (let index = 0; index < spec.frameDurationsMs.length; index += 1) {
    cursor += spec.frameDurationsMs[index];
    if (position < cursor) return index;
  }
  return spec.frameDurationsMs.length - 1;
}

/** 把顺时针 16 向序号映射到标准图集最后两行。 */
export function petLookCell(direction: number): PetLookCell {
  const normalized = ((Math.round(direction) % 16) + 16) % 16;
  return normalized < 8
    ? { row: 9, column: normalized }
    : { row: 10, column: normalized - 8 };
}

/** 将系统指针方向量化为从正上方开始、顺时针排列的 16 向序号。 */
export function petLookDirection(
  deltaX: number,
  deltaY: number,
  distance: number,
  minimumDistance: number,
  maximumDistance: number,
): number | null {
  if (![deltaX, deltaY, distance, minimumDistance, maximumDistance].every(Number.isFinite)) return null;
  if (distance < minimumDistance || distance > maximumDistance) return null;
  const degrees = (Math.atan2(deltaX, -deltaY) * 180 / Math.PI + 360) % 360;
  return Math.round(degrees / 22.5) % 16;
}

/** 运行中和等待输入是持续宿主状态；完成与失败只播放一次后回到待机。 */
export function petStableAnimationForActivity(state: PetActivityState): PetAnimationState {
  if (state === "running") return "running";
  if (state === "waiting") return "waiting";
  return "idle";
}

export function petTransientAnimationForActivity(state: PetActivityState): PetAnimationState | null {
  if (state === "failed") return "failed";
  if (state === "review") return "review";
  return null;
}

export function petInteractionRules(bundle: PetBundle | null, event: PetInteractionEvent): PetInteraction[] {
  const rules = bundle?.manifest.interactions.length ? bundle.manifest.interactions : defaultInteractions;
  return rules.filter((rule) => rule.on === event);
}

export function petSpritesheetAssetSource(bundle: PetBundle): string | null {
  const asset = bundle.assets[bundle.manifest.spritesheetPath];
  return asset ? `data:${asset.mediaType};base64,${asset.data}` : null;
}
