import assert from "node:assert/strict";
import test from "node:test";
import { modelSupportsImages, promptContentParts } from "./ui-model.ts";

test("allows image prompts when the provider omits modality metadata", () => {
  assert.equal(modelSupportsImages({ id: "model", name: "Model" }), true);
  assert.equal(modelSupportsImages(undefined), true);
});

test("respects an explicit text-only model declaration", () => {
  assert.equal(modelSupportsImages({ id: "model", name: "Model", inputModalities: ["text"] }), false);
  assert.equal(modelSupportsImages({ id: "model", name: "Model", inputModalities: ["text", "image"] }), true);
});

test("builds the DSH prompt shape for image-only and mixed messages", () => {
  const image = { id: "attachment-1", name: "画面.png", mediaType: "image/png", data: "QUJD" };
  assert.deepEqual(promptContentParts("", [image]), [
    { type: "image", mediaType: "image/png", data: "QUJD", name: "画面.png" },
  ]);
  assert.deepEqual(promptContentParts("描述这张图", [image]), [
    { type: "text", text: "描述这张图" },
    { type: "image", mediaType: "image/png", data: "QUJD", name: "画面.png" },
  ]);
});
