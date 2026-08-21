import assert from "node:assert/strict";
import test from "node:test";
import { gitGraphLayout } from "./git-graph-layout.ts";

function commit(hash, parents, shortHash = hash.slice(0, 7), refs = []) {
  return {
    graph: "*",
    hash,
    shortHash,
    timestamp: 0,
    refs,
    parents,
    subject: `subject ${hash}`,
  };
}

function layoutOf(...commits) {
  return gitGraphLayout(commits);
}

test("linear history stays on a single continuous lane", () => {
  const a = commit("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);
  const b = commit("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["cccccccccccccccccccccccccccccccccccccccc"]);
  const c = commit("cccccccccccccccccccccccccccccccccccccccc", []);
  const layout = layoutOf(a, b, c);
  assert.equal(layout.columnCount, 1);
  assert.equal(layout.commits.length, 3);
  assert.deepEqual(layout.commits.map((item) => item.lane), [0, 0, 0]);
  assert.deepEqual(layout.commits.map((item) => item.row), [0, 1, 2]);
  assert.deepEqual(layout.edges, []);
  assert.deepEqual(layout.lanes.map((lane) => [lane.fromRow, lane.toRow]), [[0, 2]]);
});

test("simple merge reserves a sibling lane and draws a cross-lane edge", () => {
  const a = commit("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccccccccccc"], "aaaaaaa", ["HEAD -> main"]);
  const b = commit("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["dddddddddddddddddddddddddddddddddddddddd"]);
  const c = commit("cccccccccccccccccccccccccccccccccccccccc", ["eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);
  const d = commit("dddddddddddddddddddddddddddddddddddddddd", []);
  const e = commit("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", []);
  const layout = layoutOf(a, b, c, d, e);
  assert.equal(layout.columnCount, 2);
  const byHash = Object.fromEntries(layout.commits.map((item) => [item.hash.slice(0, 1), item]));
  assert.equal(byHash.a.lane + byHash.b.lane, 0); // merge 与主线同一泳道
  assert.equal(byHash.c.lane, 1); // 合并的分支在右侧泳道
  const edge = layout.edges.find((item) => item.toLane !== item.fromLane);
  assert.ok(edge, "should have a cross-lane merge edge");
  assert.equal(edge.fromLane, 0);
  assert.equal(edge.toLane, 1);
  assert.equal(layout.commits[0].isHead, true);
});

test("two branches joining a shared ancestor reuse that lane", () => {
  const a0 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const b0 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const c0 = "cccccccccccccccccccccccccccccccccccccccc";
  const m0 = "dddddddddddddddddddddddddddddddddddddddd";
  const m = commit(m0, [b0, c0]);
  const b = commit(b0, [a0]);
  const c = commit(c0, [a0]);
  const a = commit(a0, []);
  const layout = layoutOf(m, b, c, a);
  // 合并提交主线占 lane0；两条分支分别 lane1 / lane2，最终都汇入公共祖先 a0
  const byHash = Object.fromEntries(layout.commits.map((item) => [item.hash.slice(0, 1), item]));
  assert.equal(layout.columnCount, 2);
  assert.equal(byHash.a.lane, 0); // 公共祖先最终在主线泳道
  assert.notEqual(byHash.b.lane, byHash.c.lane);
  const toAncestor = layout.edges.filter((edge) => edge.toRow === byHash.a.row);
  assert.ok(toAncestor.length >= 1, "at least one branch edge should join the shared ancestor lane");
});

test("mainline spine preempts a lane claimed earlier by a merged branch", () => {
  // 复刻真实仓库拓扑：分支合并 B 先把公共祖先 S 占了自己的泳道，
  // 稍后主线提交 Y 才处理到 S —— 主线必须抢占，不能中途折道。
  const t0 = "1111111111111111111111111111111111111111";
  const y0 = "2222222222222222222222222222222222222222";
  const b0 = "3333333333333333333333333333333333333333";
  const d0 = "4444444444444444444444444444444444444444";
  const s0 = "5555555555555555555555555555555555555555";
  const z0 = "6666666666666666666666666666666666666666";
  const t = commit(t0, [y0]);
  const b = commit(b0, [s0, d0]);
  const y = commit(y0, [s0]);
  const s = commit(s0, [z0]);
  const d = commit(d0, [z0]);
  const z = commit(z0, []);
  const layout = layoutOf(t, b, y, s, d, z);
  const by = (h) => layout.commits.find((item) => item.hash === h);
  // 主线脊柱 T-Y-S-Z 全程 lane0，绝不折道
  assert.deepEqual([by(t0).lane, by(y0).lane, by(s0).lane, by(z0).lane], [0, 0, 0, 0]);
  // 分支侧让出泳道：B 的链条转为跨泳道边汇入 S
  const joining = layout.edges.find((edge) => edge.toLane === 0 && edge.toRow === by(s0).row);
  assert.ok(joining, "merged branch should join the spine via a cross-lane edge");
  assert.equal(joining.fromLane, 1);
  assert.equal(joining.fromRow, by(b0).row);
  assert.equal(layout.columnCount, 3);
});
