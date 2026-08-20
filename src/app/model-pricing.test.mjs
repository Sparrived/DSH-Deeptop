import assert from "node:assert/strict";
import test from "node:test";
import { estimateTokenCost, formatUsd, modelPricing } from "./model-pricing.ts";

test("matches provider model ids and short aliases from the embedded models.dev snapshot", () => {
  assert.equal(modelPricing("deepseek", "deepseek-chat")?.input, 0.14);
  assert.equal(modelPricing("openai-compatible", "gpt-4o")?.output, 10);
  assert.equal(modelPricing("anthropic", "claude-sonnet-4")?.cacheRead, 0.3);
});

test("leaves custom models unpriced", () => {
  assert.equal(modelPricing("local", "my-model"), null);
});

test("estimates input, output, cache read, and cache write spend per million tokens", () => {
  const pricing = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 3 };
  assert.equal(estimateTokenCost({ inputTokens: 100_000, uncachedInputTokens: 100_000, outputTokens: 20_000, cacheReadTokens: 30_000, cacheWriteTokens: 10_000 }, pricing), 0.173);
  assert.equal(formatUsd(0.18), "$0.18");
  assert.equal(formatUsd(0.001), "<$0.01");
  assert.equal(estimateTokenCost({ inputTokens: 100_000, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000, cacheWriteTokens: 0 }, pricing), 0.01);
  assert.equal(estimateTokenCost({ inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 20_000, cacheWriteTokens: 0 }, pricing), 0.082);
});
