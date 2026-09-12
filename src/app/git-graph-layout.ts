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

/** 一组 ref 拆分为内联可见部分与折叠溢出部分。空数组或短列表不会产生溢出。 */
export function splitInlineRefs(refs: string[]): { visible: string[]; overflow: string[] } {
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
