// Git 提交树向量布局：从提交 DAG（双亲列表）自行分配泳道并输出布局，
// 供 GitTreeGraph 用 SVG 画连续泳道 + 贝塞尔边 + 节点，避免 ascii 字形的错位与交叉。

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

/**
 * 泳道分配算法（自新到旧遍历，git --graph 保证子提交先于双亲）。
 * - 首次出现的分支尖端追加到最右侧空闲泳道；
 * - 第一个双亲延续当前泳道（主线）；
 * - 其余双亲（合并）预留到右侧新泳道，边用贝塞尔曲线跨泳道连接；
 * - 已被其他分支预留的双亲直接复用其泳道（汇合边，不重复占道）。
 */
export function gitGraphLayout(input: WorkspaceGitGraphLine[]): GitGraphLayout {
  const commits = input.filter(
    (line): line is CommitInput =>
      line.hash !== null && line.shortHash !== null && line.subject !== null,
  );

  const lanes: (string | null)[] = [];
  const laneOf = new Map<string, number>();
  const position = new Map<string, { lane: number; row: number }>();
  const laneFrom = new Map<number, number>();
  const laneTo = new Map<number, number>();

  const freeLane = () => lanes.findIndex((value) => value === null);
  const noteLaneRow = (lane: number, row: number) => {
    if (!laneFrom.has(lane)) laneFrom.set(lane, row);
    laneTo.set(lane, Math.max(laneTo.get(lane) ?? row, row));
  };

  const out: GitLayoutCommit[] = [];
  const edgesRaw: Array<{ fromLane: number; fromRow: number; targetHash: string }> = [];
  let row = 0;

  for (const commit of commits) {
    const hash = commit.hash;
    let lane = laneOf.get(hash);
    if (lane === undefined) {
      const free = freeLane();
      lane = free >= 0 ? free : lanes.length;
      if (lane === lanes.length) lanes.push(null);
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
        // 该双亲已被其他分支预留：本提交到它的边属于跨泳道汇合，复用其泳道。
        edgesRaw.push({ fromLane: lane, fromRow: row, targetHash: parent });
        continue;
      }
      let parentLane: number;
      if (index === 0) {
        parentLane = lane; // 主线延续当前泳道
      } else {
        const free = freeLane();
        parentLane = free >= 0 ? free : lanes.length;
        if (parentLane === lanes.length) lanes.push(null);
        edgesRaw.push({ fromLane: lane, fromRow: row, targetHash: parent });
      }
      lanes[parentLane] = parent;
      laneOf.set(parent, parentLane);
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
