import assert from "node:assert/strict";
import test from "node:test";
import {
  beginRefresh,
  decideGitGraphRefresh,
  GIT_GRAPH_MAX_PAGE,
  GIT_GRAPH_PAGE_SIZE,
  gitGraphHasMore,
  gitGraphRefreshLimit,
  gitRefSignature,
  INITIAL_GIT_GRAPH_REFRESH_STATE,
  mergeRefreshedRows,
  settleRefresh,
} from "./git-graph-refresh.ts";

function line(hash, parents = [], refs = []) {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: "tester",
    email: "tester@example.com",
    timestamp: 1_700_000_000,
    refs,
    parents,
    subject: `subject ${hash}`,
  };
}

/** 造一串线性历史：head 在前，逐条指向更早的提交。 */
function history(hashes) {
  return hashes.map((hash, index) => line(hash, index + 1 < hashes.length ? [hashes[index + 1]] : []));
}

function branch(name, shortOid, isCurrent = false, isRemote = false) {
  return { name, isCurrent, isRemote, upstream: null, shortOid };
}

const status = (overrides = {}) => ({
  isRepository: true,
  root: "/repo",
  branch: "master",
  upstream: "origin/master",
  ahead: 0,
  behind: 0,
  staged: 0,
  changed: 0,
  untracked: 0,
  conflicted: 0,
  files: [],
  ...overrides,
});

test("ref signature ignores branch listing order but tracks every ref change", () => {
  const branches = [branch("master", "aaaaaaa", true), branch("origin/master", "aaaaaaa", false, true)];
  const swapped = [branches[1], branches[0]];
  assert.equal(gitRefSignature(status(), branches), gitRefSignature(status(), swapped));

  const base = gitRefSignature(status(), branches);
  assert.notEqual(base, gitRefSignature(status(), [branch("master", "bbbbbbb", true), branches[1]]));
  assert.notEqual(base, gitRefSignature(status(), [branch("master", "aaaaaaa", true), branch("topic", "ccccccc"), branches[1]]));
  assert.notEqual(base, gitRefSignature(status({ branch: "topic" }), branches));
  assert.notEqual(base, gitRefSignature(status({ ahead: 1 }), branches));
  assert.notEqual(base, gitRefSignature(status({ upstream: null }), branches));
  // 只有工作区文件变化时指纹不变：图谱不需要重取
  assert.equal(base, gitRefSignature(status({ changed: 3, files: [] }), branches));
  // 没有仓库信息时不抛错
  assert.equal(typeof gitRefSignature(null, null), "string");
});

test("refresh limit covers the loaded window without exceeding the backend cap", () => {
  assert.equal(gitGraphRefreshLimit(0), GIT_GRAPH_PAGE_SIZE);
  assert.equal(gitGraphRefreshLimit(GIT_GRAPH_PAGE_SIZE), GIT_GRAPH_PAGE_SIZE);
  assert.equal(gitGraphRefreshLimit(150), 150);
  assert.equal(gitGraphRefreshLimit(250), GIT_GRAPH_MAX_PAGE);
  assert.equal(gitGraphRefreshLimit(5000), GIT_GRAPH_MAX_PAGE);

  assert.equal(gitGraphHasMore(GIT_GRAPH_PAGE_SIZE, GIT_GRAPH_PAGE_SIZE), true);
  assert.equal(gitGraphHasMore(42, GIT_GRAPH_PAGE_SIZE), false);
});

test("a refresh that only adds commits keeps the loaded rows and the end-of-history flag", () => {
  const previous = history(["a", "b", "c"]);
  const fresh = history(["n", "a", "b", "c", "d", "e"]);
  const merged = mergeRefreshedRows({ fresh, previous, limit: GIT_GRAPH_PAGE_SIZE, previousHasMore: false });
  assert.equal(merged.mode, "incremental");
  assert.deepEqual(merged.rows.map((row) => row.hash), ["n", "a", "b", "c"]);
  // 旧数据已经到仓库最早历史，新增提交不会把“已到最后”刷掉
  assert.equal(merged.hasMore, false);

  // 连续刷新（多次提交）同样成立
  const again = mergeRefreshedRows({
    fresh: history(["m", "n", "a", "b"]),
    previous: merged.rows,
    limit: GIT_GRAPH_PAGE_SIZE,
    previousHasMore: false,
  });
  assert.equal(again.mode, "incremental");
  assert.deepEqual(again.rows.map((row) => row.hash), ["m", "n", "a", "b", "c"]);
});

test("deeply paged history survives a refresh even though one request is capped", () => {
  const hashes = Array.from({ length: 250 }, (_, index) => `h${index}`);
  const previous = history(hashes);
  // 新提交 1 条，请求上限 200 条：新页覆盖到旧头部之后，旧行整体保留
  const fresh = history(["new", ...hashes.slice(0, GIT_GRAPH_MAX_PAGE - 1)]);
  const merged = mergeRefreshedRows({
    fresh,
    previous,
    limit: gitGraphRefreshLimit(previous.length),
    previousHasMore: true,
  });
  assert.equal(merged.mode, "incremental");
  assert.equal(merged.rows.length, previous.length + 1);
  assert.equal(merged.rows[0].hash, "new");
  assert.equal(merged.hasMore, true);
});

test("a rewritten history falls back to replacing the rows", () => {
  const previous = history(["a", "b", "c"]);
  // 头部被 rebase 掉：旧头部不在新页里
  const rewritten = mergeRefreshedRows({
    fresh: history(["x", "y", "z"]),
    previous,
    limit: GIT_GRAPH_PAGE_SIZE,
    previousHasMore: false,
  });
  assert.equal(rewritten.mode, "replaced");
  assert.deepEqual(rewritten.rows.map((row) => row.hash), ["x", "y", "z"]);
  assert.equal(rewritten.hasMore, false);

  // 锚点还在，但锚点之后的拓扑序变了（新合并插进来）：重叠区不一致，同样整页替换
  const diverged = mergeRefreshedRows({
    fresh: history(["a", "side", "b", "c"]),
    previous,
    limit: GIT_GRAPH_PAGE_SIZE,
    previousHasMore: false,
  });
  assert.equal(diverged.mode, "replaced");
  assert.deepEqual(diverged.rows.map((row) => row.hash), ["a", "side", "b", "c"]);
});

test("an empty previous window is a plain page load", () => {
  const merged = mergeRefreshedRows({
    fresh: history(["a", "b"]),
    previous: [],
    limit: GIT_GRAPH_PAGE_SIZE,
    previousHasMore: true,
  });
  assert.equal(merged.mode, "replaced");
  assert.equal(merged.hasMore, false);
});

test("concurrent refreshes collapse into one trailing refresh", () => {
  let state = INITIAL_GIT_GRAPH_REFRESH_STATE;

  const first = beginRefresh(state);
  assert.equal(first.run, true);
  state = first.state;

  // 在途期间到来的两次刷新都只登记一次 pending
  const second = beginRefresh(state);
  assert.equal(second.run, false);
  state = second.state;
  const third = beginRefresh(state);
  assert.equal(third.run, false);
  state = third.state;
  assert.deepEqual(state, { inFlight: true, pending: true });

  // 在途请求结束 → 立刻补一次尾随刷新；名额仍归当前调用方，其他调用者不会插进来起第二个请求
  const settled = settleRefresh(state);
  assert.equal(settled.run, true);
  state = settled.state;
  assert.deepEqual(state, { inFlight: true, pending: false });
  assert.deepEqual(beginRefresh(state), { state: { inFlight: true, pending: true }, run: false });

  const done = settleRefresh(state);
  assert.equal(done.run, false);
  assert.deepEqual(done.state, INITIAL_GIT_GRAPH_REFRESH_STATE);
});

test("the trailing refresh contract never runs two requests at once and never loses one", () => {
  // 复刻组件里的用法：入口 beginRefresh，一次请求后 settleRefresh；run 为真就继续跑尾随刷新
  let state = INITIAL_GIT_GRAPH_REFRESH_STATE;
  const merged = [];
  const request = (label) => {
    const begun = beginRefresh(state);
    state = begun.state;
    if (!begun.run) {
      merged.push(label);
      return null;
    }
    return label;
  };
  const settle = (label) => {
    const settled = settleRefresh(state);
    state = settled.state;
    return settled.run ? `${label}-trailing` : null;
  };

  assert.equal(request("poll"), "poll");
  assert.equal(request("focus"), null); // 在途 → 合并
  assert.equal(request("mutation"), null); // 在途 → 只登记一次 pending
  assert.equal(settle("poll"), "poll-trailing");
  assert.equal(request("manual"), null); // 尾随刷新期间其它调用仍被合并，不会并发第二条 git log
  assert.equal(settle("poll-trailing"), "poll-trailing-trailing"); // 合并进来的刷新不会丢
  assert.equal(settle("poll-trailing-trailing"), null);
  assert.deepEqual(state, INITIAL_GIT_GRAPH_REFRESH_STATE);
  assert.deepEqual(merged, ["focus", "mutation", "manual"]);

  // 释放后可以重新起请求
  assert.equal(request("manual"), "manual");
  assert.equal(settle("manual"), null);
  assert.deepEqual(state, INITIAL_GIT_GRAPH_REFRESH_STATE);
});

test("refresh decisions keep git log off the hot path while the graph is hidden", () => {
  // 有数据且 refs 未变：什么都不做（15 秒轮询、窗口聚焦都不再重取图谱）
  assert.deepEqual(
    decideGitGraphRefresh({ visible: true, hasData: true, stale: false, refsChanged: false, forced: false }),
    { reload: false, markStale: false },
  );
  // refs 变了但图谱不可见：只记账，不跑 git log
  assert.deepEqual(
    decideGitGraphRefresh({ visible: false, hasData: true, stale: false, refsChanged: true, forced: false }),
    { reload: false, markStale: true },
  );
  // 记账后进入图谱视图：补取
  assert.deepEqual(
    decideGitGraphRefresh({ visible: true, hasData: true, stale: true, refsChanged: false, forced: false }),
    { reload: true, markStale: false },
  );
  // 首次进入且不可见：等可见再取
  assert.deepEqual(
    decideGitGraphRefresh({ visible: false, hasData: false, stale: false, refsChanged: true, forced: false }),
    { reload: false, markStale: true },
  );
  assert.deepEqual(
    decideGitGraphRefresh({ visible: true, hasData: false, stale: false, refsChanged: false, forced: false }),
    { reload: true, markStale: false },
  );
  // 手动刷新无条件重取
  assert.deepEqual(
    decideGitGraphRefresh({ visible: false, hasData: true, stale: false, refsChanged: false, forced: true }),
    { reload: true, markStale: false },
  );
});
