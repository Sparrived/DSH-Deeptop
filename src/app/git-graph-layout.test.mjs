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

/** 某泳道所有占用段的合并覆盖范围 [minFrom, maxTo]。 */
function coverage(layout, lane) {
  const segs = layout.laneSegments.filter((seg) => seg.lane === lane);
  if (segs.length === 0) return null;
  return [Math.min(...segs.map((s) => s.fromRow)), Math.max(...segs.map((s) => s.toRow))];
}

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddddddddddddddddd";
const E = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

test("linear history stays on a single continuous lane", () => {
  const layout = layoutOf(commit(A, [B]), commit(B, [C]), commit(C, []));
  assert.equal(layout.columnCount, 1);
  assert.equal(layout.commits.length, 3);
  assert.deepEqual(layout.commits.map((item) => item.lane), [0, 0, 0]);
  assert.deepEqual(layout.commits.map((item) => item.row), [0, 1, 2]);
  assert.deepEqual(layout.edges, []);
  // 占用段可能因逐提交收口而拆分，但覆盖必须连续贯穿 0..2
  assert.deepEqual(coverage(layout, 0), [0, 2]);
});

test("simple merge reserves a sibling lane and draws a cross-lane edge", () => {
  const layout = layoutOf(
    commit(A, [B, C], "aaaaaaa", ["HEAD -> main"]),
    commit(B, [D]),
    commit(C, [E]),
    commit(D, []),
    commit(E, []),
  );
  assert.equal(layout.columnCount, 2);
  const byHash = Object.fromEntries(layout.commits.map((item) => [item.hash.slice(0, 1), item]));
  assert.equal(byHash.a.lane + byHash.b.lane, 0); // merge 与主线同一泳道
  assert.equal(byHash.c.lane, 1); // 合并的分支在右侧泳道
  const edge = layout.edges.find((item) => item.toLane !== item.fromLane);
  assert.ok(edge, "should have a cross-lane merge edge");
  assert.equal(edge.fromLane, 0);
  assert.equal(edge.toLane, 1);
  assert.equal(edge.colorLane, 1); // 合并线用分支色
  assert.equal(layout.commits[0].isHead, true);
});

test("two branches joining a shared ancestor reuse that lane", () => {
  const m = commit(D, [B, C]);
  const b = commit(B, [A]);
  const c = commit(C, [A]);
  const a = commit(A, []);
  const layout = layoutOf(m, b, c, a);
  const byHash = Object.fromEntries(layout.commits.map((item) => [item.hash.slice(0, 1), item]));
  assert.equal(layout.columnCount, 2);
  assert.equal(byHash.a.lane, 0); // 公共祖先最终在主线泳道
  assert.notEqual(byHash.b.lane, byHash.c.lane);
  const toAncestor = layout.edges.filter((edge) => edge.toRow === byHash.a.row);
  assert.ok(toAncestor.length >= 1, "at least one branch edge should join the shared ancestor lane");
});

test("mainline spine preempts a lane claimed earlier by a merged branch", () => {
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

test("fork reuses a freed adjacent lane instead of widening the tree", () => {
  const z0 = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
  const w0 = "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww";
  const v0 = "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv";
  const m = commit(A, [B, C]);   // 分叉：B 主线、C 分支
  const y = commit(C, [z0]);     // 分支链继续占用 lane1
  const z = commit(z0, []);      // 分支结束 → lane1 释放
  const x = commit(B, [w0, v0]); // 主线再次分叉：V 应复用刚释放的 lane1
  const w = commit(w0, []);
  const v = commit(v0, []);
  const layout = layoutOf(m, y, z, x, w, v);
  const byHash = Object.fromEntries(layout.commits.map((item) => [item.hash.slice(0, 1), item]));
  // 复用后总宽保持 2（不复用会是 3）
  assert.equal(layout.columnCount, 2);
  assert.equal(byHash.v.lane, 1);
  // 复用后总宽保持 2（不复用会是 3）；新旧占用首尾相接时合并为一条连续线
  const lane1Segs = layout.laneSegments.filter((seg) => seg.lane === 1).map((s) => [s.fromRow, s.toRow]);
  assert.deepEqual(lane1Segs, [[0, 5]]);
});
