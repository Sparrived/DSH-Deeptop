import assert from "node:assert/strict";
import test from "node:test";
import { approvalLedgerFromHistory, toolApprovalLabel, toolApprovalKey } from "./permission-audit.ts";

function event(seq, type, data = {}) {
  return { event: { seq, time: 1_700_000_000_000 + seq * 1000, type, data } };
}

test("folds approval asked/decided audit pairs into a per-tool ledger", () => {
  const entries = [
    event(1, "approval/asked", { id: "a", toolName: "fs.write", callId: "call-1", reason: "改写文件" }),
    event(2, "approval/decided", { id: "a", outcome: "allowed-once" }),
    event(3, "approval/asked", { id: "b", toolName: "fs.remove", callId: "call-2" }),
    event(4, "approval/decided", { id: "b", outcome: "rejected" }),
  ];
  const ledger = approvalLedgerFromHistory(entries);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].toolName, "fs.write");
  assert.equal(ledger[0].outcome, "allowed-once");
  assert.equal(ledger[0].callId, "call-1");
  assert.equal(ledger[0].reason, "改写文件");
  assert.equal(ledger[1].toolName, "fs.remove");
  assert.equal(ledger[1].outcome, "rejected");
});

test("keeps only the most recent decision per tool call", () => {
  const entries = [
    event(1, "approval/asked", { id: "a1", toolName: "terminal", callId: "t1" }),
    event(2, "approval/decided", { id: "a1", outcome: "cancelled" }),
    event(3, "approval/asked", { id: "a2", toolName: "terminal", callId: "t1" }),
    event(4, "approval/decided", { id: "a2", outcome: "allowed-once" }),
  ];
  const ledger = approvalLedgerFromHistory(entries);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].outcome, "allowed-once");
  assert.equal(ledger[0].seq, 4);
});

test("ignores unmatched decided and unknown outcomes", () => {
  const entries = [
    event(1, "approval/decided", { id: "orphan", outcome: "allowed-once" }),
    event(2, "approval/asked", { id: "x", toolName: "tool.x" }),
    event(3, "approval/decided", { id: "x", outcome: "maybe" }),
  ];
  assert.deepEqual(approvalLedgerFromHistory(entries), []);
});

test("labels outcomes and builds stable dedupe keys", () => {
  assert.equal(toolApprovalLabel("allowed-once"), "已允许");
  assert.equal(toolApprovalLabel("rejected"), "已拒绝");
  assert.equal(toolApprovalLabel("cancelled"), "已取消");
  assert.equal(toolApprovalLabel("unavailable"), "不可用");
  assert.equal(toolApprovalKey({ toolName: "fs.write", callId: "c1" }), "callId:c1");
  assert.equal(toolApprovalKey({ toolName: "fs.write" }), "tool:fs.write");
});