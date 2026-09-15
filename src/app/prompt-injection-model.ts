/**
 * 全局提示词注入设置的纯投影。
 *
 * 文本由 Deeptop 自己的 `deeptop-prompt-injection` 命名空间承载：`cordis/prompt-injection`
 * 把它作为一个 system prompt section 注入每个 Session。这里只做纯数据换算——
 * 把命名空间读成草稿，再把编辑结果换算成最小 `settings.mutate` 路径操作，不调用
 * React、Tauri 或 Bridge。
 */

import type { DshSettingsNamespace } from "../lib/desktop";
import type { SettingsPathOp } from "./settings-model.ts";

/** Deeptop 的提示词注入命名空间：`cordis/prompt-injection` 拥有并消费。 */
export const PROMPT_INJECTION_NS = "deeptop-prompt-injection";

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** 读取命名空间里的注入文本；缺失或类型不符时按空文本处理。 */
export function readPromptInjection(namespace: DshSettingsNamespace | undefined): string {
  const text = recordOf(namespace?.value)?.text;
  return typeof text === "string" ? text : "";
}

/**
 * 把草稿换算成命名空间的最小路径操作。
 *
 * 只有真正变化的文本才产生操作，因此未改动的保存不会重写用户文档；清空文本会写入
 * 空字符串，插件据此渲染出空 section，prompt 组装随即丢弃它。
 * @param current - 当前文本（来自设置）。
 * @param next - 编辑后的文本。
 * @returns 命名空间的路径操作；无变化时为空数组。
 */
export function promptInjectionOps(current: string, next: string): SettingsPathOp[] {
  return next === current ? [] : [{ op: "set", path: ["text"], value: next }];
}
