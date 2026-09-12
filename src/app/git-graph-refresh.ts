// Git 图谱刷新策略（纯投影，只做判定与合并，不调用 React / Bridge）。
//
// 旧行为是「任何刷新 = 重新拉第一页」：15 秒轮询、窗口聚焦、每次 git 操作都会
// 把用户已经翻出来的历史全部丢掉，并且刷掉了「已到最后」的状态。
// 这里改成四件事：
// 1. 只有 refs（分支 / HEAD / upstream / ahead-behind）真的变了才重取图谱，
//    工作区文件变化不重取——提交图不会因为暂存区变化而变化；
// 2. 重取时按“已加载窗口”请求，并把新页与旧行按锚点拼接：提交只增不改，
//    正常提交只是头部多一行，用户的分页与滚动位置都能保住；
// 3. 锚点失配（rebase / amend / 新合并改变了后续拓扑序）时退化为整页替换；
// 4. 同一时刻只跑一个图谱请求，期间到来的刷新合并成一次尾随刷新。

import type { WorkspaceGitBranch, WorkspaceGitGraphLine, WorkspaceGitStatus } from "../lib/desktop";

/** 一页提交条数，与 GitDock 的“加载更多”一致。 */
export const GIT_GRAPH_PAGE_SIZE = 100;
/** 后端 git_graph 的 limit 上限（src-tauri 里 clamp 到 200）。 */
export const GIT_GRAPH_MAX_PAGE = 200;

/** refs 变化指纹：分支集合 + 当前分支 + upstream + ahead/behind。
 * 任一项变化都意味着提交图的引用装饰可能变了，需要重取图谱。 */
export function gitRefSignature(
  status: Pick<WorkspaceGitStatus, "branch" | "upstream" | "ahead" | "behind"> | null,
  branches: WorkspaceGitBranch[] | null,
): string {
  const branchPart = (branches ?? [])
    .map((branch) => `${branch.name}:${branch.shortOid}:${branch.isCurrent ? "1" : "0"}:${branch.isRemote ? "r" : "l"}`)
    .sort()
    .join("|");
  const statusPart = status
    ? `${status.branch ?? ""}@${status.upstream ?? ""}${status.ahead}/${status.behind}`
    : "";
  return `${statusPart}#${branchPart}`;
}

/** 刷新时请求的条数：至少一页、覆盖已加载窗口、不超过后端上限。 */
export function gitGraphRefreshLimit(loadedCount: number): number {
  if (loadedCount <= GIT_GRAPH_PAGE_SIZE) return GIT_GRAPH_PAGE_SIZE;
  return Math.min(loadedCount, GIT_GRAPH_MAX_PAGE);
}

/** 一次“从第一页重取”之后是否还有更早历史。 */
export function gitGraphHasMore(returnedCount: number, limit: number): boolean {
  return returnedCount >= limit;
}

export type GitGraphMergeResult = {
  rows: WorkspaceGitGraphLine[];
  hasMore: boolean;
  /** incremental 表示新页与旧行拼接成功，否则为整页替换。 */
  mode: "incremental" | "replaced";
};

/**
 * 把刷新拿到的新首页与既有行合并。
 * - 旧行为空：整页替换；
 * - 新页里能找到旧头行（锚点）且重叠部分逐行一致：认为历史只是头部增量，
 *   保留旧行并把新提交插到前面，`hasMore` 沿用旧值（“已到最后”不会被刷掉）；
 * - 锚点缺失或重叠不一致（重写历史 / 新合并改变后续拓扑序）：整页替换。
 */
export function mergeRefreshedRows(input: {
  fresh: WorkspaceGitGraphLine[];
  previous: WorkspaceGitGraphLine[];
  limit: number;
  previousHasMore: boolean;
}): GitGraphMergeResult {
  const { fresh, previous, limit, previousHasMore } = input;
  const replaced: GitGraphMergeResult = {
    rows: fresh,
    hasMore: gitGraphHasMore(fresh.length, limit),
    mode: "replaced",
  };
  if (previous.length === 0) return replaced;

  const anchor = fresh.findIndex((row) => row.hash === previous[0].hash);
  if (anchor === -1) return replaced;

  // 重叠区必须逐行一致，否则旧行不能当作新历史的后续片段
  const overlap = Math.min(fresh.length - anchor, previous.length);
  for (let index = 0; index < overlap; index += 1) {
    if (fresh[anchor + index].hash !== previous[index].hash) return replaced;
  }

  return {
    rows: [...fresh.slice(0, anchor), ...previous],
    hasMore: previousHasMore,
    mode: "incremental",
  };
}

/** 并发合并状态：同一时刻只跑一个请求，在途时到来的刷新合并成一次尾随刷新。
 *
 * 调用契约：
 * - 入口调 `beginRefresh`；`run` 为 true 表示拿到在途名额，为 false 表示已被合并；
 * - 每次请求结束调 `settleRefresh`；`run` 为 true 表示还有一次尾随刷新要跑，
 *   此时**在途名额仍然归调用方持有**（状态保持 `inFlight: true`），调用方应直接
 *   再跑一次请求，而不是重新走入口——重新走入口会被自己合并掉。
 * - `run` 为 false 表示没有待补的刷新，名额释放。
 */
export type GitGraphRefreshState = { inFlight: boolean; pending: boolean };

export const INITIAL_GIT_GRAPH_REFRESH_STATE: GitGraphRefreshState = { inFlight: false, pending: false };

/** 登记一次刷新：返回新状态；`run` 为 false 表示已合并进在途请求的尾随刷新。 */
export function beginRefresh(state: GitGraphRefreshState): { state: GitGraphRefreshState; run: boolean } {
  if (state.inFlight) return { state: { inFlight: true, pending: true }, run: false };
  return { state: { inFlight: true, pending: false }, run: true };
}

/** 一次请求结束：`run` 为 true 表示需要立刻补跑一次尾随刷新（名额仍在调用方手上）。 */
export function settleRefresh(state: GitGraphRefreshState): { state: GitGraphRefreshState; run: boolean } {
  if (state.pending) return { state: { inFlight: true, pending: false }, run: true };
  return { state: INITIAL_GIT_GRAPH_REFRESH_STATE, run: false };
}

export type GitGraphRefreshDecision = {
  /** 立刻重取图谱。 */
  reload: boolean;
  /** 不可见时不取数，只标记为过期；进入图谱视图时再补取。 */
  markStale: boolean;
};

/** 刷新判定：refs 未变就不打扰图谱；不可见时只记账，不跑 git log。 */
export function decideGitGraphRefresh(input: {
  visible: boolean;
  hasData: boolean;
  stale: boolean;
  refsChanged: boolean;
  forced: boolean;
}): GitGraphRefreshDecision {
  if (input.forced) return { reload: true, markStale: false };
  if (!input.hasData) return { reload: input.visible, markStale: !input.visible };
  const dirty = input.refsChanged || input.stale;
  if (!dirty) return { reload: false, markStale: false };
  return input.visible ? { reload: true, markStale: false } : { reload: false, markStale: true };
}

/**
 * 头部变化量：`inserted` 是插到旧头部之前的新行数（用于把已滚动的视图按插入高度下移，
 * 让用户正在看的那条提交停在原地）；`headChanged` 表示头部换了（含历史被重写）。
 * 头部没变（只是向下翻页追加）时两者都不变。
 */
export function gitGraphHeadShift(
  previousHead: string | null,
  rows: readonly { hash: string }[],
): { inserted: number; headChanged: boolean } {
  if (previousHead === null) return { inserted: 0, headChanged: rows.length > 0 };
  if (rows.length === 0) return { inserted: 0, headChanged: true };
  if (rows[0].hash === previousHead) return { inserted: 0, headChanged: false };
  const index = rows.findIndex((row) => row.hash === previousHead);
  return index === -1 ? { inserted: 0, headChanged: true } : { inserted: index, headChanged: true };
}
