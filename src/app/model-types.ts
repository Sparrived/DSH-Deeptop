import type {
  DshHistoryEntry,
  DshQuestion,
  DshSessionModels,
  DshSessionSummary,
  DshSubagentAddress,
  DshSubagentCatalog,
} from "../lib/desktop";
import type { ToolDomainCard } from "./tool-domain";
import type { PtcProgram } from "./ptc-program";

export type PromptMode = "queue" | "steer";
export type ModelMenuPane = "root" | "model";
export type ModelSelection = { provider: string; model: string; reasoningEffort?: string };
export type WindowMenu = "project" | "edit";
export type SessionAction = "rename" | "fork" | "archive" | "export" | "exportZip" | "pin";
export type WorkspaceViewMode = "grouped" | "flat";
export type ThemeMode = "system" | "light" | "dark";
/** 主题 id：`monokai-pro` / `one-dark` / `gov` 等内置主题，或 `themesDir/` 下用户放入的自定义文件名（去后缀）。`custom` 表示"使用自定义外部 CSS 路径"。 */
export type AppTheme = string;

/** 背景图作用区域：全局 / 标题栏 / 侧栏 / 对话栏 / 对话框 / 工具面板。 */
export type BackgroundZone = "global" | "windowbar" | "sidebar" | "conversation" | "composer" | "dock";

/** 单个背景区域的配置。image 为空字符串表示该区域不设置背景图。 */
export type BackgroundConfig = {
  image: string;
  name: string;
  /** 本区域背景图自身的透明度（0.05–0.45）。 */
  opacity: number;
  /** 本区域面板表面不透明度（0–100%）。即使没有背景图也生效，控制底层背景透过面板的程度。 */
  panelOpacity: number;
  blur: number;
  size: "cover" | "contain";
  position: "center" | "top" | "bottom" | "left" | "right";
};

/** 按区域组织的背景图设置集合。 */
export type BackgroundSettings = Record<BackgroundZone, BackgroundConfig>;

export type WorkingIndicatorEffect = "none" | "shimmer" | "pulse" | "glow" | "hidden";

/** 流光的取色方式：渐变用文本色到渐变色的双色扫光，七彩走固定彩虹光谱。 */
export type WorkingIndicatorShimmerStyle = "gradient" | "rainbow";

export type WorkingIndicatorSettings = {
  texts: string[];
  color: string;
  /** 渐变流光的第二色；七彩流光不使用。 */
  gradientColor: string;
  effect: WorkingIndicatorEffect;
  shimmerStyle: WorkingIndicatorShimmerStyle;
  rotationInterval: number;
};

/**
 * 工具行的运行特效。只影响运行中的工具行边缘，不改变字形、状态色或结果内容：
 * - `none` 静态（默认，保持原有外观）
 * - `glow` 边缘发光呼吸
 * - `marquee` 边缘跑马灯（沿边缘循环的光带，颜色与透明度可调）
 * - `ants` 虚线蚂蚁线巡边
 * - `sheen` 斜向扫光掠过整行
 */
export type ToolEffect = "none" | "glow" | "marquee" | "ants" | "sheen";

export type ToolEffectSettings = {
  effect: ToolEffect;
  /** 特效颜色（#rrggbb）：光带、发光与扫光都用它。 */
  color: string;
  /** 特效不透明度（0–1）。 */
  opacity: number;
};

export type AppearanceSettings = {
  fontFamily: string;
  codeFontFamily: string;
  messageFontSize: number;
  messageLineHeight: number;
  /** 流式正文的渐显时长（ms）：每段落笔后多久淡到实心。 */
  streamingFadeDuration: number;
  /** 落笔墨量（0–1）：刚落笔时的起始浓度，1 等于关闭渐显。 */
  streamingFadeInk: number;
  workingIndicator: WorkingIndicatorSettings;
  toolEffect: ToolEffectSettings;
  backgrounds: BackgroundSettings;
  customCss: string;
  customCssName: string;
  customCssEnabled: boolean;
  /** 外部主题 CSS 文件的绝对路径；为空时不加载外部主题（使用内置兜底配色）。 */
  themeCssPath: string;
};

export type SessionContextMenu = { session: DshSessionSummary; x: number; y: number };

export type PendingApproval = {
  rpcId: string;
  sessionId: string;
  approvalId: string;
  toolName: string;
  reason?: string;
};

export type PendingQuestion = {
  rpcId: string;
  sessionId: string;
  questions: DshQuestion[];
};

export type TranscriptItem = {
  key: string;
  kind: "user" | "assistant" | "reasoning" | "tool" | "system" | "workflow" | "deliverables";
  label: string;
  text: string;
  seq?: number;
  /** Earliest raw event seq this row represents (compacted ranges head);
   *  rows are addressable by any seq within `[seqFrom, seq]`. */
  seqFrom?: number;
  messageId?: string;
  /** Original durable user content, retained for lossless retry. */
  content?: unknown;
  time?: number;
  toolName?: string;
  toolCallId?: string;
  toolState?: "call" | "result";
  toolResultText?: string;
  toolResultTime?: number;
  toolResultError?: boolean;
  toolDiff?: DiffSummary;
  toolResultDiff?: DiffSummary;
  /** Official tool-presentation domain card (search/fetch/skill), when emitted. */
  domainCard?: ToolDomainCard;
  /**
   * PTC 执行视图：`run_code` 内部每次子调用的程序位点、耗时与结果。只有 PTC 会话的
   * `run_code` 行带这个字段；原生工具调用没有。
   */
  program?: PtcProgram;
  source?: string;
  contextRole?: "inject" | "recall";
  contextForm?: "instructions" | "catalog" | "snapshot" | "notice" | "relay" | "recall" | null;
  contextSummary?: string;
  injected?: boolean;
  /** True while this reasoning block is still receiving streaming deltas. */
  streaming?: boolean;
  images?: TranscriptImage[];
  /** 用户消息携带的持久化文件附件；DSH 只把它们投影成模型可读的路径句柄。 */
  fileAttachments?: TranscriptFile[];
  stats?: MessageStats;
  workflow?: WorkflowView;
  files?: string[];
  fileDiffs?: Record<string, DeliverableFileDiff>;
};

export type MessageStats = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  uncachedInputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheHitRate?: number;
  runMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
};

export type TokenUsageSource = "projection" | "history" | "none";

export type TokenUsageBreakdown = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;
};

export type TokenUsagePoint = TokenUsageBreakdown & {
  key: string;
  label: string;
  time: number;
  turn?: number;
  step?: number;
  runMs?: number;
  ttftMs?: number;
};

export type TokenUsageDashboardData = {
  totals: TokenUsageBreakdown;
  points: TokenUsagePoint[];
  hasHistoryUsage: boolean;
};

export type SessionActivitySignal = "user" | "assistant" | "tool" | "error";

export type SessionTurnPoint = {
  key: string;
  label: string;
  time: number;
  turn?: number;
  durationMs?: number;
  userMessages: number;
  assistantMessages: number;
  steps: number;
  toolCalls: number;
  toolFailures: number;
  totalTokens: number;
  signals: SessionActivitySignal[];
};

export type SessionDashboardSummary = {
  eventCount: number;
  userMessages: number;
  assistantMessages: number;
  messages: number;
  turns: number;
  steps: number;
  toolCalls: number;
  toolResults: number;
  toolFailures: number;
  firstEventTime?: number;
  lastEventTime?: number;
  elapsedMs: number;
};

export type SessionDashboardData = {
  summary: SessionDashboardSummary;
  turns: SessionTurnPoint[];
  token: TokenUsageDashboardData;
};

/** 轮次的最终结局；`open` 表示历史里还没有对应的 `turn/end`。 */
export type SessionTurnOutcome =
  | "completed"
  | "error"
  | "cancelled"
  | "max-tokens"
  | "blocked"
  | "interrupted"
  | "open";

/** 单个工具的成本画像：调用数、失败数与注入上下文的体积。 */
export type SessionCostToolRow = {
  name: string;
  calls: number;
  errors: number;
  /** 失败率百分比（0–100）；`calls` 为 0 时是 0。 */
  errorRate: number;
  /** 该工具结果文本的 UTF-16 长度总和，用于估算上下文注入量。 */
  resultChars: number;
  /** 调用到结果之间的累计耗时；缺少配对时为 0。 */
  durationMs: number;
};

/** 单轮的结局与实际工作量，用于定位「做完却被丢弃」的轮次。 */
export type SessionCostTurnRow = {
  key: string;
  turn?: number;
  steps: number;
  toolCalls: number;
  toolFailures: number;
  retries: number;
  outcome: SessionTurnOutcome;
  durationMs?: number;
};

/** 被重复执行的同一条 shell 命令。 */
export type SessionCostCommandRow = {
  command: string;
  calls: number;
};

/** 会话成本计量投影。 */
export type SessionCostData = {
  tools: SessionCostToolRow[];
  turns: SessionCostTurnRow[];
  toolCalls: number;
  toolFailures: number;
  toolErrorRate: number;
  /** `llm/retry` 与 `llm/retry-started` 事件总数。 */
  retries: number;
  /** 至少发生过一次重试的 `turn/step` 坐标数，即被重试拖慢的步数。 */
  retriedSteps: number;
  /** 全部工具结果文本的 UTF-16 长度总和。 */
  resultChars: number;
  /** 以 error 结束的轮次数、其中的步数与工具调用数。 */
  wastedTurns: number;
  wastedSteps: number;
  wastedToolCalls: number;
  distinctCommands: number;
  repeatedCommands: SessionCostCommandRow[];
  /** 重复命令的调用总数（含首次）。 */
  repeatedCommandCalls: number;
  /** 重复调用在这些命令中占的比例（0–100）。 */
  repeatedCommandRate: number;
};

export type SubagentSession = {
  address: DshSubagentAddress;
  history: DshHistoryEntry[];
};

export type TranscriptImage = {
  mediaType: string;
  data?: string;
  attachmentId?: string;
  name?: string;
};

export type WorkflowView = {
  name: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  phases: Array<{
    phase: string | null;
    members: Array<{ label: string; childId: string; status: "running" | "completed" | "failed" | "cancelled" | "interrupted" }>;
  }>;
};

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoItem = {
  /** Optional runtime-provided identity for matching successive snapshots. */
  id?: string;
  content: string;
  status: TodoStatus;
  /** Timestamp of the first transition into the active state for this turn. */
  startedAt?: number;
  /** Timestamp at which the task reached the completed state. */
  finishedAt?: number;
};

export type SurfaceTab = "runtime" | "presets" | "skills" | "subagents" | "goal" | "settings";
export type AppearanceSection = "theme" | "background" | "typography" | "css";
/** Built-in settings sections owned by the desktop app. */
export type BuiltinSettingsSection = "appearance" | "dock" | "general" | "keyboard" | "models" | "plugins" | "presets" | "tools" | "logs" | "about";
/**
 * The selected settings section. A plugin panel is addressed by its own
 * composite id (`plugin:<pluginId>:<contributionId>`), which always carries the
 * prefix so it can never collide with a built-in section name.
 */
export type SettingsSection = BuiltinSettingsSection | `plugin:${string}`;

export type SettingsDraft = {
  ns: string;
  value: string;
  revision: number;
  original: unknown;
  secrets: string[][];
  /** Schemastery envelope of the namespace; enables the Schema-driven form. */
  schema?: unknown;
};

export type GoalRef = { id: string; revision: number };
export type DshHostModelCatalog = Pick<DshSessionModels, "groups" | "failures">;

export type DiscoveredModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
};

export type ProviderSettingsPatch = {
  baseURL?: string | null;
  api?: string | null;
  models?: Array<Record<string, unknown>> | null;
};

export type CustomProviderDraft = {
  provider: string;
  displayName: string;
  baseURL: string;
  api: string;
  apiKey: string;
  models: DiscoveredModel[];
  selectedModels: string[];
};

export type ComposerCandidate = {
  kind: "skill" | "command" | "subagent" | "file" | "session";
  id: string;
  label: string;
  detail?: string;
  insertText: string;
};

/** Composer sources opened by slash commands, subagents, or RC8 references. */
export type ComposerTriggerKind = "skill" | "command" | "subagent" | "reference";

export type ComposerTrigger = {
  kind: ComposerTriggerKind;
  query: string;
  start: number;
  end?: number;
  quoted?: boolean;
};

export type SessionSearchResult = {
  sessionId: string;
  snippet: string;
};

/** 输入框待发送的图片附件：字节已在内存中，发送时作为 prompt 的 image 部分。 */
export type ComposerImageAttachment = {
  kind: "image";
  id: string;
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
};

/**
 * 输入框待发送的文件附件：只保留源路径，发送时才送入 DSH 的官方暂存服务。
 * 拖入后可能不发送（切换会话会清空草稿），提前暂存会在会话里留下永不引用的回执。
 */
export type ComposerFileAttachment = {
  kind: "file";
  id: string;
  name: string;
  path: string;
};

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;

/** 会话日志里的文件附件引用，用于历史渲染与重试重新入队。 */
export type TranscriptFile = {
  attachmentId: string;
  name: string;
  bytes: number;
};

export type SessionStats = {
  /** Source used for the session-wide token aggregate. */
  tokenUsageSource?: TokenUsageSource;
  /** Backward-compatible availability flag for existing callers. */
  tokenUsageAvailable?: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  contextTokens: number;
  /** Whether the runtime supplied a current context-pressure value. */
  contextTokensAvailable?: boolean;
  contextLimit: number;
  cacheHitRate: number;
  messages: number;
  turns?: number;
  steps?: number;
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  /** Steps carrying a recorded first token (official sessionStats field). */
  ttftSteps?: number;
  decodeMs?: number;
  /** Provider output tokens over the same decode-timed steps. */
  decodeTokens?: number;
};

export type DiffHunk = {
  path: string;
  oldText: string | null;
  newText: string;
};

export type DiffSummary = {
  diffs: DiffHunk[];
  added: number;
  removed: number;
  files: number;
};

export type DeliverableFileDiff = {
  added: number;
  removed: number;
};

export type ChildSubagentEntry = Extract<DshSubagentCatalog["entries"][number], { kind: "child" }>;
