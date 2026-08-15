import type { DshPluginInventoryEntry, DshPreset, DshSessionSummary, DshStatus } from "../lib/desktop";
import type { ChildSubagentEntry, ComposerAttachment, ComposerCandidate, ComposerTrigger } from "./model-types";

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

export function detectComposerTrigger(value: string): ComposerTrigger | null {
  const match = /(^|\s)([\/@])([^\s]*)$/.exec(value);
  if (!match) return null;
  return {
    kind: match[2] === "/" ? "skill" : "subagent",
    query: match[3].toLocaleLowerCase(),
    start: (match.index ?? 0) + match[1].length,
  };
}

export function imageMediaType(file: File): ComposerAttachment["mediaType"] | null {
  return file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp" || file.type === "image/gif"
    ? file.type
    : null;
}

export function readImageFile(file: File): Promise<ComposerAttachment> {
  const mediaType = imageMediaType(file);
  if (!mediaType) return Promise.reject(new Error("只支持 PNG、JPEG、WebP 或 GIF 图片"));
  if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error("图片不能超过 12 MB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
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
  return `${cwd.replace(/[\\/]+$/, "")}\\${path.replace(/^[\\/]+/, "")}`;
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
