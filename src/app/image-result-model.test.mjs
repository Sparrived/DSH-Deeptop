// read_image 结果的展示模型：模型信封的解析，以及结果里的图片块如何随历史投影
// 到达工具行。图片本身走会话附件，信封文本装不下它，所以这条投影是结果区能显示
// 图片的唯一来源。

import assert from "node:assert/strict";
import test from "node:test";
import { imageResultEnvelope } from "./image-result-model.ts";
import { eventToolImages } from "./message-model.ts";
import { transcriptFromHistory } from "./conversation-model.ts";

const ENVELOPE = [
  "<path>shots/card.png</path>",
  "<type>image</type>",
  "<content>",
  "image/png image, 320x200 px, 4096 bytes",
  "</content>",
].join("\n");

const ATTACHMENT = {
  attachmentId: "attachment-1",
  mediaType: "image/png",
  bytes: 4096,
  width: 320,
  height: 200,
  name: "card.png",
};

function entry(seq, type, data) {
  return { event: { seq, time: 1_000 + seq, type, data } };
}

test("reads the model envelope as a path and a description line", () => {
  assert.deepEqual(imageResultEnvelope(ENVELOPE), {
    path: "shots/card.png",
    detail: "image/png image, 320x200 px, 4096 bytes",
  });
  // 前后空白不影响识别。
  assert.deepEqual(imageResultEnvelope(`\n${ENVELOPE}\n`), imageResultEnvelope(ENVELOPE));
});

test("declines text that is not the image envelope", () => {
  assert.equal(imageResultEnvelope(""), undefined);
  assert.equal(imageResultEnvelope("plain result"), undefined);
  // 只有部分信封不算图片读取，避免把任意 XML 文本当成路径。
  assert.equal(imageResultEnvelope("<path>a.png</path>\n<type>image</type>"), undefined);
  assert.equal(imageResultEnvelope("<path></path>\n<type>image</type>\n<content>\n\n</content>"), undefined);
});

test("collects the image blocks one tool result returned", () => {
  const event = {
    type: "tool/result",
    data: {
      message: {
        source: { callId: "call-1" },
        content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: ENVELOPE }, { type: "image", attachment: ATTACHMENT }] }],
      },
    },
  };
  assert.deepEqual(eventToolImages(event), [{ mediaType: "image/png", attachmentId: "attachment-1", name: "card.png" }]);
  assert.deepEqual(eventToolImages({ type: "tool/call", data: {} }), []);
  assert.deepEqual(eventToolImages({ type: "tool/result", data: { content: [{ type: "text", text: "done" }] } }), []);
});

test("pairs a read_image result's image onto its call row", () => {
  const history = [
    entry(1, "step/start", { turn: 1, step: 1 }),
    entry(2, "tool/call", { turn: 1, step: 1, name: "read_image", callId: "call-1", arguments: { file_path: "shots/card.png" } }),
    entry(3, "tool/result", {
      turn: 1,
      step: 1,
      message: {
        source: { callId: "call-1" },
        content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: ENVELOPE }, { type: "image", attachment: ATTACHMENT }] }],
      },
    }),
  ];

  const row = transcriptFromHistory(history).find((item) => item.kind === "tool");

  assert.equal(row.toolResultText, ENVELOPE);
  assert.deepEqual(row.images, [{ mediaType: "image/png", attachmentId: "attachment-1", name: "card.png" }]);
});

test("leaves a result-first pairing with the same image", () => {
  const history = [
    entry(1, "tool/result", {
      name: "read_image",
      message: {
        source: { callId: "call-2" },
        content: [{ type: "tool-result", toolCallId: "call-2", content: [{ type: "text", text: ENVELOPE }, { type: "image", attachment: ATTACHMENT }] }],
      },
    }),
    entry(2, "tool/call", { name: "read_image", callId: "call-2", arguments: { file_path: "shots/card.png" } }),
  ];

  // 结果先到时先挂起，调用到达后合并成一行；两条路径都必须带上图片。
  const rows = transcriptFromHistory(history).filter((item) => item.kind === "tool");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].toolResultText, ENVELOPE);
  assert.deepEqual(rows[0].images, [{ mediaType: "image/png", attachmentId: "attachment-1", name: "card.png" }]);
});
