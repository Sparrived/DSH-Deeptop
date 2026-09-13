import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WorkspaceGitGraphLine } from "../lib/desktop";
import { gitGraphLaneColor, gitRefKind, formatRelativeTime } from "../app/git-model";
import { gitGraphHeadShift } from "../app/git-graph-refresh";
import {
  GIT_GRAPH_NODE_RADIUS,
  GIT_GRAPH_ROW_HEIGHT,
  gitGraphLaneLinePath,
  gitGraphLaneShiftPath,
  gitGraphLaneX,
  gitGraphLayout,
  gitGraphMergePath,
  gitGraphRowHeights,
  gitGraphRowOffsets,
  gitGraphVisibleRange,
  gitGraphWidth,
  insertGraphMarkers,
  splitInlineRefs,
  type GitGraphRangeMarker,
  type GitGraphRow,
} from "../app/git-graph-layout";
import { t, type UiLocale } from "../app/i18n";

// 逐行渲染：每行一个独立 SVG（只画本行内的线段），行高默认固定；
// 展开的提交行会在下方追加文件块，因此虚拟化按"累计高度"而不是固定行高计算。
const ROW_H = GIT_GRAPH_ROW_HEIGHT;
const NODE_R = GIT_GRAPH_NODE_RADIUS;
/** 视口上下各多渲染的像素，避免快速滚动时出现空白。 */
const OVERSCAN_PX = 8 * ROW_H;

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
  /** incoming / outgoing 合成行：远端有而我没有 / 我有而远端没有的区间。 */
  markers?: { outgoing?: GitGraphRangeMarker; incoming?: GitGraphRangeMarker };
  /** 点击合成行时打开该区间的提交列表。 */
  onOpenRange?: (base: string, head: string) => void;
  /** 已展开（提交行下方显示文件块）的提交。 */
  expandedHashes?: ReadonlySet<string>;
  /** 展开行在提交行下方追加的内容（文件列表 + 动作）；context 给出图谱列宽以便左侧对齐。 */
  renderRowChildren?: (row: GitGraphRow, context: { graphWidth: number }) => ReactNode;
  /**
   * 展开行追加内容的高度。必须与 `renderRowChildren` 实际渲染的高度一致——
   * 虚拟化与滚动定位都按这个高度计算，不测量 DOM。
   */
  rowChildrenHeight?: (row: GitGraphRow) => number;
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

/**
 * 行容器：展开时测量整行实际高度并回传（减去固定行高即"追加高度"）。
 * 虚拟化用实测值算偏移，因此展开块里换行、边框、间距变化都不会让后续行错位。
 */
function GitGraphItem({
  hash,
  expanded,
  onMeasured,
  children,
}: {
  hash: string;
  expanded: boolean;
  onMeasured: (hash: string, extraHeight: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !expanded) return undefined;
    const report = () => {
      onMeasured(hash, Math.max(0, node.getBoundingClientRect().height - ROW_H));
    };
    report();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hash, expanded, onMeasured]);
  return (
    <div className="git-graph-item" ref={ref}>
      {children}
    </div>
  );
}

export function GitTreeGraph({
  lines,
  selectedHash,
  onSelect,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  markers,
  onOpenRange,
  expandedHashes,
  renderRowChildren,
  rowChildrenHeight,
  locale = "zh",
}: GitTreeGraphProps) {
  const layout = useMemo(
    () => insertGraphMarkers(gitGraphLayout(lines), markers ?? {}),
    [lines, markers],
  );
  // 只保存鼠标悬停在"节点"上的那一行：行内文字悬浮不弹卡片。
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  // 已滚动时头部插入了多少条新提交（顶部徽标用）
  const [pendingAbove, setPendingAbove] = useState(0);
  const [rowWindow, setRowWindow] = useState({ first: 0, last: 8 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 展开行的高度以 DOM 实测为准：CSS 里的 gap/border/min-height 很容易和公式差几像素，
  // 这点误差会累加成可见错位（连线断开、卡片偏移、可见区间算错）。
  const [measuredExtras, setMeasuredExtras] = useState<Record<string, number>>({});
  const reportExtra = useCallback((hash: string, extra: number) => {
    setMeasuredExtras((current) => (current[hash] === extra ? current : { ...current, [hash]: extra }));
  }, []);
  const extraHeightOf = useCallback((row: GitGraphRow) => {
    if (row.synthetic || !expandedHashes?.has(row.hash)) return 0;
    const measured = measuredExtras[row.hash];
    if (measured !== undefined) return measured;
    // 还没量到（首帧）时用宿主的估算值兜底
    return Math.max(0, rowChildrenHeight?.(row) ?? 0);
  }, [expandedHashes, measuredExtras, rowChildrenHeight]);

  // 每行高度与累计偏移：展开行比普通行高，滚动定位与可见区间都由此推导。
  const offsets = useMemo(
    () => gitGraphRowOffsets(gitGraphRowHeights(layout.rows, extraHeightOf)),
    [layout.rows, extraHeightOf],
  );
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  const measure = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollTop === 0) setPendingAbove((current) => (current === 0 ? current : 0));
    const next = gitGraphVisibleRange(offsetsRef.current, node.scrollTop, node.clientHeight, OVERSCAN_PX);
    setRowWindow((current) => (current.first === next.first && current.last === next.last ? current : next));
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

  // 行高变化（展开/收起、翻页）后立刻重算可见窗口，避免出现空白。
  useEffect(() => {
    measure();
  }, [measure, offsets]);

  // 增量刷新会在头部插入新提交：把已滚动的视图按插入高度下移，
  // 用户正在看的那条提交停在原地；同时在顶部挂一条「有 N 个新提交」徽标
  //（对应 VS Code 在已滚动时显示 Outdated 徽标、不做重排的做法）。
  const headRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const node = scrollRef.current;
    const shift = gitGraphHeadShift(headRef.current, layout.rows);
    headRef.current = layout.rows[0]?.hash ?? null;
    if (!node) return;
    if (shift.inserted > 0 && node.scrollTop > 0) {
      node.scrollTop += shift.inserted * ROW_H;
      measure();
      setPendingAbove((current) => current + shift.inserted);
      return;
    }
    // 头部换了但没有可锚定的新增（历史被重写），或用户本来就在顶部：计数清零
    if (shift.headChanged || node.scrollTop === 0) setPendingAbove(0);
  }, [layout, measure]);

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
  const totalHeight = offsets[total];
  // 悬浮卡片挂在列表层（而不是行按钮内部）：行按钮有 overflow: hidden，
  // 卡片放在里面会被裁成一行高。
  const hoveredIndex = hoveredHash === null ? -1 : layout.rows.findIndex((row) => row.hash === hoveredHash);
  const hoveredRow = hoveredIndex === -1 ? null : layout.rows[hoveredIndex];
  // 顶部几行的卡片若仍按节点垂直居中，会被滚动容器上沿切掉；这些行改成贴顶展开
  const hoveredTop = hoveredRow ? offsets[hoveredIndex] : 0;
  const hoveredClampedToTop = hoveredRow !== null && hoveredTop < 96;

  return (
    <div className="git-graph-list" ref={scrollRef} onScroll={measure}>
      {/* 粘性零高度锚点：徽标浮在视口顶部，不参与行高计算 */}
      <div className="git-graph-newabove-anchor">
        {pendingAbove > 0 && (
          <button
            type="button"
            className="git-graph-newabove"
            onClick={() => {
              const node = scrollRef.current;
              if (!node) return;
              node.scrollTop = 0;
              measure();
            }}
          >
            {t("gitGraph.newAbove", locale, { count: pendingAbove })}
          </button>
        )}
      </div>
      {firstRow > 0 && <div className="git-graph-spacer" style={{ height: offsets[firstRow] }} aria-hidden="true" />}
      {visibleRows.map((row, index) => {
        const rowIndex = firstRow + index;
        const expanded = Boolean(expandedHashes?.has(row.hash)) && !row.synthetic;
        const selected = !row.synthetic && row.hash === selectedHash;
        const nodeX = gitGraphLaneX(row.lane);
        const syntheticColor = row.synthetic === "incoming" ? "var(--git-graph-remote)" : "var(--git-graph-local)";
        const nodeColor = row.synthetic ? syntheticColor : gitGraphLaneColor(row.color);
        const { visible: visibleRefs, overflow: overflowRefs } = splitInlineRefs(row.refs);
        const syntheticLabel = row.synthetic === "incoming"
          ? t("gitGraph.incoming", locale, { count: row.count ?? 0 })
          : t("gitGraph.outgoing", locale, { count: row.count ?? 0 });
        return (
          <GitGraphItem key={row.hash} hash={row.hash} expanded={expanded} onMeasured={reportExtra}>
            <button
              type="button"
              className={`git-graph-row ${selected ? "selected" : ""}${expanded ? " expanded" : ""}${row.synthetic ? ` git-graph-row-synthetic git-graph-row-${row.synthetic}` : ""}`}
              style={{ height: ROW_H }}
              onClick={() => {
                if (row.synthetic && row.range && onOpenRange) {
                  onOpenRange(row.range.base, row.range.head);
                  return;
                }
                if (!row.synthetic) onSelect(row.hash);
              }}
              title={row.synthetic ? syntheticLabel : undefined}
              aria-label={row.synthetic ? syntheticLabel : row.subject}
              aria-current={selected ? "true" : undefined}
              aria-expanded={row.synthetic ? undefined : expanded}
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
                {/* 节点：普通 / merge 双环 / HEAD 带孔圆环 / 合成行虚线环 */}
                <g
                  className="git-graph-node"
                  onMouseEnter={() => { if (!row.synthetic) setHoveredHash(row.hash); }}
                  onMouseLeave={() => setHoveredHash((current) => (current === row.hash ? null : current))}
                >
                  {/* 扩大命中区域，仍保持泳道节点的视觉尺寸不变。 */}
                  <circle className="git-graph-node-hit" cx={nodeX} cy={midY} r={NODE_R + 4} fill="transparent" />
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
                  ) : row.synthetic ? (
                    <circle
                      cx={nodeX}
                      cy={midY}
                      r={NODE_R + 2}
                      fill="none"
                      stroke={syntheticColor}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                    />
                  ) : (
                    <circle className="git-graph-node-ring" cx={nodeX} cy={midY} r={NODE_R + 1} fill={nodeColor} />
                  )}
                  {selected && (
                    <circle cx={nodeX} cy={midY} r={NODE_R + 5} fill="none" stroke={nodeColor} strokeWidth={1} opacity={0.6} />
                  )}
                </g>
              </svg>
              <span className="git-graph-main">
                {row.synthetic ? (
                  <span className={`git-graph-synthetic git-graph-synthetic-${row.synthetic}`}>
                    <i className="git-graph-ref-dot" style={{ background: syntheticColor }} aria-hidden="true" />
                    {syntheticLabel}
                  </span>
                ) : (
                  <>
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
                  </>
                )}
              </span>
            </button>
            {expanded && renderRowChildren?.(row, { graphWidth: svgWidth })}
          </GitGraphItem>
        );
      })}
      {lastRow < total && (
        <div className="git-graph-spacer" style={{ height: Math.max(0, totalHeight - offsets[lastRow]) }} aria-hidden="true" />
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
      {hoveredRow && (
        <div
          className="git-graph-tooltip"
          role="tooltip"
          style={{
            top: hoveredClampedToTop ? hoveredTop : hoveredTop + midY,
            transform: hoveredClampedToTop ? "none" : undefined,
            left: svgWidth + 12,
            maxWidth: `calc(100% - ${svgWidth + 22}px)`,
          }}
        >
          <div className="git-graph-tooltip-subject">{hoveredRow.subject}</div>
          <div className="git-graph-tooltip-row">
            <span className="git-graph-tooltip-hash">{hoveredRow.shortHash}</span>
            <span>{hoveredRow.author ?? t("gitGraph.unknownAuthor", locale)}{hoveredRow.email ? ` <${hoveredRow.email}>` : ""}</span>
          </div>
          <div className="git-graph-tooltip-row">{formatCommitTime(hoveredRow.timestamp, locale)}</div>
          {hoveredRow.refs.length > 0 && (
            <div className="git-graph-tooltip-row">
              {hoveredRow.refs.map((ref) => (
                <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`}>{ref}</span>
              ))}
            </div>
          )}
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
