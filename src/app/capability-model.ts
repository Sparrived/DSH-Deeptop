import type { DshCapabilityKey, DshHostCapabilities } from "../lib/desktop";
import { t, type UiLocale } from "./i18n.ts";

/**
 * 官方能力探测的前端降级模型：把 `desktop.capabilities` 的探测结果映射为
 * 界面功能开关。未探测（null）时保持“不降级”，与旧行为一致；探测后缺失
 * 能力对应的功能入口按提示禁用，而不是伪造成成功。
 * 纯模块，可在 Node 中直接测试。
 */

/** 探测结果中受界面降级影响的能力键（按提示优先级排序）。 */
export const DEGRADABLE_CAPABILITIES: readonly DshCapabilityKey[] = [
  "references",
  "annotations",
  "commands",
  "sessionExport",
  "sessionDelete",
  "skills",
  "subagents",
  "tasks",
  "goals",
  "agentPresets",
  "plugins",
  "tools",
  "workspace",
  "fileAttachments",
] as const;

export interface CapabilityFeatures {
  references: boolean;
  annotations: boolean;
  commands: boolean;
  sessionExport: boolean;
  /**
   * 已归档会话的永久删除。缺失时删除入口保持禁用：只有拥有完整产物集合的
   * 存储后端才能保证销毁，缺失时应显式拒绝而不是伪造成功。
   */
  sessionDelete: boolean;
  skills: boolean;
  subagents: boolean;
  tasks: boolean;
  goals: boolean;
  agentPresets: boolean;
  plugins: boolean;
  tools: boolean;
  workspace: boolean;
  /**
   * 非图片文件附件。缺失时拖入的非图片文件退回 `@路径` 引用：这样用户仍能
   * 把文件交给模型，而不是在发送那一刻才被 Host 拒绝。
   */
  fileAttachments: boolean;
}

export interface CapabilityStatus {
  /** 是否已成功探测。 */
  probed: boolean;
  features: CapabilityFeatures;
  /** 缺失且影响界面降级的能力键。 */
  missing: DshCapabilityKey[];
}

const featureKeys: readonly DshCapabilityKey[] = DEGRADABLE_CAPABILITIES;

export function capabilityStatus(capabilities: DshHostCapabilities | null): CapabilityStatus {
  const probed = capabilities !== null;
  const missing: DshCapabilityKey[] = [];
  if (probed) {
    for (const key of DEGRADABLE_CAPABILITIES) {
      if (capabilities!.services[key] !== true) missing.push(key);
    }
  }
  const features = Object.fromEntries(
    featureKeys.map((key) => [key, !probed || capabilities!.services[key] === true]),
  ) as unknown as CapabilityFeatures;
  return { probed, features, missing };
}

/** 能力名文案 key（文案资源见 locales/zh.json · capability.*）。 */
export const CAPABILITY_LABELS: Record<DshCapabilityKey, string> = {
  bootstrap: "capability.bootstrap",
  sessions: "capability.sessions",
  workspace: "capability.workspace",
  references: "capability.references",
  annotations: "capability.annotations",
  subagents: "capability.subagents",
  tasks: "capability.tasks",
  skills: "capability.skills",
  agentPresets: "capability.agentPresets",
  goals: "capability.goals",
  settings: "capability.settings",
  credentials: "capability.credentials",
  llm: "capability.llm",
  plugins: "capability.plugins",
  tools: "capability.tools",
  sessionExport: "capability.sessionExport",
  sessionDelete: "capability.sessionDelete",
  commands: "capability.commands",
  fileAttachments: "capability.fileAttachments",
  uiPlugins: "capability.uiPlugins",
};

/** 把探测结果压缩为一条面向用户的降级提示；无缺失返回 null。 */
export function capabilityNotice(capabilities: DshHostCapabilities | null, locale: UiLocale = "zh"): string | null {
  const status = capabilityStatus(capabilities);
  if (!status.probed || status.missing.length === 0) return null;
  const labels = status.missing.map((key) => t(CAPABILITY_LABELS[key], locale));
  const joined = locale === "en" ? labels.join(", ") : labels.join("、");
  return t("capability.degraded", locale, { labels: joined });
}
