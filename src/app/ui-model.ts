import type { DshImageAttachmentLimits, DshFileReferenceCandidate, DshModel, DshModelGroup, DshPlanProjection, DshPluginInventoryEntry, DshPreset, DshPromptContentPart, DshQuestion, DshRuntimeLog, DshSessionModels, DshSessionReferenceCandidate, DshSessionSummary, DshStatus } from "../lib/desktop";
import type { ChildSubagentEntry, ComposerAttachment, ComposerCandidate, ComposerFileAttachment, ComposerImageAttachment, ComposerTrigger } from "./model-types";
import { t, type UiLocale } from "./i18n.ts";

/**
 * Fold the official plan projection into the effective plan-mode target.
 * `pending` is a logged-but-not-yet-committed selection; while it is set the
 * client trusts the wanted state instead of the committed `active` value.
 */
export function planEffectiveTarget(plan: DshPlanProjection | null | undefined): boolean {
  if (!plan) return false;
  return plan.pending ? !plan.active : plan.active;
}

/**
 * A plan-review question, per the official user-questions intent contract.
 * The approve label is named (not positional) so a UI cannot infer the
 * decision from option order; any other option or a custom answer rejects.
 */
export type PlanReviewQuestion = {
  item: DshQuestion;
  approve: string;
  decline?: string;
  /** Question requires a detail block carrying the plan markdown. */
  hasPlan: boolean;
};

export function planReviewOf(questions: DshQuestion[] | undefined): PlanReviewQuestion | null {
  if (!questions || questions.length !== 1) return null;
  const item = questions[0];
  const intent = item.intent;
  if (!intent || intent.kind !== "plan-review") return null;
  const options = item.options ?? [];
  if (options.length === 0 || options.length > 2 || item.multiSelect) return null;
  if (!options.some((option) => option.label === intent.approve)) return null;
  // The official ask() validates that plan-review questions carry the plan
  // markdown as detail; without it the question is not a review card.
  if (!item.detail || item.detail.trim().length === 0) return null;
  const decline = options.find((option) => option.label !== intent.approve)?.label;
  return {
    item,
    approve: intent.approve,
    ...(decline ? { decline } : {}),
    hasPlan: true,
  };
}

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

export function firstUnansweredQuestionIndex(
  questions: DshQuestion[],
  selectedById: Record<string, string[]>,
  customById: Record<string, string>,
) {
  return questions.findIndex((item) => (
    (selectedById[item.id]?.length ?? 0) === 0 && !customById[item.id]?.trim()
  ));
}

/** Recursive subagent tree keys: `parentSessionId\u0000childSessionId`. */
export function subagentTreeKey(parentSessionId: string, childSessionId: string): string {
  return `${parentSessionId}\u0000${childSessionId}`;
}

export function subagentTreeChildId(treeKey: string): string | undefined {
  const child = treeKey.split("\u0000")[1];
  return child && child.trim() ? child : undefined;
}

export function subagentTreeParentId(treeKey: string): string | undefined {
  const parent = treeKey.split("\u0000")[0];
  return parent && parent.trim() ? parent : undefined;
}

export function projectName(path: string | undefined, locale: UiLocale = "zh") {
  if (!path) return t("model.noWorkdir", locale);
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function subagentDisplayName(entry: ChildSubagentEntry, index: number, locale: UiLocale = "zh") {
  return entry.label?.trim() || t("subagent.fallbackName", locale, { index: index + 1 });
}

export function subagentActivityLabel(activity: ChildSubagentEntry["activity"], locale: UiLocale = "zh") {
  return activity === "running" ? t("subagent.running", locale) : t("subagent.stopped", locale);
}

export function subagentModeLabel(mode: ChildSubagentEntry["mode"], locale: UiLocale = "zh") {
  return mode === "continuable" ? t("subagent.continuable", locale) : t("subagent.oneShot", locale);
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
  locale: UiLocale = "zh",
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
      detail: item.kind === "directory" ? `${t("composer.candidate.directory", locale)} · ${t("composer.candidate.keepTyping", locale)}` : t("composer.candidate.file", locale),
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
      detail: item.cwd && !/[\u0000-\u001f\u007f-\u009f]/u.test(item.cwd) ? `${t("composer.candidate.session", locale)} · ${item.cwd}` : t("composer.candidate.session", locale),
      insertText: item.mention,
    }];
  });
  return [...fileCandidates, ...sessionCandidates].slice(0, 8);
}

/** Replace only the active trigger token and keep an open directory quote active. */
export function insertComposerCandidate(value: string, trigger: ComposerTrigger, candidate: ComposerCandidate) {
  // 目录候选以目录词开头（"目录 · 继续选择"），保持引号开放让用户继续输入。
  const suffix = candidate.kind === "file" && candidate.detail?.startsWith(t("composer.candidate.directory", "zh")) ? "" : " ";
  const end = trigger.end ?? value.length;
  return value.slice(0, trigger.start) + candidate.insertText + suffix + value.slice(end);
}

/** Return provider groups with the current model included when the advisory catalog omits it. */
export function modelPickerGroups(models: Pick<DshSessionModels, "groups" | "current">, locale: UiLocale = "zh"): DshModelGroup[] {
  const current = models.current;
  const listed = models.groups.some((group) => group.id === current.provider && group.models.some((model) => model.id === current.model));
  if (listed) return models.groups;
  const currentModel: DshModel = {
    id: current.model,
    name: `${current.model}${t("model.notListedSuffix", locale)}`,
    description: t("model.notListedDescription", locale),
  };
  const provider = models.groups.find((group) => group.id === current.provider);
  if (provider) return models.groups.map((group) => group.id === current.provider ? { ...group, models: [...group.models, currentModel] } : group);
  return [...models.groups, { id: current.provider, name: `${current.provider}${t("model.currentGroupSuffix", locale)}`, models: [currentModel] }];
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
export function imageDimensionLimitError(width: number, height: number, limits?: Pick<DshImageAttachmentLimits, "maxImageDimension" | "maxImagePixels">, locale: UiLocale = "zh"): string | undefined {
  const pixels = width * height;
  if (limits?.maxImagePixels && pixels > limits.maxImagePixels) return t("image.pixelsLimit", locale, { limit: limits.maxImagePixels });
  if (limits?.maxImageDimension && Math.max(width, height) > limits.maxImageDimension) return t("image.dimensionLimit", locale, { limit: limits.maxImageDimension });
  return undefined;
}

/** Return a local image-batch limit message before DSH admission. */
export function imageBatchLimitError(current: ComposerAttachment[], next: ComposerAttachment[], limits?: Pick<DshImageAttachmentLimits, "maxImagesPerMessage" | "maxMessageImageBytes">, locale: UiLocale = "zh"): string | undefined {
  // 两项限额都只统计图片：文件附件由 Host 读取字节，既不占图片张数也不占图片字节预算。
  const images = [...imageAttachments(current), ...imageAttachments(next)];
  if (limits?.maxImagesPerMessage !== undefined && images.length > limits.maxImagesPerMessage) return t("image.countLimit", locale, { limit: limits.maxImagesPerMessage });
  if (limits?.maxMessageImageBytes !== undefined) {
    const bytes = images.reduce((total, item) => {
      const padding = item.data.endsWith("==") ? 2 : item.data.endsWith("=") ? 1 : 0;
      return total + Math.max(0, Math.floor(item.data.length * 3 / 4) - padding);
    }, 0);
    if (bytes > limits.maxMessageImageBytes) return t("image.bytesLimit", locale, { limit: limits.maxMessageImageBytes });
  }
  return undefined;
}

export function modelSupportsImages(model: DshModel | undefined) {
  // DSH omits inputModalities when a provider cannot describe the model's
  // capabilities. That is not the same as declaring text-only input: the Host
  // remains the authority and will validate the prompt at admission time.
  return model?.inputModalities === undefined || model.inputModalities.includes("image");
}

/**
 * Build the prompt content for the given image attachments.
 *
 * 只接受图片附件：文件附件必须先经 `session.stageFile` 换成官方回执，无法在纯函数里完成。
 */
export function promptContentParts(text: string, attachments: ComposerImageAttachment[]): DshPromptContentPart[] {
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

/** 附件里可本地预览/校验的图片部分；文件附件由 Host 负责读取。 */
export function imageAttachments(attachments: ComposerAttachment[]): ComposerImageAttachment[] {
  return attachments.filter((attachment): attachment is ComposerImageAttachment => attachment.kind === "image");
}

/** 需要先暂存成官方回执的文件附件。 */
export function fileAttachments(attachments: ComposerAttachment[]): ComposerFileAttachment[] {
  return attachments.filter((attachment): attachment is ComposerFileAttachment => attachment.kind === "file");
}

/**
 * 把拖入的系统路径分流成图片附件与非图片文件附件。
 *
 * 图片仍走 `read_image_attachment`（原生按魔数确认格式），非图片交给
 * `session.stageFile` 由 Host 读取；路径引用改由文件附件承担，
 * 因此这里不再产生 `@路径` 文本。
 */
export function partitionDroppedPaths(paths: string[]): { images: string[]; files: ComposerFileAttachment[] } {
  const images: string[] = [];
  const files: ComposerFileAttachment[] = [];
  for (const path of paths) {
    // 先 trim 再剥结尾分隔符：原生拖放可能给出只有空白的条目，它既不是图片也
    // 不是可读文件，静默丢弃比生成一个空路径附件更好。
    const clean = path.trim().replace(/[\\/]+$/u, "");
    if (!clean) continue;
    if (droppedImageMediaType(clean)) {
      images.push(clean);
      continue;
    }
    files.push({
      kind: "file",
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: pathBasename(clean),
      path: clean,
    });
  }
  return { images, files };
}

/** 文件附件胶囊的尺寸文案；字节单位跨语言通用，无需语言资源。 */
export function formatAttachmentBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function imageMediaType(file: File): ComposerImageAttachment["mediaType"] | null {
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp" || file.type === "image/gif"
    ? file.type
    : null;
}

const droppedImageExtensionTypes: Record<string, ComposerImageAttachment["mediaType"]> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * 路径能否作为图片附件；也是停靠标签图片预览的可预览判定。
 *
 * 只按扩展名分类，实际格式由原生侧按魔数确认：这组格式必须与
 * `read_image_attachment` 的白名单一致，否则前端会分流到一条读不出来的路径。
 */
export function droppedImageMediaType(path: string): ComposerImageAttachment["mediaType"] | null {
  const name = path.replace(/[\\/]+$/u, "");
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return droppedImageExtensionTypes[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Return the forward-slash workspace-relative form of an absolute path, or null when it lies outside the workspace. */
export function relativeWorkspacePath(path: string, workspace: string): string | null {
  if (!workspace) return null;
  const normalize = (value: string) => value.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const base = normalize(workspace);
  const full = normalize(path);
  if (!base || !full) return null;
  // Windows paths are case-insensitive; ASCII-safe lowering stays safe elsewhere.
  const loweredBase = base.toLowerCase();
  const loweredFull = full.toLowerCase();
  if (!loweredFull.startsWith(loweredBase + "/")) return null;
  return normalize(path).slice(base.length + 1);
}

/** Build the composer mention text for a dropped path: relative inside the workspace, quoted absolute otherwise. */
export function composerReferenceText(path: string, workspace = ""): string {
  const clean = path.replace(/[\\/]+$/u, "").replace(/\\+/gu, "/");
  if (!clean) return "";
  const target = relativeWorkspacePath(clean, workspace) ?? clean;
  return /\s/u.test(target) ? `@"${target}"` : "@" + target;
}

export function readImageFile(file: File, limits?: DshImageAttachmentLimits, locale: UiLocale = "zh"): Promise<ComposerAttachment> {
  const mediaType = imageMediaType(file);
  if (!mediaType) return Promise.reject(new Error(t("image.unsupported", locale)));
  if (limits?.mediaTypes && !limits.mediaTypes.includes(mediaType)) return Promise.reject(new Error(t("image.deploymentUnsupported", locale, { mediaType })));
  const maxBytes = limits?.maxImageBytes ?? 12 * 1024 * 1024;
  if (file.size > maxBytes) return Promise.reject(new Error(t("image.tooLarge", locale, { limit: Math.round(maxBytes / 1024 / 1024) })));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("image.readFailed", locale, { name: file.name })));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const accept = () => {
        const comma = value.indexOf(",");
        if (comma < 0) {
          reject(new Error(t("image.invalidContent", locale, { name: file.name })));
          return;
        }
        resolve({
          kind: "image",
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
          const limitError = imageDimensionLimitError(image.width, image.height, limits, locale);
          if (limitError) {
            reject(new Error(limitError));
            return;
          }
          accept();
        };
        image.onerror = () => reject(new Error(t("image.sizeParseFailed", locale, { name: file.name })));
        image.src = value;
        return;
      }
      accept();
    };
    reader.readAsDataURL(file);
  });
}

// `toLocaleTimeString`/`toLocaleDateString` 每次调用都要重新解析 locale 与选项并
// 构造一个 Intl.DateTimeFormat（实测约 88µs），而这里的选项是常量。消息行、侧栏行
// 每行都要显示时间，切会话/切工作区时几百行一起渲染，这笔构造开销就压在首帧上。
// 缓存后每次只剩一次 format（约 1µs），输出与 toLocale* 逐字节一致。
// ponytail: 默认时区在构造时确定，所以要等应用重载才会跟随系统时区变化——为这点
// 边缘情况保留每行 88µs 的构造开销不值得。
const clockFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

export function formatClock(time?: number) {
  if (!time) return "";
  // 非法或越界时间戳：toLocaleTimeString 返回 "Invalid Date"，而 format 会抛 RangeError。
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return clockFormatter.format(date);
}

export function formatDate(time: number) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return dateFormatter.format(date);
}

export function displayTitle(session: DshSessionSummary, locale: UiLocale = "zh") {
  const title = session.projections?.values?.title;
  if (typeof title === "string" && title.trim()) return title;
  return session.blank ? t("session.blankTitle", locale) : projectName(session.cwd, locale) || session.sessionId;
}

export function runtimeLabel(status: DshStatus, locale: UiLocale = "zh") {
  if (status.installing) return t("runtime.installing", locale);
  if (status.runtimeStarting) return t("runtime.starting", locale);
  if (status.runtimeAvailable) return t("runtime.connected", locale);
  return t("runtime.disconnected", locale);
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

/** 路径所在的目录，作为停靠标签的副标题；没有目录时返回空串。 */
export function fileTabDetail(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return separator > 0 ? normalized.slice(0, separator) : "";
}

export function pluginDisplayName(moduleName: string) {
  return (moduleName.startsWith("@") ? moduleName.slice(moduleName.indexOf("/") + 1) : moduleName)
    .replace(/^cordis:/, "")
    .replace(/^cordis-plugin-/, "")
    .replace(/^dsh-(?:host-|client-)?/, "");
}

export function pluginPhaseLabel(phase: DshPluginInventoryEntry["fiberPhase"], locale: UiLocale = "zh") {
  if (phase === "pending") return t("plugins.phase.pending", locale);
  if (phase === "loading") return t("plugins.phase.loading", locale);
  if (phase === "active") return t("plugins.phase.active", locale);
  if (phase === "failed") return t("plugins.phase.failed", locale);
  if (phase === "unloading") return t("plugins.phase.unloading", locale);
  return t("plugins.phase.unobserved", locale);
}

const builtInPresetNames: Record<string, { zh: string; en: string }> = {
  standard: { zh: "标准模式", en: "Standard" },
  code: { zh: "PTC 模式", en: "PTC mode" },
  minimal: { zh: "极简模式", en: "Minimal" },
  cordis: { zh: "创造模式", en: "Creator mode" },
};

const builtInPresetDescriptions: Record<string, { zh: string; en: string }> = {
  standard: { zh: "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。", en: "A fully featured coding agent with file editing, shell, file & web search, skills, planning, goals, subagents, and workflows." },
  code: { zh: "具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作。", en: "Everything in Standard, plus tools exposed through the Code Mode SDK so the model can compose multi-step operations in one TypeScript program." },
  minimal: { zh: "仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。", en: "A two-tool coding agent providing only a persistent bash and str_replace_editor." },
  cordis: { zh: "用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导。", en: "For creating custom agent presets: everything in Standard, plus runtime inspection, plugin experiments, and preset authoring guidance." },
};

export function presetDisplayName(id: string | undefined, presets: DshPreset[], locale: UiLocale = "zh") {
  if (!id) return t("preset.defaultName", locale);
  const preset = presets.find((item) => item.id === id);
  const builtIn = builtInPresetNames[id];
  return preset?.name?.trim() || (builtIn ? builtIn[locale] : undefined) || id;
}

export function presetDescription(preset: DshPreset, locale: UiLocale = "zh") {
  return preset.description?.trim() || builtInPresetDescriptions[preset.id]?.[locale] || t("preset.noDescription", locale);
}

export function isWindowChromeControl(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest("button, input, select, textarea, a, .window-menu, .window-actions"));
}

export function sessionIsVisible(session: DshSessionSummary, workspace: string, query: string) {
  // Only sessions explicitly marked as subagents belong on the Subagent surface.
  // Ordinary fork sessions also have parentSessionId and remain visible here.
  if (session.blank || session.origin === "subagent") return false;
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

export function runtimeLogStreamLabel(stream: DshRuntimeLog["stream"], locale: UiLocale = "zh") {
  switch (stream) {
    case "command": return t("logs.stream.command", locale);
    case "stdout": return t("logs.stream.stdout", locale);
    case "stderr": return t("logs.stream.stderr", locale);
    case "diagnostic": return t("logs.stream.diagnostic", locale);
    case "frontend": return t("logs.stream.frontend", locale);
    case "console": return t("logs.stream.console", locale);
  }
}

export function runtimeLogMatches(log: DshRuntimeLog, query: string) {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return log.text.toLowerCase().includes(q)
    || log.phase.toLowerCase().includes(q)
    || log.stream.toLowerCase().includes(q);
}
