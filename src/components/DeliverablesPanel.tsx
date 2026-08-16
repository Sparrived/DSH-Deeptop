import { pathBasename, type TranscriptItem } from "../app/model";
import type { DshSessionSummary } from "../lib/desktop";

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
  return (
    <aside className={`deliverables-panel ${collapsed ? "collapsed" : "expanded"}`} aria-label="生成文件" aria-live="polite">
      <button
        className="deliverables-panel-rail"
        type="button"
        onClick={onToggle}
        aria-controls="deliverables-panel-content"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开生成文件" : "收起生成文件"}
        title={collapsed ? "展开生成文件" : "收起生成文件"}
      >
        <span className="deliverables-mark" aria-hidden="true" />
      </button>
      {!collapsed && (
        <div id="deliverables-panel-content" className="deliverables-panel-card">
          <header className="deliverables-panel-header">
            <div className="deliverables-panel-heading">
              <span className="deliverables-mark" aria-hidden="true" />
              <div>
                <span className="deliverables-panel-kicker">本回合写入</span>
                <h2>生成文件</h2>
              </div>
            </div>
            <div className="deliverables-panel-header-actions">
              <span className="deliverables-panel-total">{files.length} 个文件</span>
              <button className="deliverables-panel-toggle" type="button" onClick={onToggle} aria-controls="deliverables-panel-content" aria-expanded={true} aria-label="收起生成文件" title="收起生成文件"><span aria-hidden="true">›</span></button>
            </div>
          </header>
          <div className="deliverables-panel-body">
            <div className="deliverables-panel-summary">
              <span className="live">{files.length} 个文件</span>
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
                      <span className="deliverable-file-open" aria-hidden="true" />
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
          </div>
        </div>
      )}
    </aside>
  );
}
