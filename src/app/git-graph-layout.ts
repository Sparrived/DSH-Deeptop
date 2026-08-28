// Git 提交树向量布局：从提交 DAG（双亲列表）自行分配泳道并输出布局，
// 供 GitTreeGraph 用 SVG 画连续泳道 + 圆角折线边 + 节点。
//
// 泳道规则：
// - 主线脊柱（从最新提交沿第一双亲的链）的泳道保持稳定，绝不让路；
// - 首次出现的分支尖端/合并双亲优先复用空闲泳道（优先离分叉点最近的右侧空位），
//   没有空闲才追加新泳道，避免把树拉得太宽；
// - 第一条双亲延续当前泳道；其余双亲（合并）用跨泳道边汇入；
// - 泳道冲突时主线脊柱优先：抢先占用的一侧交还泳道、其链条转为跨泳道边；
// - 泳道线按“占用段”输出：同一泳道被复用多次时输出多段，空档期不画幽灵竖线。

import type { WorkspaceGitGraphLine } from "../lib/desktop";

export type GitLayoutCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string | null;
  email: string | null;
  timestamp: number | null;
  refs: string[];
  isHead: boolean;
  lane: number;
  row: number;
};

/** 一条泳道的占用段：从 fromRow 到 toRow 画一条连续垂直线。 */
export type GitLayoutLaneSegment = {
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
  /** 该边所属分支的泳道（用于取分支颜色，而非主线颜色）。 */
  colorLane: number;
};

export type GitLaneLabelKind = "current" | "branch" | "remote" | "tag" | "other";

/** 一个泳道占用段的分支标签（从该段提交的引用推导）。 */
export type GitLaneLabel = {
  lane: number;
  fromRow: number;
  label: string;
  kind: GitLaneLabelKind;
};

export type GitGraphLayout = {
  commits: GitLayoutCommit[];
  /** 泳道占用段（同一泳道可能有多段）。 */
  laneSegments: GitLayoutLaneSegment[];
  /** 各占用段的分支标签（无引用的段不输出）。 */
  segmentLabels: GitLaneLabel[];
  edges: GitLayoutEdge[];
  /** 总共用到的泳道数（列数）。 */
  columnCount: number;
};

/** 单行可内联的 ref 数量上限：超出部分折叠为「+N」徽标。 */
export const MAX_INLINE_REFS = 5;

/** 一组 ref 拆分为内联可见部分与折叠溢出部分。空数组或短列表不会产生溢出。 */
export function splitInlineRefs(refs: string[]): { visible: string[]; overflow: string[] } {
  if (refs.length <= MAX_INLINE_REFS) return { visible: refs, overflow: [] };
  return { visible: refs.slice(0, MAX_INLINE_REFS), overflow: refs.slice(MAX_INLINE_REFS) };
}

/** 从一组引用推导泳道段标签：HEAD 指向 > 本地/远程分支 > 标签 > 其他。 */
export function deriveLaneLabel(refs: string[]): Omit<GitLaneLabel, "lane" | "fromRow"> | null {
  if (refs.length === 0) return null;
  const head = refs.find((ref) => ref.startsWith("HEAD -> "));
  if (head) return { label: head.slice("HEAD -> ".length), kind: "current" };
  const branch = refs.find((ref) => !ref.startsWith("HEAD") && !ref.startsWith("tag: "));
  if (branch) {
    return { label: branch, kind: branch.includes("/") ? "remote" : "branch" };
  }
  const tag = refs.find((ref) => ref.startsWith("tag: "));
  if (tag) return { label: tag.slice("tag: ".length), kind: "tag" };
  return { label: refs[0], kind: "other" };
}

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
    return { commits: [], laneSegments: [], segmentLabels: [], edges: [], columnCount: 0 };
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
  const claim = new Map<string, Claim>();

  // 泳道占用段：分配时开启/延续，释放时收口；同一泳道的多段互不相连。
  const openFrom = new Map<number, number>();
  const openTo = new Map<number, number>();
  const segments: GitLayoutLaneSegment[] = [];
  const touch = (lane: number, row: number) => {
    if (!openFrom.has(lane)) openFrom.set(lane, row);
    openTo.set(lane, Math.max(openTo.get(lane) ?? row, row));
  };
  const releaseLane = (lane: number, row: number) => {
    // 收口该泳道当前打开的段；与同泳道首尾相接的段合并（避免逐提交收口的碎片），
    // 之后该泳道可被其他分支重新复用（间隔 ≥2 行的新段保持独立）。
    const from = openFrom.get(lane);
    if (from === undefined) return;
    const to = Math.max(openTo.get(lane) ?? from, row, from);
    const adjacent = segments.find(
      (seg) => seg.lane === lane && seg.fromRow - 1 <= to && from <= seg.toRow + 1,
    );
    if (adjacent) {
      adjacent.fromRow = Math.min(adjacent.fromRow, from);
      adjacent.toRow = Math.max(adjacent.toRow, to);
    } else {
      segments.push({ lane, fromRow: from, toRow: to });
    }
    openFrom.delete(lane);
    openTo.delete(lane);
  };

  // 空闲泳道挑选：优先 anchor 右侧最近的空位，其次左侧最近的空位，都没有则追加新泳道。
  const pickFreeLane = (anchor?: number) => {
    const frees: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) if (lanes[i] === null) frees.push(i);
    if (frees.length === 0) {
      const added = lanes.length;
      lanes.push(null);
      return added;
    }
    if (anchor !== undefined) {
      const right = frees.filter((i) => i >= anchor).sort((a, b) => a - b)[0];
      if (right !== undefined) return right;
      const leftNearest = frees.filter((i) => i < anchor).sort((a, b) => b - a)[0];
      if (leftNearest !== undefined) return leftNearest;
    }
    return frees[0];
  };

  const out: GitLayoutCommit[] = [];
  const edgesRaw: Array<{ fromHash: string; fromLane: number; fromRow: number; targetHash: string }> = [];
  let row = 0;

  for (const commit of commits) {
    const hash = commit.hash;
    let lane = laneOf.get(hash);
    if (lane === undefined) {
      lane = pickFreeLane();
      laneOf.set(hash, lane);
    }
    // 该提交离开自己的泳道（随后第一双亲通常会接回同一泳道）
    lanes[lane] = null;
    laneOf.delete(hash);
    releaseLane(lane, row);
    touch(lane, row); // 节点所在行属于占用段：分支顶端从这里起算，上方不画线
    position.set(hash, { lane, row });
    out.push({
      hash,
      shortHash: commit.shortHash,
      subject: commit.subject,
      author: commit.author ?? null,
      email: commit.email ?? null,
      timestamp: commit.timestamp ?? null,
      refs: commit.refs,
      isHead: commit.refs.some((ref) => ref.startsWith("HEAD")),
      lane,
      row,
    });

    let ownLaneContinues = false; // 第一双亲是否接回本泳道（否则本泳道到该节点为止）
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
            edgesRaw.push({ fromHash: previous.by, fromLane: previous.lane, fromRow: previous.row, targetHash: parent });
            lanes[previous.lane] = null;
            releaseLane(previous.lane, row);
          }
          lanes[existing] = null;
          lanes[lane] = parent;
          laneOf.set(parent, lane);
          claim.set(parent, { by: hash, lane, row });
          touch(lane, row); // 抢占后必须重新打开主线占用段，否则主线自此断裂
          ownLaneContinues = true;
        } else {
          // 分支汇入已有泳道：保留该泳道，本提交到双亲画跨泳道边。
          edgesRaw.push({ fromHash: hash, fromLane: lane, fromRow: row, targetHash: parent });
        }
        continue;
      }
      let parentLane: number;
      if (index === 0) {
        parentLane = lane; // 主线延续当前泳道
        ownLaneContinues = true;
      } else {
        parentLane = pickFreeLane(lane); // 合并双亲优先复用右侧最近空闲泳道
        edgesRaw.push({ fromHash: hash, fromLane: lane, fromRow: row, targetHash: parent });
      }
      lanes[parentLane] = parent;
      laneOf.set(parent, parentLane);
      claim.set(parent, { by: hash, lane: parentLane, row });
      if (index === 0) {
        touch(parentLane, row); // 主线延续：延续占用段
      }
      // 非第一双亲（合并预留）不动占用段：分支顶端的竖线从它自己的行才开始
    }
    if (!ownLaneContinues) {
      releaseLane(lane, row); // 根提交/链条已他投：占用段到该节点为止
    }
    row += 1;
  }

  const edges: GitLayoutEdge[] = [];
  for (const edge of edgesRaw) {
    const target = position.get(edge.targetHash);
    if (!target) continue;
    // 合并边颜色取“分支侧”泳道：一端在主线脊柱上时取另一端，否则取目标侧。
    const colorLane = spine.has(edge.fromHash)
      ? target.lane
      : spine.has(edge.targetHash)
        ? edge.fromLane
        : target.lane;
    edges.push({
      fromLane: edge.fromLane,
      fromRow: edge.fromRow,
      toLane: target.lane,
      toRow: target.row,
      colorLane,
    });
  }

  // 收口仍在打开状态的泳道段（截断历史的尾部）：延伸到最后一个提交行。
  const lastRow = Math.max(0, row - 1);
  for (const lane of [...openFrom.keys()].sort((a, b) => a - b)) {
    const from = openFrom.get(lane) as number;
    segments.push({ lane, fromRow: from, toRow: Math.max(openTo.get(lane) ?? from, from, lastRow) });
  }

  // 泳道段分支标签：收集该段内提交的引用，推导分支名。
  const segmentLabels: GitLaneLabel[] = [];
  for (const seg of segments) {
    const refs: string[] = [];
    for (const commit of out) {
      if (commit.lane !== seg.lane || commit.row < seg.fromRow || commit.row > seg.toRow) continue;
      refs.push(...commit.refs);
    }
    const label = deriveLaneLabel(refs);
    if (label) segmentLabels.push({ lane: seg.lane, fromRow: seg.fromRow, ...label });
  }

  return {
    commits: out,
    laneSegments: segments,
    segmentLabels,
    edges,
    columnCount: lanes.length,
  };
}