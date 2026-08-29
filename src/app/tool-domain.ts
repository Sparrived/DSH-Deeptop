import type { DshHistoryEntry } from "../lib/desktop";

/**
 * Tool-domain card projection from the official `tool/call` / `tool/result`
 * presentation views (`entry.view`).
 *
 * The api-proxy renders each tool's `presentCall` / `presentResult` into the
 * view envelope `{ for: 'call'|'result', view }`. The desktop renders domain
 * cards from the fields those presenters emit (search sources, fetch target,
 * skill load), while every other tool falls back to the generic call/result
 * display. This module is a pure narrow of that wire shape.
 */

export type ToolDomainCard =
  | {
    domain: "search";
    query: string;
    sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>;
    truncated?: boolean;
    answer?: string;
  }
  | {
    domain: "fetch";
    title: string;
    url?: string;
    statusCode?: number;
    truncated?: boolean;
  }
  | {
    domain: "skill";
    name: string;
  };

/** Search and fetch cards are completed tool output; skill cards explain call input. */
export function isResultDomainCard(card: ToolDomainCard | undefined): card is Exclude<ToolDomainCard, { domain: "skill" }> {
  return card?.domain === "search" || card?.domain === "fetch";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  const field = isRecord(value) ? value[key] : undefined;
  return typeof field === "string" && field.trim() ? field : undefined;
}

function isSource(value: unknown): value is { url: string; title?: string; snippet?: string; publishedAt?: string } {
  if (!isRecord(value)) return false;
  return typeof value.url === "string" && value.url.trim().length > 0;
}

/**
 * Narrow one tool event's presentation view into a domain card.
 * Returns undefined when the view is absent, malformed, or lacks an official
 * domain presenter — the caller keeps the generic tool display.
 */
export function toolDomainCard(entry: DshHistoryEntry): ToolDomainCard | undefined {
  const envelope = isRecord(entry.view) ? entry.view : undefined;
  const view = envelope ? (isRecord(envelope.view) ? envelope.view : undefined) : undefined;
  if (!view) return undefined;

  if (view.card === "web" && view.kind === "search") {
    const sources = Array.isArray(view.sources) ? view.sources.filter(isSource) : [];
    const query = stringField(view, "title") ?? "";
    const answer = stringField(view, "answer");
    const truncated = view.truncated === true;
    if (query || sources.length > 0) {
      return {
        domain: "search",
        query,
        sources,
        ...(truncated ? { truncated } : {}),
        ...(answer ? { answer } : {}),
      };
    }
  }

  if (view.card === "web" && view.kind === "fetch") {
    const title = stringField(view, "title") ?? stringField(view, "url") ?? "";
    const url = stringField(view, "url");
    const statusCode = typeof view.statusCode === "number" ? view.statusCode : undefined;
    const truncated = view.truncated === true;
    if (title) {
      return {
        domain: "fetch",
        title,
        ...(url ? { url } : {}),
        ...(statusCode === undefined ? {} : { statusCode }),
        ...(truncated ? { truncated } : {}),
      };
    }
  }

  // The skill tool's pending card carries `kind: 'read'` and a "Load skill …"
  // title; loading injects instructions, so only the call side gets a card.
  if ((view.card === "generic" || view.card === undefined) && view.kind === "read") {
    const title = stringField(view, "title") ?? "";
    const match = /^Load skill (.+)$/.exec(title);
    if (match?.[1]) return { domain: "skill", name: match[1] };
  }

  return undefined;
}