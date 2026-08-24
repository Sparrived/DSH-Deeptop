import type { DshCapabilityKey, DshHostCapabilities } from "../lib/desktop";
import type { UiLocale } from "./i18n.ts";

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
  "skills",
  "subagents",
  "goals",
  "agentPresets",
  "plugins",
  "workspace",
] as const;

export interface CapabilityFeatures {
  references: boolean;
  annotations: boolean;
  commands: boolean;
  sessionExport: boolean;
  skills: boolean;
  subagents: boolean;
  goals: boolean;
  agentPresets: boolean;
  plugins: boolean;
  workspace: boolean;
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

export const CAPABILITY_LABELS: Record<DshCapabilityKey, { zh: string; en: string }> = {
  sessions: { zh: "会话运行时", en: "Session runtime" },
  workspace: { zh: "工作区", en: "Workspace" },
  references: { zh: "引用候选", en: "Reference candidates" },
  annotations: { zh: "消息注记", en: "Message annotations" },
  subagents: { zh: "子 Agent", en: "Subagents" },
  skills: { zh: "技能安装", en: "Skill installation" },
  agentPresets: { zh: "Agent Preset", en: "Agent Preset" },
  goals: { zh: "Goal 管理", en: "Goal management" },
  settings: { zh: "设置", en: "Settings" },
  credentials: { zh: "凭据", en: "Credentials" },
  llm: { zh: "模型目录", en: "Model catalog" },
  plugins: { zh: "插件管理", en: "Plugin management" },
  sessionExport: { zh: "会话 ZIP 导出", en: "Session ZIP export" },
  commands: { zh: "命令目录", en: "Command directory" },
};

/** 把探测结果压缩为一条面向用户的降级提示；无缺失返回 null。 */
export function capabilityNotice(capabilities: DshHostCapabilities | null, locale: UiLocale = "zh"): string | null {
  const status = capabilityStatus(capabilities);
  if (!status.probed || status.missing.length === 0) return null;
  const labels = status.missing.map((key) => {
    const pair = CAPABILITY_LABELS[key];
    return locale === "en" ? pair.en : pair.zh;
  });
  const joined = locale === "en" ? labels.join(", ") : labels.join("、");
  return locale === "en"
    ? `Some official capabilities are not installed or not enabled: ${joined}. Downgraded`
    : `部分官方能力未安装或未启用：${joined}已降级`;
}
