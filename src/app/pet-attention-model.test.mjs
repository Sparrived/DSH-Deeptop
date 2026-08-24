import assert from "node:assert/strict";
import test from "node:test";
import { petCompletionMessageFromHistory, projectPetActivity } from "./pet-attention-model.ts";

const sessions = [
  { sessionId: "session-active", title: "当前会话", running: false, updatedAt: 10 },
  { sessionId: "session-background", title: "后台会话", running: true, updatedAt: 20 },
  { sessionId: "session-ready", title: "等待回复", running: false, updatedAt: 30 },
];

test("prioritizes needs-input, failed, ready, then running activities", () => {
  const activity = projectPetActivity({
    activeSessionId: "session-active",
    sessions,
    approvals: [{
      rpcId: "approval-background",
      sessionId: "session-background",
      approvalId: "approval-1",
      toolName: "shell",
    }],
    questions: [{
      rpcId: "question-active",
      sessionId: "session-active",
      questions: [{
        id: "choice",
        question: "使用哪一种方案？",
        options: [{ label: "方案 A" }, { label: "方案 B" }],
      }],
    }],
    completions: [{
      id: "completed:session-ready:30",
      sessionId: "session-ready",
      kind: "completed",
      title: "等待回复",
      message: "已经检查完毕。",
      updatedAt: 30,
      previewLoaded: true,
    }],
  });

  assert.equal(activity.state, "waiting");
  assert.equal(activity.attention?.kind, "question");
  assert.deepEqual(activity.attention?.options, ["方案 A", "方案 B"]);
  assert.deepEqual(activity.activities.map((item) => item.kind), ["question", "approval", "completed"]);
  assert.equal(activity.activities[2]?.message, "已经检查完毕。");
});

test("keeps only the highest-priority activity for each session", () => {
  const activity = projectPetActivity({
    activeSessionId: null,
    sessions,
    approvals: [{
      rpcId: "approval-background",
      sessionId: "session-background",
      approvalId: "approval-1",
      toolName: "shell",
      reason: "需要读取工作区外文件",
    }],
    questions: [],
    completions: [],
  });

  assert.equal(activity.activities.length, 1);
  assert.equal(activity.activities[0]?.kind, "approval");
  assert.equal(activity.activities[0]?.toolName, "shell");
  assert.equal(activity.target?.sessionId, "session-background");
});

test("surfaces every unread completion and retains a quick-reply target", () => {
  const completed = projectPetActivity({
    activeSessionId: "session-active",
    sessions: sessions.map((session) => ({ ...session, running: false })),
    approvals: [],
    questions: [],
    completions: [
      {
        id: "completed:session-ready:30",
        sessionId: "session-ready",
        kind: "completed",
        title: "等待回复",
        message: "第一项已经完成。",
        updatedAt: 30,
        previewLoaded: true,
      },
      {
        id: "failed:session-background:20",
        sessionId: "session-background",
        kind: "failed",
        title: "后台会话",
        message: "任务运行失败，可以打开会话查看详情或直接补充说明。",
        updatedAt: 20,
        previewLoaded: true,
      },
    ],
  });

  assert.equal(completed.state, "failed");
  assert.deepEqual(completed.activities.map((item) => item.kind), ["failed", "completed"]);
  assert.equal(completed.attention?.sessionId, "session-background");
  assert.equal(completed.activities[1]?.canReply, true);

  const idle = projectPetActivity({
    activeSessionId: "session-active",
    sessions: sessions.map((session) => ({ ...session, running: false })),
    approvals: [],
    questions: [],
    completions: [],
  });
  assert.equal(idle.state, "idle");
  assert.equal(idle.attention, undefined);
  assert.deepEqual(idle.target, { sessionId: "session-active", title: "当前会话" });
});

test("requires the full app for multiple questions instead of fabricating a partial answer", () => {
  const activity = projectPetActivity({
    activeSessionId: "session-active",
    sessions,
    approvals: [],
    questions: [{
      rpcId: "question-many",
      sessionId: "session-active",
      questions: [
        { id: "one", question: "第一个问题" },
        { id: "two", question: "第二个问题" },
      ],
    }],
    completions: [],
  });

  assert.equal(activity.attention?.canReply, false);
  assert.deepEqual(activity.attention?.options, []);
});

test("extracts only the final assistant reply as a compact preview", () => {
  const preview = petCompletionMessageFromHistory([
    { event: { seq: 1, time: 1, type: "assistant/message", data: { message: { content: [{ type: "text", text: "较早回复" }] } } } },
    { event: { seq: 2, time: 2, type: "tool/result", data: { content: "不应展示的工具输出" } } },
    { event: { seq: 3, time: 3, type: "assistant/message", data: { message: { content: [{ type: "text", text: "最终回复\n\n包含结论" }] } } } },
    { event: { seq: 4, time: 4, type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "流式片段" } } } },
  ]);

  assert.equal(preview, "最终回复 包含结论");
});

test("strips fenced code blocks that may contain secrets from the preview", () => {
  const preview = petCompletionMessageFromHistory([
    { event: { seq: 1, time: 1, type: "assistant/message", data: { message: { content: [{ type: "text", text: "配置如下：\n```bash\nexport API_KEY=sk-secret-123\n```\n完成。" }] } } } },
  ]);
  assert.equal(preview, "配置如下： 完成。");

  // 未闭合的围栏：从首个 ``` 起全部丢弃，避免残留半段代码。
  const unterminated = petCompletionMessageFromHistory([
    { event: { seq: 1, time: 1, type: "assistant/message", data: { message: { content: [{ type: "text", text: "结论已就绪。\n```\ntoken = abc123" }] } } } },
  ]);
  assert.equal(unterminated, "结论已就绪。");

  // 行内代码只去掉反引号，保留可读内容。
  const inline = petCompletionMessageFromHistory([
    { event: { seq: 1, time: 1, type: "assistant/message", data: { message: { content: [{ type: "text", text: "请查看 `README.md` 说明" }] } } } },
  ]);
  assert.equal(inline, "请查看 README.md 说明");
});

test("bounds projected fields to the native validate_activity limits", async () => {
  const { MAX_PET_TITLE_CHARS, MAX_PET_MESSAGE_CHARS, MAX_PET_TOOL_NAME_CHARS, MAX_PET_OPTION_CHARS } =
    await import("./pet-attention-model.ts");
  const longText = "长".repeat(500);
  const activity = projectPetActivity({
    activeSessionId: null,
    sessions: [{ sessionId: "session-long", title: longText, running: false, updatedAt: 5 }],
    approvals: [{
      rpcId: "approval-long",
      sessionId: "session-long",
      approvalId: "approval-1",
      toolName: longText,
      reason: longText,
    }],
    questions: [{
      rpcId: "question-long",
      sessionId: "session-long",
      questions: [{ id: "one", question: longText, options: [{ label: longText }] }],
    }],
    completions: [],
  });

  for (const item of activity.activities) {
    assert.ok(Array.from(item.title).length <= MAX_PET_TITLE_CHARS);
    assert.ok(Array.from(item.message).length <= MAX_PET_MESSAGE_CHARS);
    if (item.toolName !== undefined) {
      assert.ok(Array.from(item.toolName).length <= MAX_PET_TOOL_NAME_CHARS);
    }
    for (const option of item.options) {
      assert.ok(Array.from(option).length <= MAX_PET_OPTION_CHARS);
    }
  }
  if (activity.target) {
    assert.ok(Array.from(activity.target.title).length <= MAX_PET_TITLE_CHARS);
  }
});
