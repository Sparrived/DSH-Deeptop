import { useMemo } from "react";
import type { WorkspaceGitGraphLine } from "../lib/desktop";
import { gitGraphLaneColor, gitRefKind } from "../app/git-model";
import { gitGraphLayout } from "../app/git-graph-layout";

// 向量渲染几何：泳道宽、行高，泳道画在列中心，跨泳道边用贝塞尔曲线。
const LANE_W = 20;
const ROW_H = 26;
const NODE_R = 6;

type GitTreeGraphProps = {
  lines: WorkspaceGitGraphLine[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
};

export function GitTreeGraph({ lines, selectedHash, onSelect }: GitTreeGraphProps) {
  const layout = useMemo(() => gitGraphLayout(lines), [lines]);
  if (layout.commits.length === 0) return null;

  const graphW = layout.columnCount * LANE_W;
  const graphH = layout.commits.length * ROW_H;
  const laneX = (lane: number) => (lane + 0.5) * LANE_W;
  const nodeY = (row: number) => row * ROW_H + ROW_H / 2;

  const laneLines = layout.lanes.map((lane) => {
    const color = gitGraphLaneColor(lane.lane);
    const x = laneX(lane.lane);
    return (
      <line
        key={`l${lane.lane}`}
        x1={x}
        y1={nodeY(lane.fromRow)}
        x2={x}
        y2={nodeY(lane.toRow)}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.9}
      />
    );
  });

  const edges = layout.edges.map((edge, index) => {
    // 合并边颜色取分支侧泳道：分支被合并时该线属于分支而非主线。
    const color = gitGraphLaneColor(edge.colorLane);
    const xs = laneX(edge.fromLane);
    const ys = nodeY(edge.fromRow);
    const xt = laneX(edge.toLane);
    const yt = nodeY(edge.toRow);
    const span = yt - ys;
    if (span <= ROW_H * 3) {
      // 短跨度合并边直接画斜线（git `\` 造型），不做竖线+圆角折弯。
      return <line key={`e${index}`} x1={xs} y1={ys} x2={xt} y2={yt} stroke={color} strokeWidth={2} strokeLinecap="round" />;
    }
    // 长跨度边：沿源泳道自己的列下行（与其他泳道并行），底部折弯汇入目标
    // （git `|`+`|/` 造型），目标侧只留短垂直段，避免贯穿线。
    const cornerR = 7;
    const joinY = 5;
    const elbowY = Math.max(ys + cornerR + 2, yt - cornerR - joinY);
    const dir = xt >= xs ? 1 : -1;
    const path = [
      `M ${xs} ${ys}`,
      `L ${xs} ${elbowY - cornerR}`,
      `A ${cornerR} ${cornerR} 0 0 ${dir === 1 ? 1 : 0} ${xs + dir * cornerR} ${elbowY}`,
      `L ${xt - dir * cornerR} ${elbowY}`,
      `A ${cornerR} ${cornerR} 0 0 ${dir === 1 ? 0 : 1} ${xt} ${elbowY + cornerR}`,
      `L ${xt} ${yt}`,
    ].join(" ");
    return <path key={`e${index}`} d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />;
  });

  const nodes = layout.commits.map((commit) => {
    const x = laneX(commit.lane);
    const y = nodeY(commit.row);
    const color = gitGraphLaneColor(commit.lane);
    const selected = commit.hash === selectedHash;
    return (
      <g key={commit.hash}>
        <circle cx={x} cy={y} r={NODE_R + (selected || commit.isHead ? 1.5 : 0)} fill={color} />
        <circle cx={x} cy={y} r={2.2} fill="var(--surface-raised)" />
        {(selected || commit.isHead) && (
          <circle cx={x} cy={y} r={NODE_R + 4.5} fill="none" stroke={color} strokeWidth={1.5} opacity={0.75} />
        )}
      </g>
    );
  });

  const rows = layout.commits.map((commit) => {
    const selected = commit.hash === selectedHash;
    return (
      <button
        key={`r${commit.hash}`}
        type="button"
        className={`git-graph-row ${selected ? "selected" : ""}`}
        style={{ top: commit.row * ROW_H, left: graphW + 10, right: 10, height: ROW_H }}
        onClick={() => onSelect(commit.hash)}
        title={commit.subject}
      >
        <span className="git-graph-hash">{commit.shortHash}</span>
        {commit.refs.map((ref) => (
          <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`} title={ref}>{ref}</span>
        ))}
        <span className="git-graph-subject" title={commit.subject}>{commit.subject}</span>
      </button>
    );
  });

  return (
    <div className="git-graph-list">
      <div className="git-graph-canvas" style={{ width: graphW, height: graphH }}>
        <svg className="git-graph-svg" width={graphW} height={graphH} aria-hidden="true">
          {laneLines}
          {edges}
          {nodes}
        </svg>
        {rows}
      </div>
    </div>
  );
}
