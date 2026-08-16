import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  createWorkspaceFolder,
  deleteWorkspacePath,
  listWorkspaceFiles,
  openInVscode,
  revealInExplorer,
  type WorkspaceFileEntry,
} from "../lib/desktop";
import { errorText } from "../app/model";

type FilesContextMenu = {
  x: number;
  y: number;
  entry: WorkspaceFileEntry;
};

type WorkspaceFilesPanelProps = {
  workspace: string;
  collapsed: boolean;
  onToggle: () => void;
  onError: (message: string) => void;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileIcon(name: string): string {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "⌘";
    case "json":
      return "{}";
    case "md":
    case "mdx":
      return "¶";
    case "html":
    case "htm":
      return "🅗";
    case "css":
    case "scss":
    case "less":
      return "#";
    case "rs":
      return "⚙";
    case "py":
      return "🐍";
    case "yml":
    case "yaml":
    case "toml":
      return "⚙";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return "◈";
    default:
      return "·";
  }
}

type NewFolderRowProps = {
  onCommit: (name: string) => void;
  onCancel: () => void;
};

function NewFolderRow({ onCommit, onCancel }: NewFolderRowProps) {
  const [value, setValue] = useState("");
  const doneRef = useRef(false);
  const commit = (name: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(name);
  };
  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };
  return (
    <div className="workspace-file-new-folder">
      <span className="workspace-file-icon" aria-hidden="true">📁</span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") commit(value);
          else if (event.key === "Escape") cancel();
        }}
        onBlur={() => {
          if (value.trim()) commit(value);
          else cancel();
        }}
        placeholder="新文件夹名称"
        autoFocus
        aria-label="新文件夹名称"
      />
    </div>
  );
}

export function WorkspaceFilesPanel({ workspace, collapsed, onToggle, onError }: WorkspaceFilesPanelProps) {
  const [rootEntries, setRootEntries] = useState<WorkspaceFileEntry[] | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [parentByPath, setParentByPath] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<ReadonlySet<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<FilesContextMenu | null>(null);
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceFileEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDirectory = useCallback(async (dir: string): Promise<WorkspaceFileEntry[]> => {
    const entries = await listWorkspaceFiles(dir);
    setParentByPath((current) => {
      const next = { ...current };
      for (const entry of entries) next[entry.path] = dir;
      return next;
    });
    return entries;
  }, []);

  const reloadRoot = useCallback(async () => {
    if (!workspace) {
      setRootEntries(null);
      setChildrenByPath({});
      setExpanded(new Set());
      return;
    }
    setLoadingRoot(true);
    try {
      const entries = await loadDirectory(workspace);
      setRootEntries(entries);
      setChildrenByPath({});
      setExpanded(new Set());
    } catch (error) {
      setRootEntries(null);
      onError(`读取工作区文件失败：${errorText(error)}`);
    } finally {
      setLoadingRoot(false);
    }
  }, [workspace, loadDirectory, onError]);

  useEffect(() => {
    void reloadRoot();
  }, [reloadRoot]);

  useEffect(() => {
    if (collapsed) {
      setContextMenu(null);
      setDeleteTarget(null);
      setCreatingFolderIn(null);
    }
  }, [collapsed]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  async function toggleFolder(entry: WorkspaceFileEntry) {
    const path = entry.path;
    if (expanded.has(path)) {
      const next = new Set(expanded);
      next.delete(path);
      setExpanded(next);
      return;
    }
    const next = new Set(expanded);
    next.add(path);
    setExpanded(next);
    if (!(path in childrenByPath)) {
      setLoadingPaths((current) => new Set(current).add(path));
      try {
        const children = await loadDirectory(path);
        setChildrenByPath((current) => ({ ...current, [path]: children }));
      } catch (error) {
        onError(`读取文件夹失败：${errorText(error)}`);
      } finally {
        setLoadingPaths((current) => {
          const nextSet = new Set(current);
          nextSet.delete(path);
          return nextSet;
        });
      }
    }
  }

  async function refreshDirectory(dir: string) {
    try {
      const entries = await loadDirectory(dir);
      if (dir === workspace) setRootEntries(entries);
      else setChildrenByPath((current) => ({ ...current, [dir]: entries }));
    } catch (error) {
      onError(`刷新目录失败：${errorText(error)}`);
    }
  }

  async function handleOpenInVscode(path: string) {
    setBusy(true);
    try {
      await openInVscode(path);
    } catch (error) {
      onError(`用 VSCode 打开失败：${errorText(error)}`);
    } finally {
      setBusy(false);
      setContextMenu(null);
    }
  }

  async function handleReveal(path: string) {
    setBusy(true);
    try {
      await revealInExplorer(path);
    } catch (error) {
      onError(`在资源管理器中显示失败：${errorText(error)}`);
    } finally {
      setBusy(false);
      setContextMenu(null);
    }
  }

  async function handleCopyPath(path: string) {
    setContextMenu(null);
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = path;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      } catch {
        onError("复制路径失败");
      }
    }
  }

  async function handleCreateFolder(parent: string, name: string) {
    const trimmed = name.trim();
    setCreatingFolderIn(null);
    if (!trimmed) return;
    try {
      await createWorkspaceFolder(parent, trimmed);
      if (parent !== workspace) setExpanded((current) => new Set(current).add(parent));
      await refreshDirectory(parent);
    } catch (error) {
      onError(`新建文件夹失败：${errorText(error)}`);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setBusy(true);
    try {
      await deleteWorkspacePath(target.path);
      const parent = parentByPath[target.path] ?? workspace;
      if (parent === workspace) {
        setRootEntries((current) => current?.filter((entry) => entry.path !== target.path) ?? current);
      } else {
        setChildrenByPath((current) => {
          const next = { ...current };
          if (parent in next) next[parent] = next[parent].filter((entry) => entry.path !== target.path);
          delete next[target.path];
          return next;
        });
      }
    } catch (error) {
      onError(`删除失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function beginNewFolder(parent: string) {
    setContextMenu(null);
    setCreatingFolderIn(parent);
  }

  const renderEntries = (entries: WorkspaceFileEntry[] | undefined, depth: number) => {
    if (!entries) return null;
    return entries.map((entry) => {
      const isOpen = expanded.has(entry.path);
      const children = childrenByPath[entry.path];
      const loading = loadingPaths.has(entry.path);
      return (
        <div
          key={entry.path}
          className={`workspace-file-row ${entry.isDir ? "is-dir" : "is-file"} ${isOpen ? "open" : ""}`}
          style={{ "--file-depth": depth } as CSSProperties}
        >
          <button
            className="workspace-file-main"
            type="button"
            title={entry.path}
            onClick={() => {
              if (entry.isDir) void toggleFolder(entry);
              else void handleOpenInVscode(entry.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ x: event.clientX, y: event.clientY, entry });
            }}
          >
            <span className="workspace-file-chevron" aria-hidden="true">
              {entry.isDir ? (loading ? "…" : isOpen ? "▾" : "▸") : ""}
            </span>
            <span className="workspace-file-icon" aria-hidden="true">{entry.isDir ? "📁" : fileIcon(entry.name)}</span>
            <span className="workspace-file-name">{entry.name}</span>
            {!entry.isDir && <span className="workspace-file-size">{formatFileSize(entry.size)}</span>}
          </button>
          {entry.isDir && isOpen && (
            <div className="workspace-file-children">
              {creatingFolderIn === entry.path && <NewFolderRow onCommit={(name) => void handleCreateFolder(entry.path, name)} onCancel={() => setCreatingFolderIn(null)} />}
              {loading && !children ? <div className="workspace-file-loading">加载中…</div> : renderEntries(children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  const menu = contextMenu;
  const menuX = menu ? Math.min(menu.x, window.innerWidth - 220) : 0;
  const menuY = menu ? Math.min(menu.y, window.innerHeight - 200) : 0;
  const showingNewFolderAtRoot = creatingFolderIn === workspace;
  const rootEmpty = rootEntries !== null && rootEntries.length === 0 && !showingNewFolderAtRoot;

  return (
    <aside className={`workspace-files-panel ${collapsed ? "collapsed" : "expanded"}`} aria-label="工作区文件">
      <button
        className="workspace-files-rail"
        type="button"
        onClick={onToggle}
        aria-controls="workspace-files-card"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开文件面板" : "收起文件面板"}
        title={collapsed ? "展开文件面板" : "收起文件面板"}
      >
        <span className="workspace-files-rail-mark" aria-hidden="true">▤</span>
      </button>
      {!collapsed && (
        <div id="workspace-files-card" className="workspace-files-card">
          <header className="workspace-files-header">
            <div className="workspace-files-heading">
              <span className="workspace-files-mark" aria-hidden="true">▤</span>
              <div>
                <span className="workspace-files-kicker">工作区</span>
                <h2>文件</h2>
              </div>
            </div>
            <div className="workspace-files-header-actions">
              <span className="workspace-files-total">{rootEntries?.length ?? 0}</span>
              <button className="workspace-files-toggle" type="button" onClick={onToggle} aria-label="收起文件面板" title="收起文件面板"><span aria-hidden="true">‹</span></button>
            </div>
          </header>
          <div className="workspace-files-body">
            <div className="workspace-files-summary">
              <span className={`workspace-files-live ${loadingRoot ? "loading" : ""}`}>{loadingRoot ? "加载中…" : `${rootEntries?.length ?? 0} 个条目`}</span>
              <span className="workspace-files-path" title={workspace}>{workspace || "未选择工作目录"}</span>
            </div>
            <div className="workspace-files-toolbar">
              <button type="button" disabled={!workspace} onClick={() => workspace && beginNewFolder(workspace)} title="新建文件夹">＋ 新建文件夹</button>
              <button type="button" disabled={!workspace} onClick={() => void reloadRoot()} title="刷新">⟳</button>
            </div>
            <div className="workspace-files-tree">
              {!workspace ? (
                <div className="workspace-files-empty">尚未选择工作目录</div>
              ) : loadingRoot ? (
                <div className="workspace-files-empty">正在读取…</div>
              ) : rootEntries === null ? (
                <div className="workspace-files-empty">读取失败，请重试</div>
              ) : (
                <>
                  {showingNewFolderAtRoot && <NewFolderRow onCommit={(name) => void handleCreateFolder(workspace, name)} onCancel={() => setCreatingFolderIn(null)} />}
                  {renderEntries(rootEntries, 0)}
                  {rootEmpty && <div className="workspace-files-empty">空目录</div>}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {menu && createPortal(
        <div
          className="workspace-files-context-menu"
          style={{ left: menuX, top: menuY }}
          role="menu"
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" disabled={busy} onClick={() => void handleOpenInVscode(menu.entry.path)}>用 VSCode 打开</button>
          <button role="menuitem" disabled={busy} onClick={() => void handleReveal(menu.entry.path)}>在资源管理器中显示</button>
          <button role="menuitem" onClick={() => void handleCopyPath(menu.entry.path)}>复制路径</button>
          {menu.entry.isDir && <button role="menuitem" onClick={() => beginNewFolder(menu.entry.path)}>新建文件夹</button>}
          <button role="menuitem" className="danger" onClick={() => setDeleteTarget(menu.entry)}>删除</button>
        </div>,
        document.body,
      )}

      {deleteTarget && (
        <div className="confirm-backdrop" onMouseDown={() => setDeleteTarget(null)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{deleteTarget.isDir ? "删除文件夹？" : "删除文件？"}</strong>
            <p>“{deleteTarget.name}”将被永久删除，无法恢复。</p>
            <div className="surface-dialog-actions">
              <button onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="confirm danger-button" disabled={busy} onClick={() => void confirmDelete()}>删除</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
