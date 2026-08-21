// Error normalization for the desktop UI runtime. Plugin failures must never
// surface as raw exceptions into React rendering or crash the host app; they
// become diagnosable records with stable codes.

import { UiPluginErrorCode, type UiPluginErrorCodeValue } from "../../app/ui-plugin-model.ts";

export interface NormalizedPluginError {
  pluginId: string | null;
  slot: string | null;
  contributionId: string | null;
  code: UiPluginErrorCodeValue | "plugin-render-error" | "unknown";
  message: string;
}

/** Read a stable wire code off an Error produced by the bridge (or local checks). */
export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/** Normalize any thrown value into a bounded diagnostic record. */
export function normalizePluginError(
  error: unknown,
  context: { pluginId?: string | null; slot?: string | null; contributionId?: string | null } = {},
): NormalizedPluginError {
  const code = errorCodeOf(error);
  const knownCodes = new Set<string>(Object.values(UiPluginErrorCode));
  return {
    pluginId: context.pluginId ?? null,
    slot: context.slot ?? null,
    contributionId: context.contributionId ?? null,
    code: knownCodes.has(code ?? "") ? (code as UiPluginErrorCodeValue)
      : code === "plugin-render-error" ? "plugin-render-error"
      : "unknown",
    message: errorMessageOf(error),
  };
}

export class PluginLoadError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PluginLoadError";
    this.code = code;
  }
}
