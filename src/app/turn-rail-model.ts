// Turn-rail view model: merges the loaded display-history window with the
// host `turnOutline` projection into the rail ladder. Mirrors the official
// web chat rail semantics: a loaded turn scrolls to its row, an unloaded one
// pages history through its seq first; the projection names every turn of the
// session while the loaded window supplies anchors and previews for the turns
// it holds.

import type { DshHistoryEntry } from "../lib/desktop";
import {
  assistantContent,
  contentSegments,
  isInjectedMessage,
  numberValue,
} from "./message-model.ts";

/** Prompt preview budget: one rail line. Mirrors the turnOutline projection. */
export const TURN_PROMPT_PREVIEW_LIMIT = 50;
/** Response preview budget: up to three rail lines. Mirrors the projection. */
export const TURN_RESPONSE_PREVIEW_LIMIT = 120;

/** One rail mark: a loaded turn scrolls to its row; an unloaded one pages history through its seq first. */
export type TurnRailItem = {
  readonly turn: number;
  /** Bounded prompt preview (loaded window first, outline fallback). */
  readonly prompt: string;
  /** Bounded response preview (loaded window first, outline fallback). */
  readonly response: string;
  /** How the rail reaches the turn. */
  readonly anchor:
    | { readonly kind: "loaded"; readonly seq: number }
    | { readonly kind: "unloaded"; readonly seq: number };
};

/** One wire `turnOutline` entry, structurally narrowed like the official client. */
export type TurnOutlineEntry = {
  readonly turn: number;
  readonly seq: number;
  readonly prompt: string;
  readonly response: string;
};

/** Shared frozen empty ladder (stable identity for memo consumers). */
export const EMPTY_RAIL_ITEMS: readonly TurnRailItem[] = Object.freeze([]);

/** Join rendered text, collapse whitespace, and cap at `limit` with an ellipsis. */
export function railPreview(text: string, limit: number): string {
  if (text === "") return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length > limit - 1) {
    return `${normalized.slice(0, limit - 1).trimEnd()}…`;
  }
  return normalized;
}

/** Narrow one wire outline entry; malformed previews degrade to "" and keep the turn navigable. */
export function outlineEntry(value: unknown): TurnOutlineEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.turn !== "number" || !Number.isSafeInteger(entry.turn) || entry.turn < 0) return undefined;
  const seq = entry.seq;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || Object.is(seq, -0)) return undefined;
  return {
    turn: entry.turn,
    seq,
    prompt: typeof entry.prompt === "string" ? entry.prompt : "",
    response: typeof entry.response === "string" ? entry.response : "",
  };
}

/** Wire outline entries, or none when the projection is absent or malformed. */
function outlineEntries(outline: unknown): readonly TurnOutlineEntry[] {
  if (!Array.isArray(outline)) return EMPTY_OUTLINE_ENTRIES;
  const narrowed = outline.map(outlineEntry).filter((entry): entry is TurnOutlineEntry => entry !== undefined);
  return narrowed;
}

const EMPTY_OUTLINE_ENTRIES: readonly TurnOutlineEntry[] = Object.freeze([]);

/** Text blocks of one user message event (injected context is not a prompt). */
function userPromptText(entry: DshHistoryEntry): string {
  const event = entry.event;
  if (event.type !== "user/message" || isInjectedMessage(event)) return "";
  const content = Array.isArray(event.data?.content) ? event.data.content : undefined;
  if (content === undefined) return "";
  const text = contentSegments(content).text;
  return railPreview(text, TURN_PROMPT_PREVIEW_LIMIT);
}

/** Text blocks of one assistant message event. */
function assistantResponseText(entry: DshHistoryEntry): string {
  const event = entry.event;
  if (event.type !== "assistant/message") return "";
  const content = assistantContent(event);
  const text = contentSegments(content).text;
  return railPreview(text, TURN_RESPONSE_PREVIEW_LIMIT);
}

/** Earliest seq of one loaded display entry (raw ranges first, event seq fallback). */
function entryStartSeq(entry: DshHistoryEntry): number {
  const ranges = entry.compactedEventSeqRanges ?? entry.event?.compactedEventSeqRanges;
  const first = Array.isArray(ranges) ? ranges[0] : undefined;
  if (Array.isArray(first) && typeof first[0] === "number") return first[0];
  return entry.displayFirstChunkSeq ?? entry.event?.seq ?? 0;
}

/** One loaded turn's derived rail facts (window previews win; anchor is its earliest seq). */
export type LoadedTurnFacts = {
  readonly turn: number;
  readonly prompt: string;
  readonly response: string;
  readonly seq: number;
};

/** Derive per-turn rail facts from the loaded display window. */
export function loadedTurnFacts(entries: readonly DshHistoryEntry[]): readonly LoadedTurnFacts[] {
  const coordinatesOf = (event: DshHistoryEntry["event"]): { turn: number } | undefined => {
    const message = event.data?.message;
    const turn = numberValue(event.data?.turn)
      ?? numberValue(message && typeof message === "object" ? (message as Record<string, unknown>).turn : undefined);
    return turn === undefined ? undefined : { turn };
  };
  const byTurn = new Map<number, { prompt: string; response: string; seq: number }>();
  // History pages arrive newest-first; sort ascending so the first user text
  // per turn is the opening prompt and the last assistant text is final.
  const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq);
  for (const entry of sorted) {
    const coordinates = coordinatesOf(entry.event);
    if (coordinates === undefined) continue;
    const { turn } = coordinates;
    const current = byTurn.get(turn) ?? { prompt: "", response: "", seq: entryStartSeq(entry) };
    const prompt = userPromptText(entry);
    if (prompt !== "" && current.prompt === "") current.prompt = prompt;
    const response = assistantResponseText(entry);
    if (response !== "") current.response = response;
    if (entryStartSeq(entry) < current.seq) current.seq = entryStartSeq(entry);
    byTurn.set(turn, current);
  }
  return [...byTurn.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([turn, facts]) => ({ turn, ...facts }));
}

/**
 * Merge loaded-window facts with the wire outline into the full ladder.
 * A turn on both sides keeps the loaded anchor and window previews, taking an
 * outline preview only where the window's own is empty; outline-only turns
 * (outside the paged window) become unloaded marks. Result ascends by turn.
 */
export function mergeTurnRailItems(
  loaded: readonly LoadedTurnFacts[],
  outline: unknown,
): readonly TurnRailItem[] {
  const byTurn = new Map<number, TurnRailItem>();
  for (const entry of outlineEntries(outline)) {
    byTurn.set(entry.turn, {
      turn: entry.turn,
      prompt: entry.prompt,
      response: entry.response,
      anchor: { kind: "unloaded", seq: entry.seq },
    });
  }
  for (const facts of loaded) {
    const existing = byTurn.get(facts.turn);
    // Loaded-window previews win (they reflect the actual page); the outline
    // only fills previews the window cannot supply (a mid-turn window head,
    // or a loaded turn whose events carry no text).
    const prompt = facts.prompt !== "" ? facts.prompt : (existing?.prompt ?? "");
    const response = facts.response !== "" ? facts.response : (existing?.response ?? "");
    byTurn.set(facts.turn, {
      turn: facts.turn,
      prompt,
      response,
      anchor: { kind: "loaded", seq: facts.seq },
    });
  }
  if (loaded.length === 0 && (typeof outline !== "object" || outline === null || !Array.isArray(outline))) {
    return EMPTY_RAIL_ITEMS;
  }
  return [...byTurn.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, item]) => item);
}
