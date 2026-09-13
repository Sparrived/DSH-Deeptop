import type { DshJob, DshJobOutput } from "../lib/desktop";

/**
 * 任务输出视图模型。
 *
 * `job.output` 返回的是生产方的**非消费式投影**（DSH `ctx.jobs.peek`）：模型持有
 * 唯一的消费式读取游标，桌面端只能重复投影、不能取走输出，因此这里只做「投影 →
 * 界面状态」的纯映射。本模块保持纯函数，不触碰 React、Tauri 或 Bridge。
 */

/** 展开的任务要渲染的内容形态。 */
export type TaskOutputView =
  | { kind: "text"; text: string }
  | { kind: "empty" }
  | { kind: "unsupported" };

/** 任务是否仍在产生输出（运行中或正在停止）。 */
export function isLiveJob(job: DshJob | undefined): boolean {
  return job !== undefined && (job.status === "running" || job.status === "stopping");
}

/**
 * 展开的任务是否值得跟随心跳刷新。已结束的任务输出不再增长，展开时读一次即可；
 * 只有仍在运行的任务需要跟随，避免空闲时反复请求。
 */
export function shouldFollowTaskOutput(job: DshJob | undefined): boolean {
  return isLiveJob(job);
}

/** 把一次任务输出投影映射为界面状态。 */
export function taskOutputView(output: DshJobOutput): TaskOutputView {
  if (!output.available) return { kind: "unsupported" };
  return output.text.length > 0 ? { kind: "text", text: output.text } : { kind: "empty" };
}
