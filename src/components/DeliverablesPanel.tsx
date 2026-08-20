import { pathBasename, type TranscriptItem } from "../app/model";
import type { DshSessionSummary } from "../lib/desktop";
import { DockFrame } from "./DockFrame";

type DeliverablesPanelProps = {
  item: TranscriptItem;
  activeSession: DshSessionSummary | null;
  collapsed: boolean;
  onToggle: () => void;
  onOpenSessionPath: (path: string) => void | Promise<void>;
};

function fileTypeLabel(path: string) {
  const name = pathBasename(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "FILE";
  return name.slice(dot + 1).toUpperCase().slice(0, 6);
}

function fileDirectory(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0) return "工作目录";
  const directory = normalized.slice(0, separator);
  return directory || "工作目录";
}

export function DeliverablesPanel({ item, activeSession, collapsed, onToggle, onOpenSessionPath }: DeliverablesPanelProps) {
  const files = item.files ?? [];
  const fileDiffs = item.fileDiffs ?? {};
  const diffTotals = Object.values(fileDiffs).reduce(
    (totals, diff) => ({ added: totals.added + diff.added, removed: totals.removed + diff.removed }),
    { added: 0, removed: 0 },
  );
  const totalDiffLines = diffTotals.added + diffTotals.removed;
  return (
    <DockFrame
      id="deliverables-dock"
      className="deliverables-panel"
      collapsed={collapsed}
      label="生成文件"
      title="生成文件"
      kicker="本回合写入"
      icon={null}
      markClassName="deliverables-mark"
      total={`${files.length} 个文件`}
      onToggle={onToggle}
      railClassName="deliverables-panel-rail"
      cardClassName="deliverables-panel-card"
      headerClassName="deliverables-panel-header"
      headingClassName="deliverables-panel-heading"
      kickerClassName="deliverables-panel-kicker"
      headerActionsClassName="deliverables-panel-header-actions"
      totalClassName="deliverables-panel-total"
      toggleClassName="deliverables-panel-toggle"
      bodyClassName="deliverables-panel-body"
    >
      <div className="deliverables-panel-summary">
        <span className="live">{files.length} 个文件</span>
        <span className="deliverables-diff-total" aria-label={`总 diff ${totalDiffLines} 行，新增 ${diffTotals.added} 行，删除 ${diffTotals.removed} 行`}>
          总 diff {totalDiffLines} 行
          <b className="diff-added">+{diffTotals.added}</b>
          <b className="diff-removed">−{diffTotals.removed}</b>
        </span>
        <span>本回合写入工作区</span>
      </div>
      <div className="deliverables-panel-files">
        <div className="deliverables-files">
          {files.map((path) => {
            const diff = fileDiffs[path];
            return (
              <button className="deliverable-file" type="button" key={`${item.key}-${path}`} onClick={() => void onOpenSessionPath(path)} title={path} aria-label={`打开 ${path}${diff ? `，新增 ${diff.added} 行，删除 ${diff.removed} 行` : ""}`}>
                <span className="deliverable-file-type" aria-hidden="true">{fileTypeLabel(path)}</span>
                <span className="deliverable-file-copy"><strong>{pathBasename(path)}</strong><small>{fileDirectory(path)}</small></span>
                {diff && <span className="deliverable-file-diff" aria-label={`新增 ${diff.added} 行，删除 ${diff.removed} 行`}><b>+{diff.added}</b><b>−{diff.removed}</b></span>}
                <span className="deliverable-file-open" aria-hidden="true">↗</span>
              </button>
            );
          })}
        </div>
      </div>
      {activeSession?.cwd && (
        <div className="deliverables-actions">
          <button type="button" className="deliverables-folder" onClick={() => void onOpenSessionPath(".")}>
            <span className="folder-icon" aria-hidden="true" />在文件夹中显示
          </button>
        </div>
      )}
    </DockFrame>
  );
}
