import assert from "node:assert/strict";
import test from "node:test";
import { isResultDomainCard, toolDomainCard } from "./tool-domain.ts";

function entryFor(view) {
  return { event: { seq: 1, time: 1, type: "tool/result", data: {} }, view };
}

test("projects the official web_search result card with sources", () => {
  const card = toolDomainCard(entryFor({
    for: "result",
    view: {
      card: "web",
      kind: "search",
      title: "最新 AI 模型",
      sources: [
        { url: "https://example.com/a", title: "A", snippet: "片段 A" },
        { url: "https://example.com/b" },
      ],
      truncated: true,
    },
  }));
  assert.deepEqual(card, {
    domain: "search",
    query: "最新 AI 模型",
    sources: [
      { url: "https://example.com/a", title: "A", snippet: "片段 A" },
      { url: "https://example.com/b" },
    ],
    truncated: true,
  });
});

test("keeps the search answer and drops malformed sources", () => {
  const card = toolDomainCard(entryFor({
    view: {
      card: "web",
      kind: "search",
      title: "q",
      sources: [{ url: "https://ok.example" }, { invalid: true }, "nope"],
      answer: "答案是 X",
    },
  }));
  assert.equal(card?.domain, "search");
  assert.equal(card?.answer, "答案是 X");
  assert.equal(card?.sources.length, 1);
});

test("projects the web_fetch card with url and status", () => {
  const card = toolDomainCard(entryFor({
    for: "result",
    view: { card: "web", kind: "fetch", title: "https://example.com/page", url: "https://example.com/page", statusCode: 200 },
  }));
  assert.deepEqual(card, { domain: "fetch", title: "https://example.com/page", url: "https://example.com/page", statusCode: 200 });
});

test("projects the skill load card from the pending call view", () => {
  const card = toolDomainCard(entryFor({
    for: "call",
    view: { card: "generic", kind: "read", title: "Load skill frontend-design", rawInput: "frontend-design" },
  }));
  assert.deepEqual(card, { domain: "skill", name: "frontend-design" });
});

test("classifies web domain cards as result content and skills as call context", () => {
  assert.equal(isResultDomainCard({ domain: "search", query: "q", sources: [] }), true);
  assert.equal(isResultDomainCard({ domain: "fetch", title: "https://example.com" }), true);
  assert.equal(isResultDomainCard({ domain: "skill", name: "frontend-design" }), false);
  assert.equal(isResultDomainCard(undefined), false);
});

test("returns undefined for absent or non-domain views", () => {
  assert.equal(toolDomainCard({ event: { seq: 1, time: 1, type: "tool/result", data: {} } }), undefined);
  assert.equal(toolDomainCard(entryFor(undefined)), undefined);
  assert.equal(toolDomainCard(entryFor({ for: "result", view: { card: "diff" } })), undefined);
  assert.equal(toolDomainCard(entryFor({ for: "result", view: { card: "web", kind: "unknown" } })), undefined);
});