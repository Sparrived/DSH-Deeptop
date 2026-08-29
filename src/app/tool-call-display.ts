/** Parsed tool-call arguments and the display family their stable names imply. */
export type ToolArgsObject = Record<string, unknown>;

export type ToolArgsLayout = "terminal" | "file" | "web" | "delegation" | "generic";

type ToolArgsProfile = {
  layout: ToolArgsLayout;
  /** Fields users identify first for this stable tool family. */
  order: string[];
  primary: string[];
  /** Brief call-bar fallback when the model did not supply `description`. */
  summary: string[];
};

const TERMINAL_TOOLS = new Set(["bash", "pwsh", "shell", "powershell"]);
const FILE_TOOLS = new Set(["read", "read_image", "write", "edit", "glob", "grep", "str_replace_editor"]);
const WEB_TOOLS = new Set(["web_search", "web_fetch", "websearch", "webfetch"]);
const DELEGATION_TOOLS = new Set(["subagent", "subagent_fork", "workflow", "ralph"]);
const FALLBACK_SUMMARY_FIELDS = ["file_path", "path", "url", "command", "query", "prompt", "objective", "pattern", "name", "id"];
const SUMMARY_MAX_CHARS = 180;

const TOOL_ARG_PROFILES: Record<string, ToolArgsProfile> = {
  bash: { layout: "terminal", order: ["command", "workdir", "timeoutMs", "run_in_background", "sandbox_permissions", "justification"], primary: ["command"], summary: ["command"] },
  pwsh: { layout: "terminal", order: ["command", "workdir", "timeoutMs", "run_in_background", "sandbox_permissions", "justification"], primary: ["command"], summary: ["command"] },
  read: { layout: "file", order: ["file_path", "offset", "limit"], primary: ["file_path"], summary: ["file_path"] },
  read_image: { layout: "file", order: ["file_path"], primary: ["file_path"], summary: ["file_path"] },
  write: { layout: "file", order: ["file_path", "content", "sandbox_permissions", "justification"], primary: ["file_path"], summary: ["file_path"] },
  edit: { layout: "file", order: ["file_path", "old_string", "new_string", "replace_all", "sandbox_permissions", "justification"], primary: ["file_path"], summary: ["file_path"] },
  str_replace_editor: { layout: "file", order: ["command", "path", "old_str", "new_str", "insert_line", "view_range"], primary: ["path", "command"], summary: ["path", "command"] },
  glob: { layout: "file", order: ["pattern", "path"], primary: ["pattern"], summary: ["pattern", "path"] },
  grep: { layout: "file", order: ["pattern", "path", "include"], primary: ["pattern"], summary: ["pattern", "path"] },
  web_search: { layout: "web", order: ["queries"], primary: ["queries"], summary: ["queries"] },
  web_fetch: { layout: "web", order: ["url"], primary: ["url"], summary: ["url"] },
  subagent: { layout: "delegation", order: ["prompt", "run_in_background"], primary: ["prompt"], summary: ["prompt"] },
  subagent_fork: { layout: "delegation", order: ["prompt", "run_in_background"], primary: ["prompt"], summary: ["prompt"] },
  workflow: { layout: "delegation", order: ["meta", "script"], primary: ["meta"], summary: ["meta"] },
  ralph: { layout: "delegation", order: ["objective", "maxRounds"], primary: ["objective"], summary: ["objective"] },
  skill: { layout: "generic", order: ["name"], primary: ["name"], summary: ["name"] },
  job_output: { layout: "generic", order: ["job_id", "timeout_ms"], primary: ["job_id"], summary: ["job_id"] },
  job_kill: { layout: "generic", order: ["job_id", "reason"], primary: ["job_id"], summary: ["job_id"] },
  create_goal: { layout: "delegation", order: ["objective", "max_goal_rounds"], primary: ["objective"], summary: ["objective"] },
  update_goal: { layout: "generic", order: ["action", "goal_id", "objective"], primary: ["action"], summary: ["objective", "action", "goal_id"] },
  todo_write: { layout: "generic", order: ["todos"], primary: ["todos"], summary: ["todos"] },
  ask_user_question: { layout: "generic", order: ["questions"], primary: ["questions"], summary: ["questions"] },
};

function isPlainObject(value: unknown): value is ToolArgsObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the durable JSON argument string, including one JSON-string wrapper. */
export function parseToolArgs(text: string): ToolArgsObject | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (isPlainObject(parsed)) return parsed;
    if (typeof parsed === "string") {
      const inner = JSON.parse(parsed);
      if (isPlainObject(inner)) return inner;
    }
  } catch {
    // Non-JSON arguments retain their raw fallback in the renderer.
  }
  return undefined;
}

/** Return the model-supplied one-line call description when present. */
export function toolCallDescription(args: ToolArgsObject | undefined): string | undefined {
  const description = args?.description;
  return typeof description === "string" && description.trim() ? description.trim() : undefined;
}

function singleLine(value: string) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > SUMMARY_MAX_CHARS ? `${normalized.slice(0, SUMMARY_MAX_CHARS)}…` : normalized;
}

function summaryValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return singleLine(value);
  if (Array.isArray(value)) {
    const values = value.map(summaryValue).filter((item): item is string => Boolean(item));
    if (values.length === 0) return undefined;
    const summary = values.slice(0, 2).join(" · ");
    return values.length > 2 ? `${summary} · …` : summary;
  }
  if (isPlainObject(value)) {
    for (const key of ["description", "question", "content", "name", "title", "objective", "label", "path", "url", "id"]) {
      const nested = summaryValue(value[key]);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Summarise the intent of one call. Model-provided `description` always wins;
 * otherwise the registered tool profile or a conservative semantic whitelist
 * supplies one short field without exposing arbitrary argument values.
 */
export function toolCallSummary(toolName: string | undefined, args: ToolArgsObject | undefined): string | undefined {
  const description = toolCallDescription(args);
  if (description) return description;
  if (!args) return undefined;
  const profile = TOOL_ARG_PROFILES[normalizedToolName(toolName)];
  const fields = profile?.summary ?? FALLBACK_SUMMARY_FIELDS;
  for (const key of fields) {
    const summary = summaryValue(args[key]);
    if (summary) return summary;
  }
  return undefined;
}

/** Remove the summary-only description from the expanded parameter rows. */
export function visibleToolArguments(args: ToolArgsObject): Array<[string, unknown]> {
  return Object.entries(args).filter(([key, value]) => key !== "description" || typeof value !== "string");
}

/**
 * Choose a compact arrangement only for tool families with stable argument
 * meanings. Unknown and extension tools remain losslessly readable as rows.
 */
function normalizedToolName(toolName: string | undefined) {
  return toolName?.trim().toLowerCase() ?? "";
}

export function toolArgsLayout(toolName: string | undefined, args: ToolArgsObject): ToolArgsLayout {
  const normalized = normalizedToolName(toolName);
  const profile = TOOL_ARG_PROFILES[normalized];
  if (profile) return profile.layout;
  if (TERMINAL_TOOLS.has(normalized) || normalized.startsWith("terminal_")) return "terminal";
  if (FILE_TOOLS.has(normalized)) return "file";
  if (WEB_TOOLS.has(normalized)) return "web";
  if (DELEGATION_TOOLS.has(normalized)) return "delegation";

  if (typeof args.command === "string" || typeof args.shellCommand === "string") return "terminal";
  if (typeof args.file_path === "string" || typeof args.filePath === "string") return "file";
  if (typeof args.url === "string" && normalized.startsWith("web")) return "web";
  return "generic";
}

/** Whether a stable tool profile promotes this argument into its primary panel. */
export function isPrimaryToolArgument(toolName: string | undefined, key: string): boolean {
  return TOOL_ARG_PROFILES[normalizedToolName(toolName)]?.primary.includes(key) ?? false;
}

/** Order stable tool arguments without dropping unrecognised extension fields. */
export function orderedToolArguments(toolName: string | undefined, args: ToolArgsObject): Array<[string, unknown]> {
  const entries = visibleToolArguments(args);
  const profile = TOOL_ARG_PROFILES[normalizedToolName(toolName)];
  if (!profile) return entries;
  const rank = new Map(profile.order.map((key, index) => [key, index]));
  return [...entries].sort(([left], [right]) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER));
}
