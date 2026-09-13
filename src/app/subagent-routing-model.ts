/**
 * 子代理模型路由设置的纯投影。
 *
 * 白名单（能选哪些 provider/model）由官方 `subagent-model-selection` 命名空间强制，
 * 「何时使用」的说明由 Deeptop 自己的 `deeptop-subagent-routing` 命名空间承载：
 * Host 插件把它注入 system prompt，并投影到支持 `models[].description` 的 catalog。
 * 这里只做纯数据换算：把两个命名空间读成一份草稿，再把编辑结果换算成最小的
 * `settings.mutate` 路径操作——不调用 React、Tauri 或 Bridge。
 */

import type { DshSettingsNamespace } from "../lib/desktop";
import { sameJson, type SettingsPathOp } from "./settings-model.ts";

/** 官方白名单命名空间：由 DSH 的委派策略在每个新顶层 Session 组装时采样。 */
export const SUBAGENT_MODEL_SELECTION_NS = "subagent-model-selection";
/** Deeptop 自己的说明命名空间：`cordis/subagent-routing` 拥有并消费。 */
export const SUBAGENT_ROUTING_NS = "deeptop-subagent-routing";

/** 一条可选路由及其「何时使用」说明。 */
export type SubagentRoutingRow = { provider: string; model: string; note: string };

/** 面板一次保存的完整取值。 */
export type SubagentRoutingSave = { enabled: boolean; rows: SubagentRoutingRow[]; guidance: string };

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** 读取官方命名空间里的精确路由列表（不含说明）。 */
export function allowedRoutingKeys(namespace: DshSettingsNamespace | undefined): Array<{ provider: string; model: string }> {
  const allowed = recordOf(namespace?.value)?.allowedModels;
  if (!Array.isArray(allowed)) return [];
  const seen = new Set<string>();
  const keys: Array<{ provider: string; model: string }> = [];
  for (const candidate of allowed) {
    const record = recordOf(candidate);
    const provider = textOf(record?.provider);
    const model = textOf(record?.model);
    if (provider === undefined || model === undefined) continue;
    const key = `${provider}\u0000${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push({ provider, model });
  }
  return keys;
}

/** 读取说明命名空间里的 model → 说明映射，键为 `provider\u0000model`。 */
export function routingNotesByName(namespace: DshSettingsNamespace | undefined): Map<string, string> {
  const routes = recordOf(namespace?.value)?.routes;
  const notes = new Map<string, string>();
  if (!Array.isArray(routes)) return notes;
  for (const candidate of routes) {
    const record = recordOf(candidate);
    const provider = textOf(record?.provider);
    const model = textOf(record?.model);
    const note = textOf(record?.note);
    if (provider === undefined || model === undefined || note === undefined) continue;
    notes.set(`${provider}\u0000${model}`, note);
  }
  return notes;
}

/** 把两个命名空间读成一份可编辑草稿：路由来自官方白名单，说明来自 Deeptop 命名空间。 */
export function readSubagentRouting(
  policyNamespace: DshSettingsNamespace | undefined,
  routingNamespace: DshSettingsNamespace | undefined,
): SubagentRoutingSave {
  const notes = routingNotesByName(routingNamespace);
  const rows = allowedRoutingKeys(policyNamespace).map(({ provider, model }) => ({
    provider,
    model,
    note: notes.get(`${provider}\u0000${model}`) ?? "",
  }));
  const enabled = recordOf(policyNamespace?.value)?.enabled === true;
  const guidance = typeof recordOf(routingNamespace?.value)?.guidance === "string"
    ? String(recordOf(routingNamespace?.value)?.guidance)
    : "";
  return { enabled, rows, guidance };
}

/** 第一条重复路由的 `provider/model`，用于在保存前拦下重复行。 */
export function duplicateRoutingKey(rows: readonly SubagentRoutingRow[]): string | undefined {
  const seen = new Set<string>();
  for (const row of rows) {
    const provider = row.provider.trim();
    const model = row.model.trim();
    if (provider === "" || model === "") continue;
    const key = `${provider}/${model}`;
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return undefined;
}

/**
 * 把草稿换算成两个命名空间的最小路径操作。
 *
 * 白名单为空时强制关闭 `enabled`：官方 schema 拒绝「已启用但没有允许路由」的组合。
 * 只有真正变化的字段才产生操作，因此未改动的保存不会重写用户文档。
 * @param current - 当前草稿（来自设置）。
 * @param next - 编辑后的草稿。
 * @returns 官方白名单命名空间与说明命名空间各自的路径操作。
 */
export function subagentRoutingOps(
  current: SubagentRoutingSave,
  next: SubagentRoutingSave,
): { policy: SettingsPathOp[]; routing: SettingsPathOp[] } {
  const rows = next.rows
    .map((row) => ({ provider: row.provider.trim(), model: row.model.trim(), note: row.note.trim() }))
    .filter((row) => row.provider !== "" && row.model !== "");
  const policy: SettingsPathOp[] = [];
  const enabled = next.enabled && rows.length > 0;
  if (enabled !== current.enabled) policy.push({ op: "set", path: ["enabled"], value: enabled });
  const allowedModels = rows.map(({ provider, model }) => ({ provider, model }));
  const currentAllowed = current.rows.map(({ provider, model }) => ({ provider, model }));
  if (!sameJson(allowedModels, currentAllowed)) policy.push({ op: "set", path: ["allowedModels"], value: allowedModels });

  const routing: SettingsPathOp[] = [];
  const routes = rows.map(({ provider, model, note }) => ({ provider, model, note }));
  const currentRoutes = current.rows.map(({ provider, model, note }) => ({ provider, model, note }));
  if (!sameJson(routes, currentRoutes)) routing.push({ op: "set", path: ["routes"], value: routes });
  if (next.guidance !== current.guidance) routing.push({ op: "set", path: ["guidance"], value: next.guidance });
  return { policy, routing };
}
