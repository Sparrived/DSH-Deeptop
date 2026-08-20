import type { DshImageAttachmentLimits, DshFileReferenceCandidate, DshModel, DshModelGroup, DshPluginInventoryEntry, DshPreset, DshPromptContentPart, DshQuestion, DshRuntimeLog, DshSessionModels, DshSessionReferenceCandidate, DshSessionSummary, DshStatus } from "../lib/desktop";
import type { ChildSubagentEntry, ComposerAttachment, ComposerCandidate, ComposerTrigger } from "./model-types";

export function questionAnswerItems(
  questions: DshQuestion[],
  selectedById: Record<string, string[]>,
  customById: Record<string, string>,
) {
  return questions.map((item) => {
    const custom = customById[item.id]?.trim();
    return {
      id: item.id,
      selected: custom && item.multiSelect !== true ? [] : selectedById[item.id] ?? [],
      ...(custom ? { custom } : {}),
    };
  });
}

export function projectName(path: string | undefined) {
  if (!path) return "未选择工作目录";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function subagentDisplayName(entry: ChildSubagentEntry, index: number) {
  return entry.label?.trim() || `子 Agent ${String(index + 1).padStart(2, "0")}`;
}

export function subagentActivityLabel(activity: ChildSubagentEntry["activity"]) {
  return activity === "running" ? "运行中" : "已停止";
}

export function subagentModeLabel(mode: ChildSubagentEntry["mode"]) {
  return mode === "continuable" ? "可继续" : "一次性";
}

export function shortSubagentId(id: string) {
  return id.length > 24 ? `${id.slice(0, 10)}...${id.slice(-8)}` : id;
}

export function insertComposerText(value: string, insertion: string, selectionStart = value.length, selectionEnd = selectionStart) {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const prefix = start > 0 && !/\s$/.test(value.slice(0, start)) ? " " : "";
  const suffix = end < value.length && !/^\s/.test(value.slice(end)) ? " " : "";
  const nextValue = `${value.slice(0, start)}${prefix}${insertion}${suffix}${value.slice(end)}`;
  const nextSelection = start + prefix.length + insertion.length;
  return { value: nextValue, selectionStart: nextSelection, selectionEnd: nextSelection };
}

export function detectComposerTrigger(value: string): ComposerTrigger | null {
  // Only the token immediately before the caret can drive completion. Keep
  // file queries case-preserving because workspace paths may be case-sensitive.
  const quoted = /(^|\s)@\"([^\"]*)$/.exec(value);
  if (quoted) return {
    kind: "reference",
    query: quoted[2],
    start: (quoted.index ?? 0) + quoted[1].length,
    quoted: true,
  };
  const reference = /(^|\s)@([^\s]*)$/.exec(value);
  if (reference) return {
    kind: "reference",
    query: reference[2],
    start: (reference.index ?? 0) + reference[1].length,
  };
  const skill = /(^|\s)\/([^\s\/]*)$/.exec(value);
  if (!skill) return null;
  return {
    kind: "skill",
    query: skill[2].toLocaleLowerCase(),
    start: (skill.index ?? 0) + skill[1].length,
  };
}

/** Convert RC8 reference records into one deterministic Composer source. */
function decodeCanonicalSessionMention(mention: string): { sessionId: string; label: string } | null {
  if (mention.length > 1024 || !mention.startsWith("@[") ) return null;
  let labelEnd = -1;
  let escaped = false;
  for (let index = 2; index < mention.length; index += 1) {
    const character = mention[index];
    if (character === "\r" || character === "\n" || /[\u0000-\u001f\u007f-\u009f]/u.test(character)) return null;
    if (escaped) {
      if (character !== "\\" && character !== "]") return null;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "]") {
      labelEnd = index;
      break;
    }
  }
  if (labelEnd < 0 || escaped) return null;
  const suffix = "](dsh-session:";
  if (!mention.startsWith(suffix, labelEnd)) return null;
  const payloadStart = labelEnd + suffix.length;
  if (!mention.endsWith(")") || payloadStart >= mention.length - 1) return null;
  const payload = mention.slice(payloadStart, -1);
  if (!/^[A-Za-z0-9_-]+$/u.test(payload)) return null;
  let label = "";
  for (let index = 2; index < labelEnd; index += 1) {
    const character = mention[index];
    if (character === "\\") {
      index += 1;
      label += mention[index];
    } else {
      label += character;
    }
  }
  try {
    const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
    const binary = globalThis.atob(padded.replace(/-/gu, "+").replace(/_/gu, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const sessionId: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof sessionId !== "string" || !sessionId.trim()) return null;
    const canonicalBytes = new TextEncoder().encode(JSON.stringify(sessionId));
    let canonicalBinary = "";
    for (const byte of canonicalBytes) canonicalBinary += String.fromCharCode(byte);
    const canonicalPayload = globalThis.btoa(canonicalBinary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
    return canonicalPayload === payload ? { sessionId, label } : null;
  } catch {
    return null;
  }
}

export function referenceComposerCandidates(
  files: DshFileReferenceCandidate[],
  sessions: DshSessionReferenceCandidate[],
  quoted = false,
) {
  const fileCandidates = files.flatMap((item) => {
    if (!item || (item.kind !== "file" && item.kind !== "directory") || typeof item.path !== "string") return [];
    const rawPath = item.path.trim();
    const path = item.kind === "directory" ? rawPath.replace(/[\\/]+$/u, "") + "/" : rawPath;
    const normalizedPath = path.replace(/\\/gu, "/");
    const pathParts = normalizedPath.split("/");
    if (!rawPath || rawPath.length > 512 || pathParts.includes("..") || /[\u0000-\u001f\u007f-\u009f"]/u.test(path) || normalizedPath.startsWith("/") || /^[A-Za-z]:/u.test(normalizedPath)) return [];
    const quotedPath = quoted || /\s/u.test(path);
    const insertText = quotedPath
      ? item.kind === "directory" ? "@\"" + path : "@\"" + path + "\""
      : "@" + path;
    return [{
      kind: "file" as const,
      id: rawPath,
      label: "@" + rawPath,
      detail: item.kind === "directory" ? "目录 · 继续选择" : "文件引用",
      insertText,
    }];
  });
  const sessionCandidates = quoted ? [] : sessions.flatMap((item) => {
    if (!item || typeof item.sessionId !== "string" || !item.sessionId.trim() || typeof item.label !== "string" || !item.label.trim() || item.label.length > 160 || /[\u0000-\u001f\u007f-\u009f]/u.test(item.label) || typeof item.mention !== "string" || item.mention.length > 1024) return [];
    const decodedSessionId = decodeCanonicalSessionMention(item.mention);
    if (decodedSessionId === null || decodedSessionId.sessionId !== item.sessionId || decodedSessionId.label !== item.label) return [];
    return [{
      kind: "session" as const,
      id: item.sessionId,
      label: "@" + item.label,
      detail: item.cwd && !/[\u0000-\u001f\u007f-\u009f]/u.test(item.cwd) ? "会话引用 · " + item.cwd : "会话引用",
      insertText: item.mention,
    }];
  });
  return [...fileCandidates, ...sessionCandidates].slice(0, 8);
}

/** Replace only the active trigger token and keep an open directory quote active. */
export function insertComposerCandidate(value: string, trigger: ComposerTrigger, candidate: ComposerCandidate) {
  const suffix = candidate.kind === "file" && candidate.detail?.startsWith("目录") ? "" : " ";
  const end = trigger.end ?? value.length;
  return value.slice(0, trigger.start) + candidate.insertText + suffix + value.slice(end);
}

/** Return provider groups with the current model included when the advisory catalog omits it. */
export function modelPickerGroups(models: Pick<DshSessionModels, "groups" | "current">): DshModelGroup[] {
  const current = models.current;
  const listed = models.groups.some((group) => group.id === current.provider && group.models.some((model) => model.id === current.model));
  if (listed) return models.groups;
  const currentModel: DshModel = {
    id: current.model,
    name: current.model + "（当前未列出）",
    description: "Provider 目录未返回此模型；由 Host 的 routable 状态决定是否可用。",
  };
  const provider = models.groups.find((group) => group.id === current.provider);
  if (provider) return models.groups.map((group) => group.id === current.provider ? { ...group, models: [...group.models, currentModel] } : group);
  return [...models.groups, { id: current.provider, name: current.provider + "（当前模型）", models: [currentModel] }];
}

/** Read the official imageLimits projection when it is present in session history. */
export function imageLimitsFromProjection(value: unknown): DshImageAttachmentLimits | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const numericKeys = ["maxImageBytes", "maxImagesPerMessage", "maxMessageImageBytes", "maxImagePixels", "maxImageDimension"] as const;
  if (!numericKeys.every((key) => typeof record[key] === "number" && Number.isInteger(record[key]) && record[key] > 0)) return undefined;
  if (!Array.isArray(record.mediaTypes) || !record.mediaTypes.every((item) => typeof item === "string")) return undefined;
  return {
    maxImageBytes: record.maxImageBytes as number,
    maxImagesPerMessage: record.maxImagesPerMessage as number,
    maxMessageImageBytes: record.maxMessageImageBytes as number,
    maxImagePixels: record.maxImagePixels as number,
    maxImageDimension: record.maxImageDimension as number,
    mediaTypes: record.mediaTypes as string[],
  };
}

/** Return a local image-limit message for decoded intrinsic dimensions. */
export function imageDimensionLimitError(width: number, height: number, limits?: Pick<DshImageAttachmentLimits, "maxImageDimension" | "maxImagePixels">): string | undefined {
  const pixels = width * height;
  if (limits?.maxImagePixels && pixels > limits.maxImagePixels) return "图片像素数不能超过 " + limits.maxImagePixels;
  if (limits?.maxImageDimension && Math.max(width, height) > limits.maxImageDimension) return "图片边长不能超过 " + limits.maxImageDimension + "px";
  return undefined;
}

/** Return a local image-batch limit message before DSH admission. */
export function imageBatchLimitError(current: ComposerAttachment[], next: ComposerAttachment[], limits?: Pick<DshImageAttachmentLimits, "maxImagesPerMessage" | "maxMessageImageBytes">): string | undefined {
  if (limits?.maxImagesPerMessage !== undefined && current.length + next.length > limits.maxImagesPerMessage) return "图片数量不能超过 " + limits.maxImagesPerMessage + " 张";
  if (limits?.maxMessageImageBytes !== undefined) {
    const bytes = [...current, ...next].reduce((total, item) => {
      const padding = item.data.endsWith("==") ? 2 : item.data.endsWith("=") ? 1 : 0;
      return total + Math.max(0, Math.floor(item.data.length * 3 / 4) - padding);
    }, 0);
    if (bytes > limits.maxMessageImageBytes) return "本条消息图片总大小不能超过 " + limits.maxMessageImageBytes + " 字节";
  }
  return undefined;
}

export function modelSupportsImages(model: DshModel | undefined) {
  // DSH omits inputModalities when a provider cannot describe the model's
  // capabilities. That is not the same as declaring text-only input: the Host
  // remains the authority and will validate the prompt at admission time.
  return model?.inputModalities === undefined || model.inputModalities.includes("image");
}

export function promptContentParts(text: string, attachments: ComposerAttachment[]): DshPromptContentPart[] {
  return [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...attachments.map((attachment) => ({
      type: "image" as const,
      mediaType: attachment.mediaType,
      data: attachment.data,
      name: attachment.name,
    })),
  ];
}

export function imageMediaType(file: File): ComposerAttachment["mediaType"] | null {
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp" || file.type === "image/gif"
    ? file.type
    : null;
}

export function readImageFile(file: File, limits?: DshImageAttachmentLimits): Promise<ComposerAttachment> {
  const mediaType = imageMediaType(file);
  if (!mediaType) return Promise.reject(new Error("只支持 PNG、JPEG、WebP 或 GIF 图片"));
  if (limits?.mediaTypes && !limits.mediaTypes.includes(mediaType)) return Promise.reject(new Error("当前部署不支持 " + mediaType + " 图片"));
  const maxBytes = limits?.maxImageBytes ?? 12 * 1024 * 1024;
  if (file.size > maxBytes) return Promise.reject(new Error("图片不能超过 " + Math.round(maxBytes / 1024 / 1024) + " MB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const accept = () => {
        const comma = value.indexOf(",");
        if (comma < 0) {
          reject(new Error(`图片内容无效：${file.name}`));
          return;
        }
        resolve({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          mediaType,
          data: value.slice(comma + 1),
        });
      };
      if (limits?.maxImageDimension || limits?.maxImagePixels) {
        // The Host remains authoritative when this pure helper is exercised without a browser decoder.
        if (typeof Image === "undefined") {
          accept();
          return;
        }
        const image = new Image();
        image.onload = () => {
          const limitError = imageDimensionLimitError(image.width, image.height, limits);
          if (limitError) {
            reject(new Error(limitError));
            return;
          }
          accept();
        };
        image.onerror = () => reject(new Error(`无法解析图片尺寸：${file.name}`));
        image.src = value;
        return;
      }
      accept();
    };
    reader.readAsDataURL(file);
  });
}

export function formatClock(time?: number) {
  if (!time) return "";
  return new Date(time).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(time: number) {
  return new Date(time).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
}

export function displayTitle(session: DshSessionSummary) {
  const title = session.projections?.values?.title;
  if (typeof title === "string" && title.trim()) return title;
  return session.blank ? "新会话" : projectName(session.cwd) || session.sessionId;
}

export function runtimeLabel(status: DshStatus) {
  if (status.installing) return "安装中";
  if (status.runtimeStarting) return "启动中";
  if (status.runtimeAvailable) return "已连接";
  return "未连接";
}

export function sessionPath(cwd: string | undefined, path: string) {
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path) || !cwd) return path;
  const separator = cwd.includes("\\") ? "\\" : "/";
  const base = cwd.replace(/[\\/]+$/, "");
  const relative = path.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
  return `${base}${separator}${relative}`;
}

export function pathBasename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separator >= 0 ? normalized.slice(separator + 1) : normalized;
}

export function pluginDisplayName(moduleName: string) {
  return (moduleName.startsWith("@") ? moduleName.slice(moduleName.indexOf("/") + 1) : moduleName)
    .replace(/^cordis:/, "")
    .replace(/^cordis-plugin-/, "")
    .replace(/^dsh-(?:host-|client-)?/, "");
}

export function pluginPhaseLabel(phase: DshPluginInventoryEntry["fiberPhase"]) {
  if (phase === "pending") return "等待加载";
  if (phase === "loading") return "加载中";
  if (phase === "active") return "运行中";
  if (phase === "failed") return "加载失败";
  if (phase === "unloading") return "卸载中";
  return "未观测";
}

const builtInPresetNames: Record<string, string> = {
  standard: "标准模式",
  code: "PTC 模式",
  minimal: "极简模式",
  cordis: "创造模式",
};

const builtInPresetDescriptions: Record<string, string> = {
  standard: "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。",
  code: "具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。",
  minimal: "仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。",
  cordis: "用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。",
};

export function presetDisplayName(id: string | undefined, presets: DshPreset[]) {
  if (!id) return "默认预设";
  const preset = presets.find((item) => item.id === id);
  return preset?.name?.trim() || builtInPresetNames[id] || id;
}

export function presetDescription(preset: DshPreset) {
  return preset.description?.trim() || builtInPresetDescriptions[preset.id] || "暂无描述。";
}

export function isWindowChromeControl(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest("button, input, select, textarea, a, .window-menu, .window-actions"));
}

export function sessionIsVisible(session: DshSessionSummary, workspace: string, query: string) {
  // Subagent sessions are shown through the Subagent surface instead.
  if (session.blank || session.origin === "subagent" || session.parentSessionId) return false;
  if (workspace && session.cwd !== workspace) return false;
  if (!query) return true;
  const haystack = `${displayTitle(session)} ${session.cwd ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function formatRuntimeLogTime(time?: number) {
  if (typeof time !== "number" || Number.isNaN(time)) return "";
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
}

export function formatRuntimeLog(log: DshRuntimeLog) {
  return `[${formatRuntimeLogTime(log.time)}] [${log.phase}/${log.stream}] ${log.text}`;
}

export function formatRuntimeLogs(logs: DshRuntimeLog[]) {
  return logs.map(formatRuntimeLog).join("\n");
}

export function runtimeLogStreamLabel(stream: DshRuntimeLog["stream"]) {
  switch (stream) {
    case "command": return "命令";
    case "stdout": return "输出";
    case "stderr": return "错误";
    case "diagnostic": return "诊断";
    case "frontend": return "前端错误";
    case "console": return "控制台";
  }
}

export function runtimeLogMatches(log: DshRuntimeLog, query: string) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return log.text.toLowerCase().includes(q)
    || log.phase.toLowerCase().includes(q)
    || log.stream.toLowerCase().includes(q);
}
