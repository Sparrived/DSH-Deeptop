import assert from "node:assert/strict";
import test from "node:test";
import { contentSegments, formatTokens } from "./message-model.ts";

test("keeps durable image references for conversation rendering", () => {
  assert.deepEqual(contentSegments([
    { type: "text", text: "看看这张图" },
    { type: "image", attachment: { attachmentId: "attachment-1", mediaType: "image/jpeg", name: "画面.jpg" } },
  ]), {
    text: "看看这张图",
    reasoning: "",
    images: [{ mediaType: "image/jpeg", attachmentId: "attachment-1", name: "画面.jpg" }],
  });
});

test("keeps inline image data for live conversation rendering", () => {
  assert.deepEqual(contentSegments([
    { type: "image", mediaType: "image/png", data: "QUJD", name: "画面.png" },
  ]).images, [{ mediaType: "image/png", data: "QUJD", name: "画面.png" }]);
});

test("formats large token counts with readable K/M/B units", () => {
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1_000), "1K");
  assert.equal(formatTokens(12_500), "12.5K");
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(1_250_000), "1.25M");
  assert.equal(formatTokens(999_999), "1M");
  assert.equal(formatTokens(-1_250_000), "-1.25M");
  assert.equal(formatTokens(2_000_000_000), "2B");
});
