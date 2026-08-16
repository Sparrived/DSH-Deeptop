import type {
  DshHistoryEntry,
  DshQuestion,
  DshSessionModels,
  DshSessionSummary,
  DshSubagentAddress,
  DshSubagentCatalog,
} from "../lib/desktop";

export type PromptMode = "queue" | "steer";
export type ModelMenuPane = "root" | "model" | "effort";
export type ModelSelection = { provider: string; model: string; reasoningEffort?: string };
export type WindowMenu = "project" | "edit";
export type SessionAction = "rename" | "fork" | "archive" | "export" | "exportZip";
export type WorkspaceViewMode = "grouped" | "flat";
export type ThemeMode = "system" | "light" | "dark";
/** 主题选择器：内置 Monokai Pro / One Dark（每个主题文件同时含浅色与深色两套配色），或使用自定义外部 CSS 路径。 */
export type AppTheme = "monokai-pro" | "one-dark" | "custom";

/** 背景图作用区域：全局 / 标题栏 / 侧栏 / 对话栏 / 对话框 / 工具面板。 */
export type BackgroundZone = "global" | "windowbar" | "sidebar" | "conversation" | "composer" | "dock";

/** 单个背景区域的配置。image 为空字符串表示该区域不设置背景图。 */
export type BackgroundConfig = {
  image: string;
  name: string;
  opacity: number;
  blur: number;
  size: "cover" | "contain";
  position: "center" | "top" | "bottom" | "left" | "right";
};

/** 按区域组织的背景图设置集合。 */
export type BackgroundSettings = Record<BackgroundZone, BackgroundConfig>;

export type AppearanceSettings = {
  fontFamily: string;
  codeFontFamily: string;
  messageFontSize: number;
  messageLineHeight: number;
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
  source?: string;
  contextRole?: "inject" | "recall";
  contextForm?: "instructions" | "catalog" | "snapshot" | "notice" | "relay" | "recall" | null;
  contextSummary?: string;
  injected?: boolean;
  /** True while this reasoning block is still receiving streaming deltas. */
  streaming?: boolean;
  images?: TranscriptImage[];
  stats?: MessageStats;
  workflow?: WorkflowView;
  files?: string[];
  fileDiffs?: Record<string, DeliverableFileDiff>;
};

export type MessageStats = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheHitRate?: number;
  runMs?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
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
export type SettingsSection = "appearance" | "background" | "general" | "keyboard" | "models" | "plugins" | "presets" | "logs";

export type SettingsDraft = {
  ns: string;
  value: string;
  revision: number;
  original: unknown;
  secrets: string[][];
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
  kind: "skill" | "command" | "subagent";
  id: string;
  label: string;
  detail?: string;
  insertText: string;
};

export type ComposerTrigger = {
  kind: ComposerCandidate["kind"];
  query: string;
  start: number;
};

export type SessionSearchResult = {
  sessionId: string;
  snippet: string;
};

export type ComposerAttachment = {
  id: string;
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
};

export type SessionStats = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  contextLimit: number;
  cacheHitRate: number;
  firstTokenMs: number;
  messages: number;
  turns?: number;
  steps?: number;
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  decodeMs?: number;
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
