// 任务输出视图模型：`job.output` 的非消费式投影如何映射为界面状态，以及展开的
// 任务是否值得跟随心跳刷新（运行中才跟随）。

import assert from "node:assert/strict";
import test from "node:test";
import { isLiveJob, shouldFollowTaskOutput, taskOutputView } from "./task-output-model.ts";

const job = (overrides = {}) => ({
  id: "bash-1",
  kind: "bash",
  label: "pnpm test",
  status: "running",
  startedAt: 1_000,
  ...overrides,
});

test("maps a projection with text to the text view", () => {
  assert.deepEqual(taskOutputView({ job: job(), available: true, text: "out\n" }), {
    kind: "text",
    text: "out\n",
  });
});

test("maps an empty projection to the empty view", () => {
  assert.deepEqual(taskOutputView({ job: job(), available: true, text: "" }), { kind: "empty" });
});

test("maps an unavailable projection to the unsupported view instead of text", () => {
  assert.deepEqual(taskOutputView({ job: job(), available: false, text: "" }), { kind: "unsupported" });
  // 即使生产方意外带回了文本，不可用就是不可用。
  assert.deepEqual(taskOutputView({ job: job(), available: false, text: "leak" }), { kind: "unsupported" });
});

test("only running and stopping tasks are live", () => {
  assert.equal(isLiveJob(job({ status: "running" })), true);
  assert.equal(isLiveJob(job({ status: "stopping" })), true);
  assert.equal(isLiveJob(job({ status: "completed" })), false);
  assert.equal(isLiveJob(job({ status: "killed" })), false);
  assert.equal(isLiveJob(job({ status: "failed" })), false);
  assert.equal(isLiveJob(undefined), false);
});

test("follows the heartbeat only for tasks that can still produce output", () => {
  assert.equal(shouldFollowTaskOutput(job({ status: "running" })), true);
  assert.equal(shouldFollowTaskOutput(job({ status: "stopping" })), true);
  assert.equal(shouldFollowTaskOutput(job({ status: "completed" })), false);
  assert.equal(shouldFollowTaskOutput(undefined), false);
});
