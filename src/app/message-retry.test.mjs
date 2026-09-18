import assert from "node:assert/strict";
import test from "node:test";
import { retryBoundarySeq, retryPromptSourceParts } from "./message-retry.ts";

function entry(seq, type, data = {}) {
  return { event: { seq, time: seq, type, data } };
}

test("chooses the last completed turn before the retried user event", () => {
  const entries = [
    entry(0, "turn/start"),
    entry(1, "user/message", { content: [{ type: "text", text: "first" }] }),
    entry(2, "turn/end"),
    entry(3, "turn/start"),
    entry(4, "user/message", { content: [{ type: "text", text: "second" }] }),
  ];

  assert.equal(retryBoundarySeq(entries, 4), 2);
  assert.equal(retryBoundarySeq(entries, 1), undefined);
});

test("preserves text and durable image references for retry", () => {
  assert.deepEqual(retryPromptSourceParts([
    { type: "text", text: "描述这张图" },
    { type: "image", attachment: { attachmentId: "attachment-1", mediaType: "image/png", name: "画面.png" } },
  ]), [
    { type: "text", text: "描述这张图" },
    { type: "image", mediaType: "image/png", attachmentId: "attachment-1", name: "画面.png" },
  ]);
});

test("preserves durable file references for retry", () => {
  assert.deepEqual(retryPromptSourceParts([
    { type: "text", text: "看下附件" },
    { type: "file", attachment: { attachmentId: "sha256:abc", name: "报告.txt", bytes: 21 } },
  ]), [
    { type: "text", text: "看下附件" },
    { type: "file", attachmentId: "sha256:abc", name: "报告.txt", bytes: 21 },
  ]);
  // 缺少 bytes 就无法重新取回字节，必须报错而不是发出一个读不到内容的附件。
  assert.throws(
    () => retryPromptSourceParts([{ type: "file", attachment: { attachmentId: "sha256:abc", name: "a.txt" } }]),
    /文件引用无效/,
  );
});

test("normalizes inline data URLs and rejects unusable images", () => {
  assert.deepEqual(retryPromptSourceParts([
    { type: "image", mediaType: "image/jpeg", data: "data:image/jpeg;base64,QUJD" },
  ]), [{ type: "image", mediaType: "image/jpeg", data: "QUJD" }]);
  assert.throws(() => retryPromptSourceParts([{ type: "image", mediaType: "image/png" }]), /图片引用无效/);
});

test("does not silently drop unsupported prompt blocks", () => {
  assert.throws(() => retryPromptSourceParts([
    { type: "text", text: "保留这段文字" },
    { type: "audio", data: "..." },
  ]), /暂不支持重发/);
});
