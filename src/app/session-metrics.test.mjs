import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMetricDuration,
  formatMetricTokens,
  formatMetricVolume,
  formatTokensPerSecond,
  timingMetricRows,
  usageMetricRows,
} from "./session-metrics.ts";
import { hasTranslation } from "./i18n.ts";

const stats = {
  inputTokens: 12_000,
  outputTokens: 3_400,
  totalTokens: 15_400,
  reasoningTokens: 900,
  uncachedInputTokens: 4_000,
  cacheReadTokens: 8_000,
  cacheWriteTokens: 0,
  contextTokens: 90_000,
  contextLimit: 200_000,
  contextTokensAvailable: true,
  cacheHitRate: 66.6,
  messages: 12,
  turns: 4,
  steps: 9,
  llmMs: 41_000,
  toolMs: 6_000,
  ttftMs: 820,
  ttftSteps: 3,
  decodeMs: 12_000,
  decodeTokens: 2_400,
};

test("formats durations without inventing a value", () => {
  assert.equal(formatMetricDuration(undefined), "—");
  assert.equal(formatMetricDuration(0), "—");
  assert.equal(formatMetricDuration(250), "250 ms");
  assert.equal(formatMetricDuration(1_500), "1s");
  assert.equal(formatMetricDuration(125_000), "2m 05s");
  assert.equal(formatMetricTokens(undefined), "—");
  assert.equal(formatMetricTokens(2_400), "2.4K");
  assert.equal(formatMetricVolume(undefined), "—");
  assert.equal(formatMetricVolume(0), "—");
  assert.equal(formatMetricVolume(820), "820");
  assert.equal(formatMetricVolume(18_200), "18K");
  assert.equal(formatMetricVolume(2_450_000), "2.5M");
});

test("keeps one decimal below 10 tok/s and rounds above", () => {
  assert.equal(formatTokensPerSecond(4.24), "4.2");
  assert.equal(formatTokensPerSecond(37.4), "37");
  assert.equal(formatTokensPerSecond(-3), "0.0");
});

test("derives the timing pill rows from the session stats", () => {
  const rows = timingMetricRows(stats, 125_000);
  assert.deepEqual(rows.map((row) => row.key), ["run", "llm", "tool", "ttft", "decode"]);
  assert.equal(rows[0].value, "2m 05s");
  assert.equal(rows[1].value, "41s");
  assert.equal(rows[3].value, "820 ms");
  assert.equal(rows[4].value, "12s");
  // 解码速度按同一段 decode 计时换算，弹窗与看板口径一致（2.4K / 12s）。
  assert.deepEqual(rows[4].detailParams, { tokens: "2.4K", speed: "200" });
  for (const row of rows) {
    assert.ok(hasTranslation(row.labelKey), `缺少文案键 ${row.labelKey}`);
    if (row.detailKey) assert.ok(hasTranslation(row.detailKey), `缺少文案键 ${row.detailKey}`);
  }
});

test("derives the usage pill rows and only the context row carries a meter", () => {
  const rows = usageMetricRows(stats);
  assert.deepEqual(rows.map((row) => row.key), ["context", "input", "output", "cache", "turns"]);
  assert.equal(rows[0].value, "45%");
  assert.equal(rows[0].detail, "90K / 200K");
  assert.equal(rows[0].percent, 45);
  assert.deepEqual(rows.slice(1).map((row) => row.percent), [undefined, undefined, undefined, undefined]);
  for (const row of rows) assert.ok(hasTranslation(row.labelKey), `缺少文案键 ${row.labelKey}`);
});

test("falls back when context pressure or the window limit is missing", () => {
  const withoutLimit = usageMetricRows({ ...stats, contextLimit: 0 })[0];
  assert.equal(withoutLimit.value, "90K");
  assert.equal(withoutLimit.detailKey, "token.metric.noLimit");
  assert.equal(withoutLimit.percent, 0);

  const unavailable = usageMetricRows({ ...stats, contextTokensAvailable: false })[0];
  assert.equal(unavailable.value, "—");
  assert.equal(unavailable.detailKey, "token.metric.noContext");
  assert.equal(unavailable.percent, undefined);
});
