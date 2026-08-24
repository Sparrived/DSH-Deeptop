import type { DshHistoryEntry, PetActivityUpdate, PetAttention, PetSessionTarget } from "../lib/desktop";
import type { PendingApproval, PendingQuestion } from "./model-types";
import { eventContent } from "./message-model.ts";

export const MAX_PET_ACTIVITIES = 12;
const MAX_PET_PREVIEW_CHARS = 900;
// 与 src-tauri pet_feature/window.rs 的 validate_activity 上限保持一致：
// 超限会让整条 update_pet_activity 被拒，宠物窗口活动静默停更。
export const MAX_PET_TITLE_CHARS = 160;
export const MAX_PET_MESSAGE_CHARS = 1_200;
export const MAX_PET_TOOL_NAME_CHARS = 160;
export const MAX_PET_OPTION_CHARS = 120;

/** 按码点截断到与 Rust char 计数一致的上限内（省略号占 1 位）。 */
function boundedText(value: string, maximum: number): string {
  const characters = Array.from(value);
  if (characters.length <= maximum) return value;
  return `${characters.slice(0, maximum - 1).join("")}…`;
}

export interface PetSessionState extends PetSessionTarget {
  running: boolean;
  updatedAt: number;
}

export interface PetCompletionSignal {
  id: string;
  sessionId: string;
  kind: "completed" | "failed";
  title: string;
  message: string;
  updatedAt: number;
  previewLoaded: boolean;
}

interface PetActivityProjectionInput {
  activeSessionId: string | null;
  sessions: readonly PetSessionState[];
  approvals: readonly PendingApproval[];
  questions: readonly PendingQuestion[];
  completions: readonly PetCompletionSignal[];
}

interface RankedAttention {
  attention: PetAttention;
  priority: number;
  active: boolean;
  updatedAt: number;
}

function boundedQuestionOptions(question: PendingQuestion): string[] {
  if (question.questions.length !== 1) return [];
  return (question.questions[0]?.options ?? [])
    .map((option) => option.label.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function approvalAttention(approval: PendingApproval, title: string): PetAttention {
  return {
    id: `approval:${approval.rpcId}`,
    kind: "approval",
    sessionId: approval.sessionId,
    title: boundedText(title, MAX_PET_TITLE_CHARS),
    message: boundedText(
      approval.reason?.trim() || `${approval.toolName} 需要你确认后继续。`,
      MAX_PET_MESSAGE_CHARS,
    ),
    toolName: boundedText(approval.toolName, MAX_PET_TOOL_NAME_CHARS),
    options: [],
    canReply: false,
  };
}

function questionAttention(question: PendingQuestion, title: string): PetAttention {
  const singleQuestion = question.questions.length === 1 ? question.questions[0] : undefined;
  return {
    id: `question:${question.rpcId}`,
    kind: "question",
    sessionId: question.sessionId,
    title: boundedText(title, MAX_PET_TITLE_CHARS),
    message: boundedText(
      singleQuestion?.question.trim() || `有 ${question.questions.length} 个问题等待处理。`,
      MAX_PET_MESSAGE_CHARS,
    ),
    options: boundedQuestionOptions(question).map((option) => boundedText(option, MAX_PET_OPTION_CHARS)),
    canReply: Boolean(singleQuestion),
  };
}

function completionAttention(completion: PetCompletionSignal): PetAttention {
  const failed = completion.kind === "failed";
  return {
    id: completion.id,
    kind: completion.kind,
    sessionId: completion.sessionId,
    title: boundedText(completion.title, MAX_PET_TITLE_CHARS),
    message: boundedText(
      completion.previewLoaded
        ? completion.message || (failed
          ? "任务运行失败，可以打开会话查看详情或直接补充说明。"
          : "任务已经完成，可以直接继续追问。")
        : "正在读取最后一段回复…",
      MAX_PET_MESSAGE_CHARS,
    ),
    options: [],
    canReply: true,
  };
}

function runningAttention(session: PetSessionState): PetAttention {
  return {
    id: `running:${session.sessionId}`,
    kind: "running",
    sessionId: session.sessionId,
    title: boundedText(session.title, MAX_PET_TITLE_CHARS),
    message: "Agent 正在处理这个会话。",
    options: [],
    canReply: false,
  };
}

function sessionTitle(sessions: readonly PetSessionState[], sessionId: string): string {
  return sessions.find((session) => session.sessionId === sessionId)?.title || `会话 ${sessionId.slice(-8)}`;
}

function sessionUpdatedAt(sessions: readonly PetSessionState[], sessionId: string): number {
  return sessions.find((session) => session.sessionId === sessionId)?.updatedAt ?? 0;
}

function rankedAttention(
  attention: PetAttention,
  priority: number,
  activeSessionId: string | null,
  updatedAt: number,
): RankedAttention {
  return {
    attention,
    priority,
    active: attention.sessionId === activeSessionId,
    updatedAt,
  };
}

/**
 * 从历史记录中提取最后一条正式助手回复；不包含推理、工具输出或完整历史。
 * 摘要会常驻显示在置顶的宠物窗口上，因此先整体剥离围栏代码块
 * （其中常含密钥、路径等敏感内容），再折叠空白并按上限截断。
 */
export function petCompletionMessageFromHistory(entries: readonly DshHistoryEntry[]): string {
  const assistantEntry = [...entries]
    .sort((left, right) => right.event.seq - left.event.seq)
    .find(({ event }) => event.type === "assistant/message" && eventContent(event).trim());
  if (!assistantEntry) return "";
  const withoutFences = eventContent(assistantEntry.event)
    .replaceAll("\0", "")
    .replace(/```[\s\S]*?```/g, " ");
  const strayFence = withoutFences.indexOf("```");
  const compact = (strayFence === -1 ? withoutFences : withoutFences.slice(0, strayFence))
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "";
  return boundedText(compact, MAX_PET_PREVIEW_CHARS);
}

/** 按桌面注意力优先级投影所有会话：需要输入、失败、完成未读、运行中。 */
export function projectPetActivity({
  activeSessionId,
  sessions,
  approvals,
  questions,
  completions,
}: PetActivityProjectionInput): PetActivityUpdate {
  const ranked: RankedAttention[] = [];
  for (const approval of approvals) {
    ranked.push(rankedAttention(
      approvalAttention(approval, sessionTitle(sessions, approval.sessionId)),
      0,
      activeSessionId,
      sessionUpdatedAt(sessions, approval.sessionId),
    ));
  }
  for (const question of questions) {
    ranked.push(rankedAttention(
      questionAttention(question, sessionTitle(sessions, question.sessionId)),
      0,
      activeSessionId,
      sessionUpdatedAt(sessions, question.sessionId),
    ));
  }
  for (const completion of completions) {
    ranked.push(rankedAttention(
      completionAttention(completion),
      completion.kind === "failed" ? 1 : 2,
      activeSessionId,
      completion.updatedAt,
    ));
  }
  for (const session of sessions) {
    if (!session.running) continue;
    ranked.push(rankedAttention(runningAttention(session), 3, activeSessionId, session.updatedAt));
  }

  ranked.sort((left, right) => left.priority - right.priority
    || Number(right.active) - Number(left.active)
    || right.updatedAt - left.updatedAt);
  const seenSessions = new Set<string>();
  const activities = ranked
    .filter(({ attention }) => {
      if (seenSessions.has(attention.sessionId)) return false;
      seenSessions.add(attention.sessionId);
      return true;
    })
    .slice(0, MAX_PET_ACTIVITIES)
    .map(({ attention }) => attention);
  const attention = activities.find((item) => item.kind !== "running");
  const fallbackTarget = activities[0]
    ?? sessions.find((session) => session.sessionId === activeSessionId)
    ?? sessions[0];
  const target = attention
    ? { sessionId: attention.sessionId, title: attention.title }
    : fallbackTarget
      ? { sessionId: fallbackTarget.sessionId, title: boundedText(fallbackTarget.title, MAX_PET_TITLE_CHARS) }
      : undefined;
  const state = attention?.kind === "approval" || attention?.kind === "question"
    ? "waiting"
    : attention?.kind === "failed"
      ? "failed"
      : attention?.kind === "completed"
        ? "review"
        : sessions.some((session) => session.running)
          ? "running"
          : "idle";

  return { state, activities, attention, target };
}
