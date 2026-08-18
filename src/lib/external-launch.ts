export interface ExternalLaunchRequest {
  paths: string[];
  cwd: string;
  source: string;
}

/** 校验并规范化 Rust desktop bridge 发来的外部启动协议。 */
export function parseExternalLaunchPayload(value: unknown): ExternalLaunchRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.paths) || payload.paths.length === 0 || typeof payload.cwd !== "string" || !payload.cwd.trim()) return null;
  const paths = payload.paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0);
  if (paths.length !== payload.paths.length) return null;
  return {
    paths,
    cwd: payload.cwd,
    source: typeof payload.source === "string" && payload.source.trim() ? payload.source : "command-line",
  };
}

export function externalLaunchKey(request: ExternalLaunchRequest): string {
  return request.paths.join("\u0000");
}
