import { useMemo } from "react";
import type { WorkspaceGitGraphLine } from "../lib/desktop";
import { gitGraphLaneColor, gitRefKind } from "../app/git-model";

// SVG 图元几何：每个图谱列固定像素宽，泳道画在列中心；
// `|` 是垂直泳道，`\`/`/` 是对角连接（跨一列），`*`/`o` 是提交节点。
const GRAPH_CELL_W = 12;
const GRAPH_ROW_H = 22;

type GitTreeGraphProps = {
  lines: WorkspaceGitGraphLine[];
  selectedHash: string | null;
  onSelect: (hash: string) => void;
};

type SvgGraphProps = {
  graph: string;
  maxColumns: number;
  head?: boolean;
};

function GraphCells({ graph, maxColumns, head }: SvgGraphProps) {
  const cells: React.ReactNode[] = [];
  const my = GRAPH_ROW_H / 2;
  for (let column = 0; column < maxColumns; column += 1) {
    const char = column < graph.length ? graph[column] : " ";
    if (char === " ") continue;
    const color = gitGraphLaneColor(column);
    const cx = (column + 0.5) * GRAPH_CELL_W;
    // 忠实于等宽字形几何：`|`/`*`/`o` 所在格都画贯穿整行的垂直主干，
    // 行与行之间的泳道因此无缝隙；`\`/`/` 画满整格对角线；圆点是提交节点。
    if (char === "|" || char === "*" || char === "o") {
      cells.push(<line key={`v${column}`} x1={cx} y1={0} x2={cx} y2={GRAPH_ROW_H} stroke={color} strokeWidth={2} strokeLinecap="round" />);
      if (char !== "|") {
        cells.push(
          <g key={`d${column}`}>
            <circle cx={cx} cy={my} r={5.5} fill={color} />
            <circle cx={cx} cy={my} r={2} fill="var(--surface-raised)" />
            {head && <circle cx={cx} cy={my} r={8} fill="none" stroke={color} strokeWidth={1.5} opacity={0.7} />}
          </g>,
        );
      }
    } else if (char === "\\") {
      cells.push(<line key={column} x1={column * GRAPH_CELL_W + 1} y1={0} x2={(column + 1) * GRAPH_CELL_W - 1} y2={GRAPH_ROW_H} stroke={color} strokeWidth={2} strokeLinecap="round" />);
    } else if (char === "/") {
      cells.push(<line key={column} x1={(column + 1) * GRAPH_CELL_W - 1} y1={0} x2={column * GRAPH_CELL_W + 1} y2={GRAPH_ROW_H} stroke={color} strokeWidth={2} strokeLinecap="round" />);
    } else if (char === "_") {
      cells.push(<line key={column} x1={column * GRAPH_CELL_W} y1={GRAPH_ROW_H * 0.8} x2={(column + 1) * GRAPH_CELL_W} y2={GRAPH_ROW_H * 0.8} stroke={color} strokeWidth={2} strokeLinecap="round" />);
    } else if (char === ".") {
      cells.push(<line key={column} x1={column * GRAPH_CELL_W} y1={my} x2={(column + 1) * GRAPH_CELL_W} y2={my} stroke={color} strokeWidth={2} strokeLinecap="round" />);
    } else {
      cells.push(<circle key={column} cx={cx} cy={my} r={1.4} fill={color} opacity={0.5} />);
    }
  }
  return (
    <svg className="git-graph-svg" width={maxColumns * GRAPH_CELL_W} height={GRAPH_ROW_H} aria-hidden="true">
      {cells}
    </svg>
  );
}

export function GitTreeGraph({ lines, selectedHash, onSelect }: GitTreeGraphProps) {
  const maxColumns = useMemo(
    () => lines.reduce((max, line) => Math.max(max, line.graph.length), 0),
    [lines],
  );
  if (lines.length === 0) return null;

  return (
    <div className="git-graph-list">
      {lines.map((line, index) => {
        if (line.hash === null) {
          return (
            <div key={`c${index}`} className="git-graph-connector" aria-hidden="true">
              <GraphCells graph={line.graph} maxColumns={maxColumns} />
            </div>
          );
        }
        const selected = line.hash === selectedHash;
        return (
          <button
            key={line.hash}
            type="button"
            className={`git-graph-row ${selected ? "selected" : ""}`}
            onClick={() => onSelect(line.hash as string)}
            title={line.subject ?? line.shortHash ?? undefined}
          >
            <GraphCells graph={line.graph} maxColumns={maxColumns} head={line.refs.some((ref) => ref.startsWith("HEAD"))} />
            <span className="git-graph-hash">{line.shortHash}</span>
            {line.refs.map((ref) => (
              <span key={ref} className={`git-graph-ref git-ref-${gitRefKind(ref)}`} title={ref}>{ref}</span>
            ))}
            <span className="git-graph-subject" title={line.subject ?? undefined}>{line.subject}</span>
          </button>
        );
      })}
    </div>
  );
}
