import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceGitGraphLine } from "../lib/desktop";
import { gitGraphLaneColor, gitRefKind, formatRelativeTime } from "../app/git-model";
import { gitGraphLayout, splitInlineRefs, type GitLayoutCommit } from "../app/git-graph-layout";
import { t, type UiLocale } from "../app/i18n";

// 向量渲染几何：泳道宽、行高，泳道画在列中心，跨泳道边用圆角折线。
const LANE_W = 15;
const ROW_H = 26;
const NODE_R = 4;

type GitTreeGraphProps = {
  lines: WorkspaceGitGraphLine[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
  /** 滚到底部时由 IntersectionObserver 触发，拉取更早一页历史。 */
  onLoadMore?: () => void;
  /** 是否还有更早历史可加载；为 false 时隐藏底部占位与触发器。 */
  hasMore?: boolean;
  /** 正在加载下一页时显示底部 loading 文案，避免误触。 */
  loadingMore?: boolean;
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

export function GitTreeGraph({
  lines,
  selectedHash,
  onSelect,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  locale = "zh",
}: GitTreeGraphProps) {
  const layout = useMemo(() => gitGraphLayout(lines), [lines]);
  const [hovered, setHovered] = useState<GitLayoutCommit | null>(null);
  const [labelsHeight, setLabelsHeight] = useState(0);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  // 测量泳道标签条的实际高度：用于把绝对定位的提交行整体下移，
  // 避免行 0 与泳道标签在视觉上重叠。
  useEffect(() => {
    const target = labelsRef.current;
    if (!target) {
      setLabelsHeight(0);
      return undefined;
    }
    const measure = () => setLabelsHeight(target.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [layout.segmentLabels.length]);
  // 底部哨兵节点进入视口时触发 onLoadMore：比监听滚动事件更稳，
  // 浏览器/用户缩放时也会自动重算可见性。仅在 hasMore 为 true 时挂载观察器。
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !onLoadMore || !hasMore) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      // 不支持时退回一次性的 setTimeout 占位，触发一次后由 hasMore 决定是否继续。
      const timer = window.setTimeout(() => onLoadMore(), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onLoadMore();
        }
      },
      { root: target.closest(".git-graph-list"), rootMargin: "200px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loadingMore, lines.length]);
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
      <g
        key={commit.hash}
        className="git-graph-node"
        onMouseEnter={() => setHovered(commit)}
        onMouseLeave={() => setHovered((current) => (current?.hash === commit.hash ? null : current))}
      >
        {/* 扩大命中区域，仍保持泳道节点的视觉尺寸不变。 */}
        <circle className="git-graph-node-hit" cx={x} cy={y} r={NODE_R + 3} fill="transparent" />
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
    // 折叠溢出 ref：仅展示前若干个，超出合并为「+N」徽标。
    // 折叠列表放进原生 title 提示（hover 可看），同时和悬浮 tooltip 互补。
    const { visible: visibleRefs, overflow: overflowRefs } = splitInlineRefs(commit.refs);
    const overflowTitle = overflowRefs.join("\n");
    return (
      <button
        key={`r${commit.hash}`}
        type="button"
        className={`git-graph-row ${selected ? "selected" : ""}`}
        style={{ top: commit.row * ROW_H, left: graphW + 10, right: 10 }}
        onClick={() => onSelect(commit.hash)}
        aria-label={commit.subject}
      >
        <span className="git-graph-hash">{commit.shortHash}</span>
        {visibleRefs.map((ref) => (
          <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`} title={ref}>{ref}</span>
        ))}
        {overflowRefs.length > 0 && (
          <span
            key="__overflow"
            className="git-graph-ref git-graph-ref-overflow"
            title={overflowTitle}
          >
            +{overflowRefs.length}
          </span>
        )}
        <span className="git-graph-subject">{commit.subject}</span>
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
      {laneLabels.length > 0 && <div ref={labelsRef} className="git-graph-lane-labels">{laneLabels}</div>}
      {/* 把画布与提交行包在同一个 position:relative 容器里，
          行可以绝对定位在画布右侧的整行宽度内，y 坐标与画布的泳道节点对齐。 */}
      <div className="git-graph-frame" style={{ height: graphH }}>
        <div className="git-graph-canvas" style={{ width: graphW, height: graphH }}>
          <svg className="git-graph-svg" width={graphW} height={graphH} aria-hidden="true">
            {laneLines}
            {edges}
            {nodes}
          </svg>
        </div>
        {rows}
        {/* 底部哨兵节点：进入视口时由 IntersectionObserver 触发 onLoadMore。
            放在 frame 内、画布下方 4px，rootMargin 提前 200px 让「将到底」就加载。 */}
        {onLoadMore && hasMore && (
          <div
            ref={loadMoreRef}
            className="git-graph-loadmore"
            aria-live="polite"
            style={{ top: graphH + 4, left: graphW + 10, right: 10 }}
          >
            {loadingMore ? t("gitGraph.loadingMore", locale) : t("gitGraph.scrollForMore", locale)}
          </div>
        )}
        {!hasMore && onLoadMore && (
          <div
            className="git-graph-loadmore git-graph-loadmore-end"
            aria-live="polite"
            style={{ top: graphH + 4, left: graphW + 10, right: 10 }}
          >
            {t("gitGraph.endOfHistory", locale)}
          </div>
        )}
      </div>
      {/* 留出底部哨兵节点的空间，让滚动容器能把哨兵滚入视口。
          没有这个 spacer，绝对定位的哨兵虽然出现在视觉上但不算入 scrollHeight。 */}
      {onLoadMore && <div className="git-graph-tail-spacer" aria-hidden="true" />}
      {hovered && (
        <div
          className="git-graph-tooltip"
          role="tooltip"
          style={{ top: nodeY(hovered.row) + labelsHeight, left: graphW + 12, maxWidth: `calc(100% - ${graphW + 22}px)` }}
        >
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
