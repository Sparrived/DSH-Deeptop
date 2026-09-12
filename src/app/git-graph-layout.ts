// Git 提交树布局：把按拓扑序（子先于父）排列的提交 DAG 投影成“逐行 view model”，
// 渲染层只画本行内的线段，不需要跨行追踪任何连接。
//
// 模型与 VS Code Source Control Graph 一致
//（src/vs/workbench/contrib/scm/browser/scmHistory.ts 的 toISCMHistoryItemViewModelArray）：
// - 每行有两组泳道 inputLanes / outputLanes，第 N 行的 output 就是第 N+1 行的 input；
// - 泳道身份是“仍在等待出现的提交哈希”，配色挂在泳道身份上，泳道换列不会换色；
// - 第一双亲原地接管当前提交的列（主线永不折道），其余双亲在末尾新开泳道；
// - 双亲已在其列等待时直接并入该列（本行内的汇合斜线），不重复开列；
// - 行末压实空列：空槽位消失、右侧泳道整体左移，同样只表现为本行内的斜线。
//
// 由此得到两条硬性质，也是单测要守住的不变量：
// 1. 任何连线都只活在一行之内（跨行关系由一条持续的竖直泳道表达）；
// 2. 非节点泳道不会凭空消失（要么原样下移，要么在本行换列）。

import type { WorkspaceGitGraphLine } from "../lib/desktop";
import { GIT_GRAPH_LANE_COLOR_COUNT } from "./git-model.ts";

/** 行高（px），同时也是渲染层每行 SVG 的高度。 */
export const GIT_GRAPH_ROW_HEIGHT = 24;
/** 泳道列宽（px）：等于行高的一半，圆角才有对称空间。 */
export const GIT_GRAPH_LANE_WIDTH = GIT_GRAPH_ROW_HEIGHT / 2;
/** 节点圆半径（px）。 */
export const GIT_GRAPH_NODE_RADIUS = 4;
/** 换道圆角半径（px）：必须满足 2r < 列宽，否则水平段会反向。 */
export const GIT_GRAPH_CURVE_RADIUS = 5;

/** 单行可内联的 ref 数量上限：超出部分折叠为「+N」徽标。 */
export const MAX_INLINE_REFS = 5;

/** 一条泳道：身份是等待出现的提交哈希，配色只随身份走。 */
export type GitGraphLane = {
  id: string;
  /** 调色板槽位（0..GIT_GRAPH_LANE_COLOR_COUNT-1）。 */
  color: number;
};

/** 贯穿本行的一条连线：同列为直线，跨列为换道斜线。 */
export type GitGraphThrough = {
  fromLane: number;
  toLane: number;
  color: number;
};

export type GitGraphRow = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string | null;
  email: string | null;
  timestamp: number | null;
  refs: string[];
  isHead: boolean;
  isMerge: boolean;
  /** 圆点所在列。 */
  lane: number;
  /** 圆点配色槽位（该提交所在泳道的颜色）。 */
  color: number;
  /** 本行顶部进入的泳道（列序，无空洞）。 */
  inputLanes: GitGraphLane[];
  /** 本行底部离开的泳道。 */
  outputLanes: GitGraphLane[];
  /** 本行用到的列数 = max(input, output)。 */
  columnCount: number;
  /** 贯穿本行的连线（含换道）。 */
  through: GitGraphThrough[];
  /** 节点上方进入圆点的短竖线；尖端提交（不在输入泳道里）为 null。 */
  nodeTop: { lane: number; color: number } | null;
  /** 节点下方接续第一双亲的连线；根提交为 null。 */
  nodeBottom: { lane: number; toLane: number; color: number } | null;
  /** 其余双亲（合并）的连线：从圆点引到目标泳道。 */
  merges: Array<{ lane: number; color: number }>;
  /**
   * 合成行：不代表真实提交，而是"区间标记"（远端有而我还没有 / 我有而远端没有）。
   * 它是一行直通的泳道，圆点画成虚线环，行内显示区间说明。
   */
  synthetic?: GitGraphMarkerKind;
  /** 合成行指向的区间端点，用于打开区间列表。 */
  range?: { base: string; head: string };
  /** 区间内的提交数。 */
  count?: number;
};

/** 合成行的两种语义：incoming = 远端有而我还没有；outgoing = 我有而远端没有。 */
export type GitGraphMarkerKind = "incoming" | "outgoing";

/** 要在图谱里标出的区间；两个端点都是提交哈希。 */
export type GitGraphRangeMarker = {
  base: string;
  head: string;
  count: number;
};

export type GitGraphLayout = {
  rows: GitGraphRow[];
  /** 全部行用到的最大列数。 */
  columnCount: number;
};

/** 列中心的 x 坐标：第 0 列从 1 个列宽处开始，左侧留出圆角空间。 */
export function gitGraphLaneX(lane: number): number {
  return GIT_GRAPH_LANE_WIDTH * (lane + 1);
}

/** 图谱画布宽度：与 VS Code 相同，按“列数 + 1”个列宽计算。 */
export function gitGraphWidth(columnCount: number): number {
  return GIT_GRAPH_LANE_WIDTH * (Math.max(columnCount, 1) + 1);
}

/** 贯穿一行的直线。 */
export function gitGraphLaneLinePath(lane: number): string {
  return `M ${gitGraphLaneX(lane)} 0 V ${GIT_GRAPH_ROW_HEIGHT}`;
}

/**
 * 换道连线：从 fromLane 平滑移到 toLane，再竖直落到行底。
 * `fromTop` 为 true 时从上边界进入（先竖直、再两段圆角夹一段水平线）；
 * 为 false 时从圆点出发（第一双亲并入别的列），直接平拉后用一段圆角收口。
 */
export function gitGraphLaneShiftPath(fromLane: number, toLane: number, fromTop: boolean): string {
  const radius = GIT_GRAPH_CURVE_RADIUS;
  const mid = GIT_GRAPH_ROW_HEIGHT / 2;
  const xFrom = gitGraphLaneX(fromLane);
  const xTo = gitGraphLaneX(toLane);
  const dir = xTo > xFrom ? 1 : -1;
  // 第二段圆角：向右行进时顺时针（sweep=1），向左行进时逆时针（sweep=0）；
  // 从行顶进入时第一段圆角方向相反，否则圆弧会向内勾。
  const endSweep = dir > 0 ? 1 : 0;
  const startSweep = endSweep === 1 ? 0 : 1;
  if (!fromTop) {
    return [
      `M ${xFrom} ${mid}`,
      `H ${xTo - dir * radius}`,
      `A ${radius} ${radius} 0 0 ${endSweep} ${xTo} ${mid + radius}`,
      `V ${GIT_GRAPH_ROW_HEIGHT}`,
    ].join(" ");
  }
  return [
    `M ${xFrom} 0`,
    `V ${mid - radius}`,
    `A ${radius} ${radius} 0 0 ${startSweep} ${xFrom + dir * radius} ${mid}`,
    `H ${xTo - dir * radius}`,
    `A ${radius} ${radius} 0 0 ${endSweep} ${xTo} ${mid + radius}`,
    `V ${GIT_GRAPH_ROW_HEIGHT}`,
  ].join(" ");
}

/**
 * 非第一双亲的合并连线：从圆点平拉到目标列左缘，再用一段圆弧落进目标列底部。
 * 目标列在左侧时同样成立——水平段始终从「目标列左缘」连到圆点。
 */
export function gitGraphMergePath(fromLane: number, toLane: number): string {
  const xFrom = gitGraphLaneX(fromLane);
  const xTo = gitGraphLaneX(toLane);
  const mid = GIT_GRAPH_ROW_HEIGHT / 2;
  const half = GIT_GRAPH_LANE_WIDTH / 2;
  return [
    `M ${xTo - half} ${mid}`,
    `A ${GIT_GRAPH_LANE_WIDTH} ${GIT_GRAPH_LANE_WIDTH} 0 0 1 ${xTo} ${GIT_GRAPH_ROW_HEIGHT}`,
    `M ${xTo - half} ${mid}`,
    `H ${xFrom}`,
  ].join(" ");
}

/** 一组 ref 拆分为内联可见部分与折叠溢出部分。空数组或短列表不会产生溢出。 */export function splitInlineRefs(refs: string[]): { visible: string[]; overflow: string[] } {
  if (refs.length <= MAX_INLINE_REFS) return { visible: refs, overflow: [] };
  return { visible: refs.slice(0, MAX_INLINE_REFS), overflow: refs.slice(MAX_INLINE_REFS) };
}

/** 逐行推导提交图谱：输入必须是拓扑序（子先于父）的提交列表。 */
export function gitGraphLayout(input: WorkspaceGitGraphLine[]): GitGraphLayout {
  const rows: GitGraphRow[] = [];
  let lanes: GitGraphLane[] = [];
  let colorTick = -1;
  let columnCount = 0;

  for (const commit of input) {
    const hash = commit.hash;
    // 输入泳道 = 上一行的输出泳道；尖端提交（本窗口内没有子提交）在末尾补一列。
    const pending: Array<GitGraphLane | null> = lanes.map((lane) => ({ ...lane }));
    let lane = pending.findIndex((item) => item?.id === hash);
    const isTip = lane === -1;
    if (isTip) {
      colorTick = (colorTick + 1) % GIT_GRAPH_LANE_COLOR_COUNT;
      lane = pending.length;
      pending.push({ id: hash, color: colorTick });
    }
    const inputLanes = pending
      .filter((item): item is GitGraphLane => item !== null)
      .map((item) => ({ ...item }));
    const nodeLane = lane;
    const nodeColor = inputLanes[nodeLane].color;

    // 消费自身列。
    pending[nodeLane] = null;

    // 第一双亲原地接管本列（颜色随泳道下移）；已在别列等待时并入那一列，本列随之被压实掉。
    const parents = commit.parents;
    if (parents.length > 0 && !pending.some((item) => item?.id === parents[0])) {
      pending[nodeLane] = { id: parents[0], color: nodeColor };
    }
    // 其余双亲：已在等待则并入，否则在末尾新开一列。
    for (const parent of parents.slice(1)) {
      if (pending.some((item) => item?.id === parent)) continue;
      colorTick = (colorTick + 1) % GIT_GRAPH_LANE_COLOR_COUNT;
      pending.push({ id: parent, color: colorTick });
    }

    // 压实空列：空槽位消失，右侧泳道整体左移。
    const outputLanes = pending
      .filter((item): item is GitGraphLane => item !== null)
      .map((item) => ({ ...item }));
    lanes = outputLanes;

    // 贯穿本行的连线：输入泳道里不是本节点的那些列，按身份找到它们在本行底部的列。
    const through: GitGraphThrough[] = [];
    inputLanes.forEach((item, index) => {
      if (item.id === hash) return;
      const toLane = outputLanes.findIndex((candidate) => candidate.id === item.id);
      if (toLane === -1) return; // 健全性兜底：正常路径下不会发生
      through.push({ fromLane: index, toLane, color: item.color });
    });

    const firstParentLane =
      parents.length > 0 ? outputLanes.findIndex((item) => item.id === parents[0]) : -1;
    const merges: Array<{ lane: number; color: number }> = [];
    for (const parent of parents.slice(1)) {
      const toLane = outputLanes.findIndex((item) => item.id === parent);
      if (toLane !== -1) merges.push({ lane: toLane, color: outputLanes[toLane].color });
    }

    const rowColumnCount = Math.max(inputLanes.length, outputLanes.length);
    columnCount = Math.max(columnCount, rowColumnCount);
    rows.push({
      hash,
      shortHash: commit.shortHash,
      subject: commit.subject,
      author: commit.author ?? null,
      email: commit.email ?? null,
      timestamp: commit.timestamp ?? null,
      refs: commit.refs,
      isHead: commit.refs.some((ref) => ref.startsWith("HEAD")),
      isMerge: parents.length > 1,
      lane: nodeLane,
      color: nodeColor,
      inputLanes,
      outputLanes,
      columnCount: rowColumnCount,
      through,
      nodeTop: isTip ? null : { lane: nodeLane, color: nodeColor },
      nodeBottom:
        firstParentLane === -1
          ? null
          : { lane: nodeLane, toLane: firstParentLane, color: outputLanes[firstParentLane].color },
      merges,
    });
  }

  return { rows, columnCount };
}

/**
 * 在图谱里插入 incoming / outgoing 合成行（与 VS Code SCM Graph 的做法一致）：
 * - outgoing 插在 HEAD 行上方，表示"从这里往下是我有、远端还没有的提交"；
 * - incoming 插在共同祖先那一行上方，表示"从这里往下是远端有、我还没有的提交"。
 *
 * 合成行本身是一行"直通泳道"：输入输出泳道与该锚点行的输入泳道一致，
 * 因此插入它不会改变原有任何一行的列与连线。锚点不在已加载窗口里时跳过该标记。
 */
export function insertGraphMarkers(
  layout: GitGraphLayout,
  markers: { outgoing?: GitGraphRangeMarker; incoming?: GitGraphRangeMarker },
): GitGraphLayout {
  const entries: Array<{ kind: GitGraphMarkerKind; marker: GitGraphRangeMarker }> = [];
  if (markers.outgoing) entries.push({ kind: "outgoing", marker: markers.outgoing });
  if (markers.incoming) entries.push({ kind: "incoming", marker: markers.incoming });
  if (entries.length === 0) return layout;

  // 锚点：outgoing 锚在区间头部提交（HEAD），incoming 锚在区间起始提交（共同祖先）
  const anchors: Array<{ kind: GitGraphMarkerKind; marker: GitGraphRangeMarker; index: number }> = [];
  for (const entry of entries) {
    const anchorHash = entry.kind === "outgoing" ? entry.marker.head : entry.marker.base;
    const index = layout.rows.findIndex((row) => row.hash === anchorHash && row.synthetic === undefined);
    if (index === -1) continue;
    anchors.push({ ...entry, index });
  }
  if (anchors.length === 0) return layout;
  // 同一行上只保留一个标记（先到先得：outgoing 优先，它是用户自己那条线）
  const seen = new Set<number>();
  const accepted = anchors.filter((anchor) => {
    if (seen.has(anchor.index)) return false;
    seen.add(anchor.index);
    return true;
  });

  const rows: GitGraphRow[] = [];
  layout.rows.forEach((row, index) => {
    for (const anchor of accepted) {
      if (anchor.index !== index) continue;
      const lanes = row.inputLanes.map((lane) => ({ ...lane }));
      rows.push({
        hash: `__${anchor.kind}__`,
        shortHash: "",
        subject: "",
        author: null,
        email: null,
        timestamp: null,
        refs: [],
        isHead: false,
        isMerge: false,
        lane: row.lane,
        color: row.color,
        inputLanes: lanes,
        outputLanes: lanes.map((lane) => ({ ...lane })),
        columnCount: row.columnCount,
        through: lanes.map((lane, laneIndex) => ({ fromLane: laneIndex, toLane: laneIndex, color: lane.color })),
        nodeTop: null,
        nodeBottom: null,
        merges: [],
        synthetic: anchor.kind,
        range: { base: anchor.marker.base, head: anchor.marker.head },
        count: anchor.marker.count,
      });
    }
    rows.push(row);
  });

  return { rows, columnCount: layout.columnCount };
}

/** 每行占用的高度：提交行是固定行高，展开的提交行额外带上"文件块"的高度。 */
export function gitGraphRowHeights<T extends { hash: string }>(
  rows: readonly T[],
  extraHeightOf?: (row: T) => number,
): number[] {
  return rows.map((row) => GIT_GRAPH_ROW_HEIGHT + Math.max(0, extraHeightOf?.(row) ?? 0));
}

/** 行顶部偏移的前缀和，长度为 rows.length + 1；最后一项即内容总高度。 */
export function gitGraphRowOffsets(heights: readonly number[]): number[] {
  const offsets: number[] = [0];
  for (const height of heights) offsets.push(offsets[offsets.length - 1] + height);
  return offsets;
}

/**
 * 可见行区间 `[first, last)`：按偏移做二分查找，再向上下各放宽 overscanPx。
 * 行高不固定（展开的提交行更高），所以不能用 scrollTop / 行高 直接算下标。
 */
export function gitGraphVisibleRange(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): { first: number; last: number } {
  const count = Math.max(0, offsets.length - 1);
  if (count === 0) return { first: 0, last: 0 };
  const top = Math.max(0, scrollTop - overscanPx);
  const bottom = scrollTop + Math.max(0, viewportHeight) + overscanPx;
  return { first: firstRowIndexAt(offsets, top), last: lastRowIndexAt(offsets, bottom) };
}

/** 顶部偏移不超过 y 的最后一行（即包含 y 的那一行）；y 超过内容末尾时返回最后一行。 */
function firstRowIndexAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  if (y >= offsets[count]) return count - 1;
  let low = 0;
  let high = count - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] <= y) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** 顶部偏移 < y 的行数，也就是需要渲染到（不含）的下标。 */
function lastRowIndexAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1;
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] < y) low = mid + 1;
    else high = mid;
  }
  return low;
}
