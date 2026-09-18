/** Parsed tool-call arguments and the display family their stable names imply. */
export type ToolArgsObject = Record<string, unknown>;

export type ToolArgsLayout = "terminal" | "file" | "web" | "delegation" | "generic";

/** 工具行左侧图标表达的语义；颜色仍由调用状态决定，与字形无关。 */
export type ToolGlyphKind =
  | "terminal"
  | "read"
  | "image"
  | "write"
  | "edit"
  | "search"
  | "find"
  | "web"
  | "fetch"
  | "delegate"
  | "workflow"
  | "repeat"
  | "goal"
  | "todo"
  | "question"
  | "skill"
  | "job"
  | "deliver"
  | "message"
  | "agent"
  | "session"
  | "code"
  | "plugin"
  | "generic";

/** Minimal call-side diff rendered for an edit before its result metadata arrives. */
export type ToolCallEditDiff = {
  path: string;
  oldText: string;
  newText: string;
};

export type ToolTodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

/** One option of an `ask_user_question` question, as the model asked it. */
export type ToolQuestionOption = {
  label: string;
  description?: string;
};

/** One `ask_user_question` question, narrowed from the durable arguments. */
export type ToolQuestion = {
  id: string;
  question: string;
  header?: string;
  options?: ToolQuestionOption[];
  multiSelect?: boolean;
};

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
/** 从参数里的 1-based `offset` 推出定位行的读取类工具。 */
const READ_TOOLS = new Set(["read", "read_file", "readfile", "view"]);
const FALLBACK_SUMMARY_FIELDS = ["file_path", "path", "url", "command", "query", "prompt", "objective", "pattern", "name", "id"];
const SUMMARY_MAX_CHARS = 180;

const MCP_TOOL_NAME_PATTERN = /^mcp__(.+?)__(.+)$/u;

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
  write_todo: { layout: "generic", order: ["todos"], primary: ["todos"], summary: ["todos"] },
  ask_user_question: { layout: "generic", order: ["questions"], primary: ["questions"], summary: ["questions"] },
};

function isPlainObject(value: unknown): value is ToolArgsObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow a todo_write value to the status-and-content rows its schema guarantees. */
export function toolTodoItems(value: unknown): ToolTodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const todos = value.map((item) => {
    if (!isPlainObject(item) || typeof item.content !== "string") return undefined;
    const content = item.content.trim();
    const status = item.status;
    return content && (status === "pending" || status === "in_progress" || status === "completed")
      ? { content, status }
      : undefined;
  });
  return todos.every((item): item is ToolTodoItem => item !== undefined) ? todos : undefined;
}

/**
 * Narrow every option of one `ask_user_question` question.
 *
 * `undefined` marks the option list as unusable; the caller reads it against the
 * declared argument, so a malformed option never silently becomes "no options".
 */
function toolQuestionOptions(value: unknown[]): ToolQuestionOption[] | undefined {
  const options = value.map((item) => {
    if (!isPlainObject(item) || typeof item.label !== "string" || !item.label.trim()) return undefined;
    const description = typeof item.description === "string" && item.description.trim() ? item.description.trim() : undefined;
    return { label: item.label.trim(), ...(description === undefined ? {} : { description }) };
  });
  return options.every((option): option is ToolQuestionOption => option !== undefined) ? options : undefined;
}

/**
 * Narrow `ask_user_question` arguments into the questions the card renders.
 *
 * The model-facing arguments are the only place the asked text exists, so a card
 * that reads them as a generic list hides the one thing the row is about. A
 * member that does not match the declared schema abandons the whole list: a
 * partially understood batch would silently drop a question the user was asked.
 */
export function toolQuestionItems(value: unknown): ToolQuestion[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const questions = value.map((item): ToolQuestion | undefined => {
    if (!isPlainObject(item)) return undefined;
    const { id, question } = item;
    if (typeof id !== "string" || !id.trim() || typeof question !== "string" || !question.trim()) return undefined;
    const header = typeof item.header === "string" && item.header.trim() ? item.header.trim() : undefined;
    const declared = item.options;
    // 空选项列表等于「没有选项」；形状不对的选项放弃整批，而不是把选项悄悄丢掉。
    let options: ToolQuestionOption[] | undefined;
    if (Array.isArray(declared) && declared.length > 0) {
      options = toolQuestionOptions(declared);
      if (options === undefined) return undefined;
    } else if (declared !== undefined && !Array.isArray(declared)) {
      return undefined;
    }
    const multiSelect = item.multi_select === true;
    return {
      id: id.trim(),
      question: question.trim(),
      ...(header === undefined ? {} : { header }),
      ...(options === undefined ? {} : { options }),
      ...(multiSelect ? { multiSelect } : {}),
    };
  });
  return questions.every((item): item is ToolQuestion => item !== undefined) ? questions : undefined;
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

/**
 * Construct the call-side edit hunk from durable arguments. The result-side
 * diff still takes precedence once the tool persists its applied metadata.
 */
export function toolCallEditDiff(toolName: string | undefined, args: ToolArgsObject): ToolCallEditDiff | undefined {
  if (normalizedToolName(toolName) !== "edit") return undefined;
  const { file_path: path, old_string: oldText, new_string: newText } = args;
  return typeof path === "string" && path.trim() && typeof oldText === "string" && typeof newText === "string"
    ? { path, oldText, newText }
    : undefined;
}

/** Whether a parsed call still has input worth rendering below its call header. */
export function hasVisibleToolArguments(toolName: string | undefined, args: ToolArgsObject | undefined): boolean {
  return args !== undefined && visibleToolArguments(toolName, args).length > 0;
}

/** Remove summary-only and edit-diff fields from the default parameter rows. */
export function visibleToolArguments(toolName: string | undefined, args: ToolArgsObject): Array<[string, unknown]> {
  const hidden = toolCallEditDiff(toolName, args)
    ? new Set(["description", "old_string", "new_string"])
    : new Set(["description"]);
  return Object.entries(args).filter(([key, value]) => !hidden.has(key) || (key === "description" && typeof value !== "string"));
}

/**
 * Format MCP's internal server/tool name for user-facing surfaces.
 *
 * Runtime registration keeps `mcp__<server>__<tool>` for uniqueness. The UI
 * drops that transport prefix and uses a plain text separator instead.
 *
 * @param toolName - The runtime or ordinary tool name.
 * @returns The name intended for user-facing display.
 */
export function displayToolName(toolName: string | undefined): string {
  const value = toolName?.trim() ?? "";
  const match = MCP_TOOL_NAME_PATTERN.exec(value);
  return match ? `${match[1]} · ${match[2]}` : value;
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

/**
 * 稳定工具名到字形语义的映射。
 *
 * 字形只说明“这次调用在做什么”，与结果无关：同一次 read 在运行、成功、失败时
 * 保持同一个字形，只有颜色随状态变化。未列出的工具按前缀归族，最后落到通用扳手，
 * 因此新增 DSH 工具不会画出空白图标。
 */
const TOOL_GLYPH_BY_NAME: Record<string, ToolGlyphKind> = {
  bash: "terminal",
  pwsh: "terminal",
  shell: "terminal",
  powershell: "terminal",
  read: "read",
  read_file: "read",
  readfile: "read",
  view: "read",
  read_image: "image",
  write: "write",
  edit: "edit",
  str_replace_editor: "edit",
  glob: "find",
  grep: "search",
  web_search: "web",
  websearch: "web",
  web_fetch: "fetch",
  webfetch: "fetch",
  subagent: "delegate",
  subagent_fork: "delegate",
  spawn_teammate: "delegate",
  workflow: "workflow",
  ralph: "repeat",
  get_goal: "goal",
  create_goal: "goal",
  update_goal: "goal",
  todo_write: "todo",
  write_todo: "todo",
  team_task_create: "todo",
  team_task_list: "todo",
  team_task_get: "todo",
  team_task_update: "todo",
  ask_user_question: "question",
  skill: "skill",
  skill_install: "skill",
  present: "deliver",
  send_message: "message",
  list_agents: "agent",
  wait_agent: "agent",
  interrupt_agent: "agent",
  lsp: "code",
};

/** 前缀归族：这些家族的名字是开放的（terminal_open、job_kill、cordis_define…）。 */
const TOOL_GLYPH_BY_PREFIX: Array<[string, ToolGlyphKind]> = [
  ["terminal_", "terminal"],
  ["job_", "job"],
  ["session_", "session"],
  ["cordis_", "plugin"],
];

/**
 * Resolve the semantic glyph for one tool name.
 *
 * MCP 工具先看内层工具名（`mcp__vendor__read` 仍画读取字形），认不出来才按扩展
 * 工具画插头，这样远程工具不会一律退化成通用图标。
 */
export function toolGlyphKind(toolName: string | undefined): ToolGlyphKind {
  const normalized = normalizedToolName(toolName);
  if (!normalized) return "generic";
  const known = TOOL_GLYPH_BY_NAME[normalized];
  if (known) return known;
  const mcpMatch = MCP_TOOL_NAME_PATTERN.exec(normalized);
  if (mcpMatch) return TOOL_GLYPH_BY_NAME[mcpMatch[2]] ?? "plugin";
  for (const [prefix, kind] of TOOL_GLYPH_BY_PREFIX) {
    if (normalized.startsWith(prefix)) return kind;
  }
  return "generic";
}

/** Whether a stable tool profile promotes this argument into its primary panel. */
export function isPrimaryToolArgument(toolName: string | undefined, key: string): boolean {
  return TOOL_ARG_PROFILES[normalizedToolName(toolName)]?.primary.includes(key) ?? false;
}

/**
 * 读取类工具要定位到的 1-based 行号。
 *
 * 上游从 read 调用的 `offset` 推出定位行，Deeptop 沿用同一约定：read 工具的
 * `offset` 本身就是 1-based 起始行，因此点击工具行里的路径可以直接在右栏把
 * 文件展开到那一行——即使读取结果尚未落盘也成立，因为行号只依赖调用参数。
 */
export function toolCallOpenLine(toolName: string | undefined, args: ToolArgsObject | undefined): number | undefined {
  if (!args) return undefined;
  if (!READ_TOOLS.has(normalizedToolName(toolName))) return undefined;
  const offset = args.offset;
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 1) return undefined;
  return Math.floor(offset);
}

/** Order stable tool arguments without dropping unrecognised extension fields. */
export function orderedToolArguments(toolName: string | undefined, args: ToolArgsObject): Array<[string, unknown]> {
  const entries = visibleToolArguments(toolName, args);
  const profile = TOOL_ARG_PROFILES[normalizedToolName(toolName)];
  if (!profile) return entries;
  const rank = new Map(profile.order.map((key, index) => [key, index]));
  return [...entries].sort(([left], [right]) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER));
}
