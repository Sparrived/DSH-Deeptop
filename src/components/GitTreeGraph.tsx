import { useMemo, useState } from "react";
import type { WorkspaceGitGraphLine } from "../lib/desktop";
import { gitGraphLaneColor, gitRefKind, formatRelativeTime } from "../app/git-model";
import { gitGraphLayout, type GitLayoutCommit } from "../app/git-graph-layout";
import { t, type UiLocale } from "../app/i18n";

// 向量渲染几何：泳道宽、行高，泳道画在列中心，跨泳道边用圆角折线。
const LANE_W = 15;
const ROW_H = 26;
const NODE_R = 4;

type GitTreeGraphProps = {
  lines: WorkspaceGitGraphLine[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  locale?: UiLocale;
};

function formatCommitTime(timestamp: number | null, locale: UiLocale): string {
  if (timestamp === null || timestamp <= 0) return t("gitGraph.unknownTime", locale);
  const relative = formatRelativeTime(timestamp, undefined, locale);
  try {
    const date = new Date(timestamp * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    const absolute = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return t("gitGraph.commitTime", locale, { relative, absolute });
  } catch {
    return relative;
  }
}

export function GitTreeGraph({ lines, selectedHash, onSelect, locale = "zh" }: GitTreeGraphProps) {
  const layout = useMemo(() => gitGraphLayout(lines), [lines]);
  const [hovered, setHovered] = useState<GitLayoutCommit | null>(null);
  if (layout.commits.length === 0) return null;

  const graphW = layout.columnCount * LANE_W;
  const graphH = layout.commits.length * ROW_H;
  const laneX = (lane: number) => (lane + 0.5) * LANE_W;
  const nodeY = (row: number) => row * ROW_H + ROW_H / 2;

  const laneLines = layout.laneSegments.map((seg, index) => {
    const color = gitGraphLaneColor(seg.lane);
    const x = laneX(seg.lane);
    return (
      <line
        key={`l${index}`}
        x1={x}
        y1={nodeY(seg.fromRow)}
        x2={x}
        y2={nodeY(seg.toRow)}
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
    // 圆角折线路由（竖直-水平-竖直）：圆弧凸向外侧拐角，
    // sweep 随横向行进方向翻转；两段圆弧方向相反，画反会向内勾。
    const cornerR = 6;
    const joinY = 5;
    const elbowY = Math.max(ys + cornerR + 2, yt - cornerR - joinY);
    const dir = xt >= xs ? 1 : -1;
    const path = [
      `M ${xs} ${ys}`,
      `L ${xs} ${elbowY - cornerR}`,
      `A ${cornerR} ${cornerR} 0 0 ${dir === 1 ? 0 : 1} ${xs + dir * cornerR} ${elbowY}`,
      `L ${xt - dir * cornerR} ${elbowY}`,
      `A ${cornerR} ${cornerR} 0 0 ${dir === 1 ? 1 : 0} ${xt} ${elbowY + cornerR}`,
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
        <circle cx={x} cy={y} r={1.6} fill="var(--surface-raised)" />
        {(selected || commit.isHead) && (
          <circle cx={x} cy={y} r={NODE_R + 3} fill="none" stroke={color} strokeWidth={1.25} opacity={0.75} />
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
        onMouseEnter={() => setHovered(commit)}
        onMouseLeave={() => setHovered((current) => (current?.hash === commit.hash ? null : current))}
      >
        <span className="git-graph-hash">{commit.shortHash}</span>
        {commit.refs.map((ref) => (
          <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`} title={ref}>{ref}</span>
        ))}
        <span className="git-graph-subject" title={commit.subject}>{commit.subject}</span>
      </button>
    );
  });

  const laneLabels = layout.segmentLabels.map((label, index) => (
    <span
      key={`lb${index}`}
      className={`git-lane-label git-lane-label-${label.kind}`}
      style={{ marginLeft: label.lane * LANE_W }}
      title={t("gitGraph.laneTitle", locale, { label: label.label, lane: label.lane + 1 })}
    >
      <i style={{ background: gitGraphLaneColor(label.lane) }} aria-hidden="true" />
      {label.label}
    </span>
  ));

  const hoveredLabel = hovered
    ? layout.segmentLabels.find(
        (label) => label.lane === hovered.lane
          && label.fromRow <= hovered.row
          && (layout.laneSegments.find((seg) => seg.lane === label.lane && seg.fromRow === label.fromRow)?.toRow ?? Infinity) >= hovered.row,
      )
    : null;

  return (
    <div className="git-graph-list">
      {laneLabels.length > 0 && <div className="git-graph-lane-labels">{laneLabels}</div>}
      <div className="git-graph-canvas" style={{ width: graphW, height: graphH }}>
        <svg className="git-graph-svg" width={graphW} height={graphH} aria-hidden="true">
          {laneLines}
          {edges}
          {nodes}
        </svg>
      </div>
      {/* 提交行挂在画布外的滚动容器上：left/right 相对整个面板解析，
          画布只占泳道宽度，避免提交标题被画布宽度挤没。 */}
      {rows}
      {hovered && (
        <div className="git-graph-tooltip" role="tooltip" style={{ top: hovered.row * ROW_H }}>
          <div className="git-graph-tooltip-subject">{hovered.subject}</div>
          <div className="git-graph-tooltip-row">
            <span className="git-graph-tooltip-hash">{hovered.shortHash}</span>
            <span>{hovered.author ?? t("gitGraph.unknownAuthor", locale)}{hovered.email ? ` <${hovered.email}>` : ""}</span>
          </div>
          <div className="git-graph-tooltip-row">{formatCommitTime(hovered.timestamp, locale)}</div>
          {hovered.refs.length > 0 && (
            <div className="git-graph-tooltip-row">
              {hovered.refs.map((ref) => (
                <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`}>{ref}</span>
              ))}
            </div>
          )}
          {hoveredLabel && (
            <div className="git-graph-tooltip-row">
              <i className="git-graph-tooltip-lane-dot" style={{ background: gitGraphLaneColor(hoveredLabel.lane) }} aria-hidden="true" />
              <span>{t("gitGraph.branchLabel", locale, { label: hoveredLabel.label })}</span>
            </div>
          )}
          <div className="git-graph-tooltip-row">
            <span>{t("gitGraph.laneRow", locale, { lane: hovered.lane + 1, row: hovered.row + 1 })}</span>
          </div>
        </div>
      )}
    </div>
  );
}