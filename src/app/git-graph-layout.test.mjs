import assert from "node:assert/strict";
import test from "node:test";
import {
  GIT_GRAPH_CURVE_RADIUS,
  GIT_GRAPH_LANE_WIDTH,
  GIT_GRAPH_NODE_RADIUS,
  GIT_GRAPH_ROW_HEIGHT,
  gitGraphLaneLinePath,
  gitGraphLaneShiftPath,
  gitGraphLaneX,
  gitGraphLayout,
  gitGraphMergePath,
  gitGraphWidth,
  gitGraphRowHeights,
  gitGraphRowOffsets,
  gitGraphVisibleRange,
  insertGraphMarkers,
  MAX_INLINE_REFS,
  splitInlineRefs,
} from "./git-graph-layout.ts";
import { GIT_GRAPH_LANE_COLOR_COUNT } from "./git-model.ts";

/** 用索引构造 40 位合法哈希，用例里按序号引用提交。 */
function sha(index) {
  return index.toString(16).padStart(40, "0");
}

function commit(index, parents = [], refs = [], subject = `subject ${index}`) {
  return {
    hash: sha(index),
    shortHash: sha(index).slice(0, 7),
    author: "tester",
    email: "tester@example.com",
    timestamp: 1_700_000_000 + index,
    refs,
    parents: parents.map(sha),
    subject,
  };
}

function layoutOf(...commits) {
  return gitGraphLayout(commits);
}

function rowOf(layout, index) {
  return layout.rows.find((row) => row.hash === sha(index));
}

/** 跨行连续性：上一行的输出泳道必须原样成为下一行输入泳道的前缀；
 * 下一行最多再多出一列，且那一列就是该行的尖端提交（泳道从节点本身开始）。 */
function assertLaneContinuity(layout) {
  for (let index = 1; index < layout.rows.length; index += 1) {
    const previous = layout.rows[index - 1].outputLanes.map((lane) => lane.id);
    const current = layout.rows[index].inputLanes.map((lane) => lane.id);
    assert.deepEqual(
      current.slice(0, previous.length),
      previous,
      `第 ${index - 1} 行的 output 必须原样成为第 ${index} 行 input 的前缀`,
    );
    assert.ok(current.length - previous.length <= 1, "每行最多新增一列");
    if (current.length > previous.length) {
      assert.equal(layout.rows[index].nodeTop, null, "新增的那一列就是本行的尖端提交");
      assert.equal(current[current.length - 1], layout.rows[index].hash);
    }
  }
}

test("linear history stays in one lane with a straight line per row", () => {
  const layout = layoutOf(commit(0, [1]), commit(1, [2]), commit(2, []));
  assert.equal(layout.columnCount, 1);
  assert.equal(layout.rows.length, 3);
  assert.deepEqual(layout.rows.map((row) => row.lane), [0, 0, 0]);
  // 每行都没有“贯穿”连线：本行唯一的泳道被节点消费
  assert.deepEqual(layout.rows.map((row) => row.through), [[], [], []]);
  assert.equal(layout.rows[0].nodeTop, null); // 尖端提交：上方没有泳道
  assert.deepEqual(layout.rows[1].nodeTop, { lane: 0, color: 0 });
  assert.deepEqual(layout.rows[0].nodeBottom, { lane: 0, toLane: 0, color: 0 });
  // 根提交：没有双亲，也就没有向下的连线
  assert.equal(layout.rows[2].nodeBottom, null);
  assertLaneContinuity(layout);
});

test("merge opens one extra lane for the second parent and keeps the first parent in place", () => {
  const layout = layoutOf(
    commit(0, [1, 2], ["HEAD -> main"]),
    commit(1, [4]),
    commit(2, [5]),
    commit(4, []),
    commit(5, []),
  );
  const merge = layout.rows[0];
  assert.equal(layout.columnCount, 2);
  assert.equal(merge.lane, 0);
  assert.equal(merge.isHead, true);
  assert.equal(merge.isMerge, true);
  assert.deepEqual(merge.outputLanes.map((lane) => lane.id), [sha(1), sha(2)]);
  // 第一双亲留在第 0 列；合并线指向新开的第 1 列，颜色取分支泳道
  assert.deepEqual(merge.nodeBottom, { lane: 0, toLane: 0, color: 0 });
  assert.deepEqual(merge.merges, [{ lane: 1, color: 1 }]);
  // 两条链各自独占一列，都不换道
  assert.deepEqual(layout.rows.slice(1, 3).map((row) => row.lane), [0, 1]);
  assert.deepEqual(layout.rows[1].through, [{ fromLane: 1, toLane: 1, color: 1 }]);
  assertLaneContinuity(layout);
});

test("octopus merge appends one lane per extra parent", () => {
  const layout = layoutOf(commit(0, [1, 2, 3]), commit(1, []), commit(2, []), commit(3, []));
  const merge = layout.rows[0];
  assert.equal(merge.isMerge, true);
  assert.deepEqual(merge.outputLanes.map((lane) => lane.id), [sha(1), sha(2), sha(3)]);
  assert.deepEqual(merge.merges.map((item) => item.lane), [1, 2]);
  assert.equal(layout.columnCount, 3);
  assertLaneContinuity(layout);
});

test("two branches joining the same ancestor converge inside one row", () => {
  const layout = layoutOf(commit(0, [1, 2]), commit(1, [3]), commit(2, [3]), commit(3, []));
  const second = rowOf(layout, 2);
  // 两条分支在第 2 行汇合：自己的列消失、右侧泳道左移，全部是本行内的连线
  assert.deepEqual(second.inputLanes.map((lane) => lane.id), [sha(3), sha(2)]);
  assert.deepEqual(second.outputLanes.map((lane) => lane.id), [sha(3)]);
  assert.equal(second.lane, 1);
  assert.deepEqual(second.nodeBottom, { lane: 1, toLane: 0, color: 0 });
  assert.deepEqual(second.through, [{ fromLane: 0, toLane: 0, color: 0 }]);
  assert.equal(layout.columnCount, 2);
  assertLaneContinuity(layout);
});

test("a freed lane is compacted away and lanes to its right shift left in the same row", () => {
  // 八爪合并开出三条泳道，中间那条（提交 20）是根提交：它消失后右侧泳道在本行内左移
  const layout = layoutOf(commit(0, [10, 20, 30]), commit(20, []), commit(10, []), commit(30, []));
  const root = rowOf(layout, 20);
  assert.equal(layout.columnCount, 3);
  assert.deepEqual(root.inputLanes.map((lane) => lane.id), [sha(10), sha(20), sha(30)]);
  assert.deepEqual(root.outputLanes.map((lane) => lane.id), [sha(10), sha(30)]);
  assert.equal(root.nodeBottom, null);
  assert.deepEqual(root.through, [
    { fromLane: 0, toLane: 0, color: 0 },
    { fromLane: 2, toLane: 1, color: 2 },
  ]);
  assertLaneContinuity(layout);
});

test("lane colors travel with the lane identity, not the column", () => {
  const layout = layoutOf(commit(0, [1, 2]), commit(1, [3]), commit(2, [3]), commit(3, []));
  const branchColor = layout.rows[0].outputLanes[1].color;
  assert.equal(branchColor, 1);
  // 分支泳道（身份 = 提交 2）在第 2 行仍在第 1 列，颜色不变
  assert.equal(rowOf(layout, 2).inputLanes[1].color, branchColor);
  // 汇合后只剩一条泳道，颜色沿用先出现的那条
  assert.equal(rowOf(layout, 3).inputLanes[0].color, 0);
  for (const row of layout.rows) {
    for (const lane of [...row.inputLanes, ...row.outputLanes]) {
      assert.ok(lane.color >= 0 && lane.color < GIT_GRAPH_LANE_COLOR_COUNT);
    }
  }
});

test("independent branch tips append their own column instead of sharing one", () => {
  // 两个互不相干的尖端（--all 下会出现）：各自成列
  const layout = layoutOf(commit(0, [2]), commit(1, [3]), commit(2, []), commit(3, []));
  assert.equal(layout.rows[0].lane, 0);
  assert.equal(layout.rows[1].lane, 1);
  assert.deepEqual(layout.rows[1].outputLanes.map((lane) => lane.id), [sha(2), sha(3)]);
  assertLaneContinuity(layout);
});

test("sparse history keeps every connection inside its own row", () => {
  // --simplify-by-decoration 会跳过中间提交，父提交仍留在结果集里
  const layout = layoutOf(
    commit(0, [5], ["HEAD -> main"]),
    commit(1, [5], ["feature"]),
    commit(5, [9], ["tag: v1"]),
    commit(9, []),
  );
  for (const row of layout.rows) {
    for (const item of row.through) {
      assert.ok(item.fromLane >= 0 && item.toLane >= 0);
    }
    for (const merge of row.merges) assert.ok(merge.lane >= row.lane);
  }
  assertLaneContinuity(layout);
});

test("random DAG keeps every invariant", () => {
  // 线性同余发生器，保证用例可复现
  let seed = 20240611;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let round = 0; round < 40; round += 1) {
    const total = 40;
    const commits = [];
    for (let index = 0; index < total; index += 1) {
      const parents = [];
      const roll = random();
      const parentCount = index === total - 1 || roll > 0.98 ? 0 : roll > 0.72 ? 2 : 1;
      for (let slot = 0; slot < parentCount; slot += 1) {
        const span = Math.max(1, Math.min(6, total - index - 1));
        const candidate = index + 1 + Math.floor(random() * span);
        if (candidate < total && !parents.includes(candidate)) parents.push(candidate);
      }
      commits.push(commit(index, parents));
    }
    const layout = layoutOf(...commits);
    assert.equal(layout.rows.length, total);
    for (const [index, row] of layout.rows.entries()) {
      // 同一行内泳道身份唯一
      assert.equal(new Set(row.inputLanes.map((lane) => lane.id)).size, row.inputLanes.length);
      assert.equal(new Set(row.outputLanes.map((lane) => lane.id)).size, row.outputLanes.length);
      assert.equal(row.columnCount, Math.max(row.inputLanes.length, row.outputLanes.length));
      assert.ok(row.lane >= 0 && row.lane < Math.max(row.columnCount, 1));
      // 圆点一定在输入泳道里（尖端提交会被补一列，因此同样成立）
      assert.equal(row.inputLanes[row.lane].id, row.hash);
      // 输入泳道里除节点外的每一条都必须在本行内继续存在，且各有一条贯穿连线
      for (const [lane, item] of row.inputLanes.entries()) {
        if (item.id === row.hash) continue;
        assert.ok(
          row.outputLanes.some((candidate) => candidate.id === item.id),
          `第 ${index} 行的泳道 ${item.id} 断线`,
        );
        assert.ok(row.through.some((line) => line.fromLane === lane));
      }
      // 第一双亲在输出泳道里；额外双亲各有一条合并连线
      if (row.nodeBottom) {
        assert.equal(row.outputLanes[row.nodeBottom.toLane].id, commits[index].parents[0]);
      } else {
        assert.equal(commits[index].parents.length, 0);
      }
      assert.equal(row.merges.length, Math.max(0, commits[index].parents.length - 1));
    }
    assertLaneContinuity(layout);
  }
});

test("inserts incoming and outgoing markers without disturbing the lanes", () => {
  const layout = layoutOf(
    commit(0, [1], ["HEAD -> main"]), // HEAD = 提交 0
    commit(1, [2]),
    commit(2, [3]),                  // 共同祖先 = 提交 2
    commit(3, []),
  );
  const withMarkers = insertGraphMarkers(layout, {
    outgoing: { base: sha(2), head: sha(0), count: 2 },
    incoming: { base: sha(2), head: sha(9), count: 1 },
  });

  // outgoing 插在 HEAD 上方，incoming 插在共同祖先上方，共多出两行
  assert.deepEqual(
    withMarkers.rows.map((row) => (row.synthetic ? row.synthetic : `#${row.hash.slice(-1)}`)),
    ["outgoing", "#0", "#1", "incoming", "#2", "#3"],
  );

  const outgoing = withMarkers.rows[0];
  assert.equal(outgoing.synthetic, "outgoing");
  assert.deepEqual(outgoing.range, { base: sha(2), head: sha(0) });
  assert.equal(outgoing.count, 2);
  // 合成行是直通泳道：输入输出一致，且没有节点上下连线
  assert.deepEqual(outgoing.outputLanes, outgoing.inputLanes);
  assert.equal(outgoing.nodeTop, null);
  assert.equal(outgoing.nodeBottom, null);
  assert.equal(outgoing.through.length, outgoing.inputLanes.length);
  // 插入不改动任何原有行的列与连线
  const original = new Map(layout.rows.map((row) => [row.hash, row]));
  for (const row of withMarkers.rows) {
    if (row.synthetic) continue;
    const before = original.get(row.hash);
    assert.equal(row.lane, before.lane);
    assert.deepEqual(row.through, before.through);
    assert.deepEqual(row.outputLanes.map((lane) => lane.id), before.outputLanes.map((lane) => lane.id));
  }
  assert.equal(withMarkers.columnCount, layout.columnCount);
});

test("skips markers whose anchor is outside the loaded window", () => {
  const layout = layoutOf(commit(0, [1]), commit(1, []));
  // 共同祖先没加载 → 只插入 outgoing
  const onlyOutgoing = insertGraphMarkers(layout, {
    outgoing: { base: "ffff", head: sha(0), count: 1 },
    incoming: { base: "ffff", head: "eeee", count: 3 },
  });
  assert.deepEqual(onlyOutgoing.rows.map((row) => row.synthetic ?? "commit"), ["outgoing", "commit", "commit"]);
  // 两个锚点都缺失时原样返回
  const untouched = insertGraphMarkers(layout, {
    outgoing: { base: "ffff", head: "eeee", count: 1 },
  });
  assert.equal(untouched, layout);
  // 没有标记时不复制行
  assert.equal(insertGraphMarkers(layout, {}), layout);
});

test("computes offsets and the visible range with variable row heights", () => {
  const rows = [{ hash: "a" }, { hash: "b" }, { hash: "c" }];
  // 第二行展开，多出 100px
  const heights = gitGraphRowHeights(rows, (row) => (row.hash === "b" ? 100 : 0));
  assert.deepEqual(heights, [24, 124, 24]);
  const offsets = gitGraphRowOffsets(heights);
  assert.deepEqual(offsets, [0, 24, 148, 172]);

  // 视口覆盖第 0 行与展开行
  assert.deepEqual(gitGraphVisibleRange(offsets, 0, 60, 0), { first: 0, last: 2 });
  // 滚到展开块内部时仍覆盖第 1 行（它比视口高）
  assert.deepEqual(gitGraphVisibleRange(offsets, 100, 40, 0), { first: 1, last: 2 });
  // 展开块很高：滚到它的下半部分时它仍是"包含 y 的那一行"
  assert.deepEqual(gitGraphVisibleRange(offsets, 132, 40, 0), { first: 1, last: 3 });
  // overscan 向两侧放宽
  assert.deepEqual(gitGraphVisibleRange(offsets, 24, 24, 30), { first: 0, last: 2 });
  // 边界：空列表与超出范围的滚动位置
  assert.deepEqual(gitGraphVisibleRange([0], 0, 100, 0), { first: 0, last: 0 });
  assert.deepEqual(gitGraphVisibleRange(offsets, 10_000, 40, 0), { first: 2, last: 3 });
});

test("geometry helpers stay inside the row and line up with lane centers", () => {
  assert.equal(GIT_GRAPH_LANE_WIDTH * 2, GIT_GRAPH_ROW_HEIGHT);
  assert.ok(GIT_GRAPH_CURVE_RADIUS * 2 < GIT_GRAPH_LANE_WIDTH);
  assert.ok(GIT_GRAPH_NODE_RADIUS + 1 < GIT_GRAPH_LANE_WIDTH);
  assert.equal(gitGraphLaneX(0), GIT_GRAPH_LANE_WIDTH);
  assert.equal(gitGraphLaneX(3), GIT_GRAPH_LANE_WIDTH * 4);
  assert.equal(gitGraphWidth(0), GIT_GRAPH_LANE_WIDTH * 2);
  assert.equal(gitGraphWidth(3), GIT_GRAPH_LANE_WIDTH * 4);

  // 直线只占本行高度
  assert.equal(gitGraphLaneLinePath(1), `M ${GIT_GRAPH_LANE_WIDTH * 2} 0 V ${GIT_GRAPH_ROW_HEIGHT}`);

  // 换道：向右时两段圆角为 0 / 1，向左时为 1 / 0
  const right = gitGraphLaneShiftPath(0, 1, true);
  assert.match(right, /^M 12 0 V 7 /);
  assert.match(right, /A 5 5 0 0 0 17 12 /);
  assert.match(right, /A 5 5 0 0 1 24 17 V 24$/);
  const left = gitGraphLaneShiftPath(2, 0, true);
  assert.match(left, /A 5 5 0 0 1 31 12 /);
  assert.match(left, /A 5 5 0 0 0 12 17 V 24$/);
  // 从圆点出发的换道：先平拉，再用一段圆角落回底部
  assert.match(gitGraphLaneShiftPath(1, 0, false), /^M 24 12 H 17 A 5 5 0 0 0 12 17 V 24$/);

  // 合并线：从目标列左缘起弧，并从圆点平拉过去
  assert.match(gitGraphMergePath(0, 2), /^M 30 12 A 12 12 0 0 1 36 24 M 30 12 H 12$/);
});

test("splitInlineRefs keeps short lists fully visible", () => {
  const refs = ["HEAD -> main", "tag: v1.0", "feature/x"];
  const { visible, overflow } = splitInlineRefs(refs);
  assert.deepEqual(visible, refs);
  assert.deepEqual(overflow, []);
});

test("splitInlineRefs collapses overflow refs into a tail", () => {
  const refs = [
    "HEAD -> main",
    "tag: v1.0",
    "tag: v1.1",
    "tag: v2.0",
    "feature/a",
    "feature/b",
    "feature/c",
    "release/2024",
  ];
  const { visible, overflow } = splitInlineRefs(refs);
  assert.equal(visible.length, MAX_INLINE_REFS);
  assert.equal(overflow.length, refs.length - MAX_INLINE_REFS);
  assert.deepEqual(visible, refs.slice(0, MAX_INLINE_REFS));
  assert.deepEqual(overflow, refs.slice(MAX_INLINE_REFS));
  // 可见+溢出完整覆盖原列表，顺序不被打乱
  assert.deepEqual([...visible, ...overflow], refs);
});

test("splitInlineRefs handles empty input", () => {
  assert.deepEqual(splitInlineRefs([]), { visible: [], overflow: [] });
});
