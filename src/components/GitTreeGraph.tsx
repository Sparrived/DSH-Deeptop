import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceGitGraphLine } from "../lib/desktop";
import { gitGraphLaneColor, gitRefKind, formatRelativeTime } from "../app/git-model";
import {
  GIT_GRAPH_NODE_RADIUS,
  GIT_GRAPH_ROW_HEIGHT,
  gitGraphLaneLinePath,
  gitGraphLaneShiftPath,
  gitGraphLaneX,
  gitGraphLayout,
  gitGraphMergePath,
  gitGraphWidth,
  splitInlineRefs,
} from "../app/git-graph-layout";
import { t, type UiLocale } from "../app/i18n";

// 逐行渲染：每行一个独立 SVG（只画本行内的线段），行高固定，
// 因此可以按固定行高做虚拟化，只挂载视口附近的行。
const ROW_H = GIT_GRAPH_ROW_HEIGHT;
const NODE_R = GIT_GRAPH_NODE_RADIUS;
/** 视口上下各多渲染的行数，避免快速滚动时出现空白。 */
const OVERSCAN_ROWS = 8;

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
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  // 只保存可见行窗口（而不是滚动像素），窗口没跨行时滚动不触发重渲染。
  const [rowWindow, setRowWindow] = useState({ first: 0, last: OVERSCAN_ROWS * 2 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const top = node.scrollTop;
    const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN_ROWS);
    const last = Math.ceil((top + node.clientHeight) / ROW_H) + OVERSCAN_ROWS;
    setRowWindow((current) => (current.first === first && current.last === last ? current : { first, last }));
  }, []);

  // 视口尺寸/滚动位置变化时重算可见窗口；ResizeObserver 覆盖面板拖宽与缩放。
  useEffect(() => {
    measure();
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure, layout.rows.length]);

  // 底部哨兵进入视口时触发 onLoadMore：比监听滚动阈值更稳。
  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !onLoadMore || !hasMore) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => onLoadMore(), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onLoadMore();
        }
      },
      { root: scrollRef.current, rootMargin: "200px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, loadingMore, layout.rows.length]);

  if (layout.rows.length === 0) return null;

  const total = layout.rows.length;
  const svgWidth = gitGraphWidth(layout.columnCount);
  const firstRow = Math.min(rowWindow.first, Math.max(0, total - 1));
  const lastRow = Math.max(firstRow + 1, Math.min(total, rowWindow.last));
  const visibleRows = layout.rows.slice(firstRow, lastRow);
  const tailLanes = layout.rows[total - 1].outputLanes;
  const midY = ROW_H / 2;

  return (
    <div className="git-graph-list" ref={scrollRef} onScroll={measure}>
      {firstRow > 0 && <div className="git-graph-spacer" style={{ height: firstRow * ROW_H }} aria-hidden="true" />}
      {visibleRows.map((row) => {
        const selected = row.hash === selectedHash;
        const hovered = row.hash === hoveredHash;
        const nodeX = gitGraphLaneX(row.lane);
        const nodeColor = gitGraphLaneColor(row.color);
        const { visible: visibleRefs, overflow: overflowRefs } = splitInlineRefs(row.refs);
        return (
          <button
            key={row.hash}
            type="button"
            className={`git-graph-row ${selected ? "selected" : ""}`}
            style={{ height: ROW_H }}
            onClick={() => onSelect(row.hash)}
            onMouseEnter={() => setHoveredHash(row.hash)}
            onMouseLeave={() => setHoveredHash((current) => (current === row.hash ? null : current))}
            aria-label={row.subject}
            aria-current={selected ? "true" : undefined}
          >
            <svg className="git-graph-cell" width={svgWidth} height={ROW_H} aria-hidden="true">
              {/* 贯穿本行的泳道线段：同列是竖线，换列是两段圆角夹一段水平线 */}
              {row.through.map((line, index) => (
                <path
                  key={`lane${index}`}
                  d={line.fromLane === line.toLane
                    ? gitGraphLaneLinePath(line.fromLane)
                    : gitGraphLaneShiftPath(line.fromLane, line.toLane, true)}
                  fill="none"
                  stroke={gitGraphLaneColor(line.color)}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ))}
              {/* 节点上方进入圆点的短竖线 */}
              {row.nodeTop && (
                <path
                  d={`M ${nodeX} 0 V ${midY}`}
                  fill="none"
                  stroke={gitGraphLaneColor(row.nodeTop.color)}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              )}
              {/* 其余双亲（合并）的连线 */}
              {row.merges.map((merge, index) => (
                <path
                  key={`merge${index}`}
                  d={gitGraphMergePath(row.lane, merge.lane)}
                  fill="none"
                  stroke={gitGraphLaneColor(merge.color)}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              ))}
              {/* 节点下方接续第一双亲的连线 */}
              {row.nodeBottom && (
                <path
                  d={row.nodeBottom.toLane === row.nodeBottom.lane
                    ? `M ${nodeX} ${midY} V ${ROW_H}`
                    : gitGraphLaneShiftPath(row.nodeBottom.lane, row.nodeBottom.toLane, false)}
                  fill="none"
                  stroke={gitGraphLaneColor(row.nodeBottom.color)}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              )}
              {/* 节点：普通 / merge 双环 / HEAD 带孔圆环，与 VS Code 的三种画法一致 */}
              {row.isHead ? (
                <>
                  <circle className="git-graph-node-ring" cx={nodeX} cy={midY} r={NODE_R + 3} fill={nodeColor} />
                  <circle className="git-graph-node-hole" cx={nodeX} cy={midY} r={2.2} />
                </>
              ) : row.isMerge ? (
                <>
                  <circle className="git-graph-node-ring" cx={nodeX} cy={midY} r={NODE_R + 2.5} fill={nodeColor} />
                  <circle className="git-graph-node-ring" cx={nodeX} cy={midY} r={NODE_R - 1.5} fill={nodeColor} />
                </>
              ) : (
                <circle className="git-graph-node-ring" cx={nodeX} cy={midY} r={NODE_R + 1} fill={nodeColor} />
              )}
              {selected && (
                <circle cx={nodeX} cy={midY} r={NODE_R + 5} fill="none" stroke={nodeColor} strokeWidth={1} opacity={0.6} />
              )}
            </svg>
            <span className="git-graph-main">
              <span className="git-graph-hash">{row.shortHash}</span>
              {visibleRefs.map((ref) => (
                <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`} title={ref}>
                  <i className="git-graph-ref-dot" style={{ background: nodeColor }} aria-hidden="true" />
                  {ref}
                </span>
              ))}
              {overflowRefs.length > 0 && (
                <span className="git-graph-ref git-graph-ref-overflow" title={overflowRefs.join("\n")}>
                  +{overflowRefs.length}
                </span>
              )}
              <span className="git-graph-subject">{row.subject}</span>
            </span>
            {hovered && (
              <span
                className="git-graph-tooltip"
                role="tooltip"
                style={{ left: svgWidth + 12, maxWidth: `calc(100% - ${svgWidth + 22}px)` }}
              >
                <span className="git-graph-tooltip-subject">{row.subject}</span>
                <span className="git-graph-tooltip-row">
                  <span className="git-graph-tooltip-hash">{row.shortHash}</span>
                  <span>{row.author ?? t("gitGraph.unknownAuthor", locale)}{row.email ? ` <${row.email}>` : ""}</span>
                </span>
                <span className="git-graph-tooltip-row">{formatCommitTime(row.timestamp, locale)}</span>
                {row.refs.length > 0 && (
                  <span className="git-graph-tooltip-row">
                    {row.refs.map((ref) => (
                      <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`}>{ref}</span>
                    ))}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
      {lastRow < total && (
        <div className="git-graph-spacer" style={{ height: (total - lastRow) * ROW_H }} aria-hidden="true" />
      )}
      {/* 底部泳道占位：把最后一行的泳道继续画下去，避免图谱在加载处突然截断 */}
      {hasMore && tailLanes.length > 0 && (
        <div className="git-graph-placeholder" style={{ height: ROW_H }} aria-hidden="true">
          <svg width={svgWidth} height={ROW_H}>
            {tailLanes.map((lane, index) => (
              <path
                key={`tail${index}`}
                d={gitGraphLaneLinePath(index)}
                fill="none"
                stroke={gitGraphLaneColor(lane.color)}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            ))}
          </svg>
        </div>
      )}
      {onLoadMore && (
        <div ref={sentinelRef} className="git-graph-sentinel" aria-live="polite">
          {hasMore
            ? loadingMore ? t("gitGraph.loadingMore", locale) : t("gitGraph.scrollForMore", locale)
            : t("gitGraph.endOfHistory", locale)}
        </div>
      )}
    </div>
  );
}
