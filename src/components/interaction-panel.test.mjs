import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

async function loadInteractionPanel() {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL("./InteractionPanel.tsx", import.meta.url))],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    // MarkdownContent 的 KaTeX 样式在 Node 里没有落点。
    loader: { ".css": "empty" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}

const askUserQuestion = {
  rpcId: "rpc-1",
  sessionId: "session-1",
  questions: [
    {
      id: "shape",
      header: "锚点确认",
      question: "卡片是否仍然贴在发送框正上方？",
      options: [{ label: "是" }, { label: "否" }],
    },
  ],
};

const planReviewQuestion = {
  rpcId: "rpc-2",
  sessionId: "session-1",
  questions: [
    {
      id: "plan-review",
      header: "Plan review",
      question: "Approve this plan and leave plan mode?",
      detail: "# Plan\n\nStep 1",
      options: [{ label: "Approve" }, { label: "Keep planning" }],
      intent: { kind: "plan-review", approve: "Approve" },
    },
  ],
};

const approval = {
  rpcId: "rpc-3",
  sessionId: "session-1",
  approvalId: "approval-1",
  toolName: "write",
  reason: "写入工作区外的文件",
};

test("普通 ask-user 提问没有任何内联内容，整块不渲染", async () => {
  const { InteractionPanel } = await loadInteractionPanel();
  const props = {
    locale: "zh",
    approval: null,
    question: askUserQuestion,
    answers: {},
    customAnswers: {},
    onApproval() {},
    onCancelQuestion() {},
    onPlanReview() {},
  };
  // 空面板会在发送框与提问弹层之间留出一条不透明横条。
  assert.equal(InteractionPanel(props), null);
  // 没有提问也没有审批时同样不渲染。
  assert.equal(InteractionPanel({ ...props, question: null }), null);
  // 浮层不接管提问时(没有取消回调)也不渲染空面板。
  assert.equal(InteractionPanel({ ...props, onCancelQuestion: undefined }), null);
});

test("approval 仍然内联渲染交互面板", async () => {
  const { InteractionPanel } = await loadInteractionPanel();
  const panel = InteractionPanel({
    locale: "zh",
    approval,
    question: null,
    answers: {},
    customAnswers: {},
    onApproval() {},
    onPlanReview() {},
  });
  assert.equal(panel.type, "section");
  assert.equal(panel.props.className, "interaction-panel");
  assert.equal(panel.props.children[0].props.className, "approval-request");
});

test("plan-review 仍然内联渲染计划评审卡片", async () => {
  const { InteractionPanel } = await loadInteractionPanel();
  let discussed = 0;
  const panel = InteractionPanel({
    locale: "zh",
    approval: null,
    question: planReviewQuestion,
    answers: {},
    customAnswers: {},
    onApproval() {},
    onCancelQuestion() { discussed += 1; },
    onPlanReview() {},
  });
  const review = panel.props.children[1];
  assert.equal(review.type.name, "PlanReviewPanel");
  assert.equal(review.props.review.approve, "Approve");
  // 「继续讨论」走 onCancelQuestion 取消这次提问。
  review.props.onDiscuss();
  assert.equal(discussed, 1);
});
