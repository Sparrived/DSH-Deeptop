// Git 提交树向量布局：从提交 DAG（双亲列表）自行分配泳道并输出布局，
// 供 GitTreeGraph 用 SVG 画连续泳道 + 直角折线边 + 节点。
//
// 泳道规则（对齐 git --graph 的语义）：
// - 主线脊柱（从最新提交沿第一双亲的链）的泳道保持稳定，绝不让路；
// - 首次出现的分支尖端/合并双亲追加到最右侧新泳道；
// - 第一条双亲延续当前泳道；其余双亲（合并）预留右侧新泳道并用跨泳道边汇合；
// - 泳道冲突时主线脊柱优先：抢先占用的一侧交还泳道、其链条转为跨泳道边，避免主线中途折道。

import type { WorkspaceGitGraphLine } from "../lib/desktop";

export type GitLayoutCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  refs: string[];
  isHead: boolean;
  lane: number;
  row: number;
};

/** 一条泳道的纵向区间（行号），画成贯穿该区间的连续垂直线。 */
export type GitLayoutLane = {
  lane: number;
  fromRow: number;
  toRow: number;
};

/** 一条跨泳道的合并/汇合边（同泳道的父子由泳道线自然贯穿）。 */
export type GitLayoutEdge = {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
};

export type GitGraphLayout = {
  commits: GitLayoutCommit[];
  lanes: GitLayoutLane[];
  edges: GitLayoutEdge[];
  /** 总共用到的泳道数（列数）。 */
  columnCount: number;
};

type CommitInput = WorkspaceGitGraphLine & {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
};

type Claim = { by: string; lane: number; row: number };

export function gitGraphLayout(input: WorkspaceGitGraphLine[]): GitGraphLayout {
  const commits = input.filter(
    (line): line is CommitInput =>
      line.hash !== null && line.shortHash !== null && line.subject !== null,
  );
  if (commits.length === 0) {
    return { commits: [], lanes: [], edges: [], columnCount: 0 };
  }

  const parentsOf = new Map(commits.map((commit) => [commit.hash, commit.parents]));
  // 主线脊柱：从最新提交沿第一双亲的链。脊柱上的提交在泳道冲突时拥有优先权。
  const spine = new Set<string>();
  {
    let cursor = commits[0].hash;
    while (cursor && !spine.has(cursor)) {
      spine.add(cursor);
      cursor = parentsOf.get(cursor)?.[0] ?? "";
    }
  }

  const lanes: (string | null)[] = [];
  const laneOf = new Map<string, number>();
  const position = new Map<string, { lane: number; row: number }>();
  const laneFrom = new Map<number, number>();
  const laneTo = new Map<number, number>();
  const claim = new Map<string, Claim>();

  const noteLaneRow = (lane: number, row: number) => {
    if (!laneFrom.has(lane)) laneFrom.set(lane, row);
    laneTo.set(lane, Math.max(laneTo.get(lane) ?? row, row));
  };
  const recordEdge = (
    edgesRaw: Array<{ fromLane: number; fromRow: number; targetHash: string }>,
    fromLane: number,
    fromRow: number,
    targetHash: string,
  ) => {
    edgesRaw.push({ fromLane, fromRow, targetHash });
  };

  const out: GitLayoutCommit[] = [];
  const edgesRaw: Array<{ fromLane: number; fromRow: number; targetHash: string }> = [];
  let row = 0;

  for (const commit of commits) {
    const hash = commit.hash;
    let lane = laneOf.get(hash);
    if (lane === undefined) {
      lane = lanes.length; // 新分支尖端追加到最右侧，避免插入已有泳道左侧
      lanes.push(null);
      laneOf.set(hash, lane);
    }
    lanes[lane] = null;
    laneOf.delete(hash);
    noteLaneRow(lane, row);
    position.set(hash, { lane, row });
    out.push({
      hash,
      shortHash: commit.shortHash,
      subject: commit.subject,
      refs: commit.refs,
      isHead: commit.refs.some((ref) => ref.startsWith("HEAD")),
      lane,
      row,
    });

    const parents = commit.parents;
    for (let index = 0; index < parents.length; index += 1) {
      const parent = parents[index];
      const existing = laneOf.get(parent);
      if (existing !== undefined && lanes[existing] === parent) {
        if (index === 0 && spine.has(hash)) {
          // 主线脊柱抢占：之前占用该双亲的链条让出泳道并转为跨泳道边，
          // 双亲移回主线泳道，保证主线不中途折道。
          const previous = claim.get(parent);
          if (previous) {
            recordEdge(edgesRaw, previous.lane, previous.row, parent);
            lanes[previous.lane] = null;
          }
          lanes[existing] = null;
          lanes[lane] = parent;
          laneOf.set(parent, lane);
          claim.set(parent, { by: hash, lane, row });
        } else {
          // 分支汇入已有泳道：保留该泳道，本提交到双亲画跨泳道边。
          recordEdge(edgesRaw, lane, row, parent);
        }
        continue;
      }
      let parentLane: number;
      if (index === 0) {
        parentLane = lane; // 主线延续当前泳道
      } else {
        parentLane = lanes.length; // 合并双亲追加到最右侧新泳道
        lanes.push(null);
        recordEdge(edgesRaw, lane, row, parent);
      }
      lanes[parentLane] = parent;
      laneOf.set(parent, parentLane);
      claim.set(parent, { by: hash, lane: parentLane, row });
      noteLaneRow(parentLane, row);
    }
    row += 1;
  }

  const edges: GitLayoutEdge[] = [];
  for (const edge of edgesRaw) {
    const target = position.get(edge.targetHash);
    if (!target) continue;
    edges.push({
      fromLane: edge.fromLane,
      fromRow: edge.fromRow,
      toLane: target.lane,
      toRow: target.row,
    });
  }

  const lanesOut: GitLayoutLane[] = [];
  for (let lane = 0; lane < lanes.length; lane += 1) {
    const from = laneFrom.get(lane);
    if (from === undefined) continue;
    const to = laneTo.get(lane) ?? from;
    lanesOut.push({ lane, fromRow: from, toRow: to });
  }

  return { commits: out, lanes: lanesOut, edges, columnCount: lanes.length };
}