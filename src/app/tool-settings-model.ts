import type { DshMcpServerConfig, DshMcpValueBinding } from "../lib/desktop";

export const DEFAULT_MCP_RECONNECT = {
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
} as const;

/** Create one disabled MCP draft so adding it never launches code before Save. */
export function createMcpServerDraft(existing: readonly DshMcpServerConfig[]): DshMcpServerConfig {
  let suffix = existing.length + 1;
  let id = `server-${suffix}`;
  let serverName = id;
  const ids = new Set(existing.map((server) => server.id));
  const serverNames = new Set(existing.map((server) => server.serverName));
  while (ids.has(id) || serverNames.has(serverName)) {
    suffix += 1;
    id = `server-${suffix}`;
    serverName = id;
  }
  return {
    id,
    serverName,
    transport: "stdio",
    enabled: false,
    command: "npx",
    args: [],
    cwd: "",
    env: [],
    toolCallTimeoutMs: 60_000,
    reconnect: { ...DEFAULT_MCP_RECONNECT },
  };
}

/** Create one blank MCP environment/header binding row. */
export function createMcpBinding(): DshMcpValueBinding {
  return { name: "", source: "env", value: "", prefix: "" };
}

/** Convert a line-oriented argument editor to exact argv entries.
 *
 * Interior blank lines represent empty-string argv entries. A single trailing
 * newline is treated as the editor's line terminator; `formatMcpArgs` emits one
 * additional newline when the final argv entry is intentionally empty.
 */
export function parseMcpArgs(value: string): string[] {
  const normalized = value.replaceAll("\r\n", "\n");
  if (normalized.length === 0) return [];
  const argumentsList = normalized.split("\n");
  if (argumentsList.at(-1) === "") argumentsList.pop();
  return argumentsList;
}

/** Convert argv entries to the line-oriented editor representation. */
export function formatMcpArgs(args: readonly string[] | undefined): string {
  const values = args ?? [];
  if (values.length === 0) return "";
  const formatted = values.join("\n");
  return values.at(-1) === "" ? `${formatted}\n` : formatted;
}

/** Switch transport without throwing away the other transport's local draft. */
export function withMcpTransport(server: DshMcpServerConfig, transport: DshMcpServerConfig["transport"]): DshMcpServerConfig {
  if (transport === "stdio") {
    return {
      ...server,
      transport,
      command: server.command || "npx",
      args: server.args ?? [],
      cwd: server.cwd ?? "",
      env: server.env ?? [],
      reconnect: { ...server.reconnect },
    };
  }
  return {
    ...server,
    transport,
    url: server.url || "http://localhost:3000/mcp",
    headers: server.headers ?? [],
    reconnect: { ...server.reconnect },
  };
}

export type McpDraftIssue =
  | "id"
  | "duplicate-id"
  | "server-name"
  | "duplicate-server-name"
  | "command"
  | "url"
  | "timeout"
  | "reconnect"
  | "binding-name"
  | "binding-value"
  | "duplicate-binding";

/** Return the first client-side validation issue; the Bridge remains authoritative. */
export function mcpDraftIssue(servers: readonly DshMcpServerConfig[]): McpDraftIssue | null {
  const ids = new Set<string>();
  const serverNames = new Set<string>();
  for (const server of servers) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(server.id)) return "id";
    if (ids.has(server.id)) return "duplicate-id";
    ids.add(server.id);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.serverName)) return "server-name";
    if (serverNames.has(server.serverName)) return "duplicate-server-name";
    serverNames.add(server.serverName);
    if (server.transport === "stdio" && !server.command?.trim()) return "command";
    if (server.transport === "streamable-http") {
      try {
        const url = new URL(server.url ?? "");
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return "url";
      } catch {
        return "url";
      }
    }
    if (!Number.isInteger(server.toolCallTimeoutMs) || server.toolCallTimeoutMs < 100 || server.toolCallTimeoutMs > 300_000) return "timeout";
    if (!Number.isInteger(server.reconnect.initialDelayMs)
      || !Number.isInteger(server.reconnect.maxDelayMs)
      || !Number.isInteger(server.reconnect.maxAttempts)
      || server.reconnect.initialDelayMs < 1
      || server.reconnect.maxDelayMs < server.reconnect.initialDelayMs
      || server.reconnect.maxDelayMs > 300_000
      || server.reconnect.maxAttempts < 1
      || server.reconnect.maxAttempts > 100) return "reconnect";
    const bindings = server.transport === "stdio" ? server.env ?? [] : server.headers ?? [];
    const bindingNames = new Set<string>();
    for (const binding of bindings) {
      const nameValid = server.transport === "stdio"
        ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.name)
        : /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(binding.name);
      if (!nameValid) return "binding-name";
      const canonicalName = server.transport === "stdio" ? binding.name : binding.name.toLowerCase();
      if (bindingNames.has(canonicalName)) return "duplicate-binding";
      bindingNames.add(canonicalName);
      if (binding.redacted !== undefined && typeof binding.redacted !== "boolean") return "binding-value";
      if (binding.clearSecret !== undefined && typeof binding.clearSecret !== "boolean") return "binding-value";
      const bindingValue = typeof binding.value === "string" ? binding.value : "";
      if (binding.clearSecret === true) {
        if (binding.source !== "literal" || (binding.redacted !== undefined && binding.redacted !== true) || bindingValue !== "") return "binding-value";
        continue;
      }
      if (binding.source === "literal" && binding.redacted === true && bindingValue === "") continue;
      if (!bindingValue.trim()) return "binding-value";
      if (binding.source === "env" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(bindingValue)) return "binding-value";
    }
  }
  return null;
}

/** Stable dirty comparison for already-normalized Bridge projections. */
export function mcpDraftDirty(saved: readonly DshMcpServerConfig[], draft: readonly DshMcpServerConfig[]): boolean {
  return JSON.stringify(saved) !== JSON.stringify(draft);
}
