import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  createWorkspaceFolder,
  deleteWorkspacePath,
  getWorkspaceGitStatus,
  listWorkspaceFiles,
  openInVscode,
  revealInExplorer,
  writeClipboard,
  type WorkspaceFileEntry,
  type WorkspaceGitFile,
  type WorkspaceGitStatus,
} from "../lib/desktop";
import { errorText } from "../app/model";
import { DockFrame } from "./DockFrame";

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
  onAddPathToComposer: (path: string) => void;
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

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function workspaceRelativePath(root: string, path: string): string {
  const normalizedRoot = normalizeGitPath(root).replace(/\/$/, "");
  const normalizedPath = normalizeGitPath(path);
  const rootPrefix = `${normalizedRoot}/`;
  if (normalizedPath.toLocaleLowerCase().startsWith(rootPrefix.toLocaleLowerCase())) {
    return normalizedPath.slice(rootPrefix.length);
  }
  return normalizedPath;
}

function gitFileLabel(file: WorkspaceGitFile): string {
  if (file.status === "untracked") return "未跟踪";
  if (file.status === "conflicted") return "冲突";
  if (file.isRenamed) return "已重命名";
  if (file.code.includes("D")) return "已删除";
  if (file.code.includes("A")) return "已添加";
  if (file.status === "staged") return "已暂存";
  if (file.status === "staged-changed") return "暂存 + 修改";
  return "已修改";
}

function gitFileMark(file: WorkspaceGitFile): string {
  if (file.status === "untracked") return "?";
  if (file.status === "conflicted") return "!";
  if (file.isRenamed) return "R";
  if (file.code.includes("A")) return "A";
  if (file.code.includes("D")) return "D";
  return "M";
}

function matchesGitFilter(file: WorkspaceGitFile, filter: "all" | WorkspaceGitFile["status"]): boolean {
  if (filter === "all") return true;
  if (filter === "changed") return file.status === "changed" || file.status === "staged-changed";
  if (filter === "staged") return file.status === "staged" || file.status === "staged-changed";
  return file.status === filter;
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

export function WorkspaceFilesPanel({ workspace, collapsed, onToggle, onError, onAddPathToComposer }: WorkspaceFilesPanelProps) {
  const [rootEntries, setRootEntries] = useState<WorkspaceFileEntry[] | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatus | null>(null);
  const [loadingGit, setLoadingGit] = useState(false);
  const [gitFilter, setGitFilter] = useState<"all" | WorkspaceGitFile["status"]>("all");
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

  const reloadGit = useCallback(async () => {
    if (!workspace) {
      setGitStatus(null);
      return;
    }
    setLoadingGit(true);
    try {
      setGitStatus(await getWorkspaceGitStatus(workspace));
    } catch (error) {
      setGitStatus(null);
      onError(`读取 Git 状态失败：${errorText(error)}`);
    } finally {
      setLoadingGit(false);
    }
  }, [workspace, onError]);

  const reloadRoot = useCallback(async () => {
    if (!workspace) {
      setRootEntries(null);
      setGitStatus(null);
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
    void reloadGit();
  }, [workspace, loadDirectory, onError, reloadGit]);

  useEffect(() => {
    setGitFilter("all");
    void reloadRoot();
  }, [reloadRoot]);

  const gitFilesByPath = useMemo(() => {
    const result = new Map<string, WorkspaceGitFile>();
    for (const file of gitStatus?.files ?? []) result.set(normalizeGitPath(file.path), file);
    return result;
  }, [gitStatus]);

  const gitFilesByDirectory = useMemo(() => {
    const result = new Map<string, WorkspaceGitFile[]>();
    for (const file of gitStatus?.files ?? []) {
      const path = normalizeGitPath(file.path);
      const segments = path.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        const directory = segments.slice(0, index).join("/");
        const current = result.get(directory) ?? [];
        current.push(file);
        result.set(directory, current);
      }
    }
    return result;
  }, [gitStatus]);

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
      await writeClipboard(path);
    } catch (error) {
      onError(`复制路径失败：${errorText(error)}`);
    }
  }

  function handleAddPathToComposer(path: string) {
    setContextMenu(null);
    onAddPathToComposer(path);
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
      const relativePath = workspaceRelativePath(gitStatus?.root ?? workspace, entry.path);
      const fileStatus = gitFilesByPath.get(relativePath);
      const directoryStatuses = entry.isDir ? (gitFilesByDirectory.get(relativePath) ?? []) : [];
      const matchesEntry = fileStatus ? matchesGitFilter(fileStatus, gitFilter) : false;
      const hasFilteredDescendant = directoryStatuses.some((file) => matchesGitFilter(file, gitFilter));
      if (gitFilter !== "all" && !matchesEntry && !hasFilteredDescendant) return null;
      const isOpen = expanded.has(entry.path);
      const children = childrenByPath[entry.path];
      const loading = loadingPaths.has(entry.path);
      const directoryStatus = directoryStatuses.find((file) => file.status === "conflicted") ?? directoryStatuses.find((file) => file.status === "changed" || file.status === "staged-changed") ?? directoryStatuses[0];
      const visibleStatus = fileStatus ?? directoryStatus;
      return (
        <div
          key={entry.path}
          className={`workspace-file-row ${entry.isDir ? "is-dir" : "is-file"} ${isOpen ? "open" : ""} ${visibleStatus ? `git-${visibleStatus.status}` : ""}`}
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
            {visibleStatus && <span className={`workspace-file-git-mark git-mark-${visibleStatus.status}`} title={gitFileLabel(visibleStatus)} aria-label={gitFileLabel(visibleStatus)}>{gitFileMark(visibleStatus)}</span>}
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
  const menuY = menu ? Math.min(menu.y, window.innerHeight - 240) : 0;
  const showingNewFolderAtRoot = creatingFolderIn === workspace;
  const rootEmpty = rootEntries !== null && rootEntries.length === 0 && !showingNewFolderAtRoot;

  return (
    <DockFrame
      id="workspace-files-dock"
      side="left"
      className="workspace-files-panel"
      collapsed={collapsed}
      label="工作区文件"
      title="文件"
      kicker="工作区"
      icon="▤"
      total={rootEntries?.length ?? 0}
      toggleGlyph="‹"
      onToggle={onToggle}
      railClassName="workspace-files-rail"
      railMarkClassName="workspace-files-rail-mark"
      headerMarkClassName="workspace-files-mark"
      cardClassName="workspace-files-card"
      headerClassName="workspace-files-header"
      headingClassName="workspace-files-heading"
      kickerClassName="workspace-files-kicker"
      headerActionsClassName="workspace-files-header-actions"
      totalClassName="workspace-files-total"
      toggleClassName="workspace-files-toggle"
      bodyClassName="workspace-files-body"
    >
            <div className="workspace-files-summary">
              <span className={`workspace-files-live ${loadingRoot || loadingGit ? "loading" : ""}`}>{loadingRoot || loadingGit ? "同步中…" : `${rootEntries?.length ?? 0} 个条目`}</span>
              <span className="workspace-files-path" title={workspace}>{workspace || "未选择工作目录"}</span>
            </div>
            {workspace && <div className="workspace-git-summary" aria-label="Git 工作区摘要">{gitStatus?.isRepository && <span className="workspace-git-branch">⌘ {gitStatus.branch ?? "HEAD"}</span>}{!gitStatus?.isRepository && <span className="workspace-git-no-repo">未检测到 Git 仓库</span>}{gitStatus?.isRepository && <><span className="workspace-git-count git-count-changed">{(gitStatus.changed + gitStatus.staged) || 0} 修改</span><span className="workspace-git-count git-count-untracked">{gitStatus.untracked} 未跟踪</span>{gitStatus.conflicted > 0 && <span className="workspace-git-count git-count-conflicted">{gitStatus.conflicted} 冲突</span>}</>}</div>}
             <div className="workspace-files-toolbar">
              <div className="workspace-files-filter" role="group" aria-label="筛选 Git 状态">{(["all", "changed", "staged", "untracked", "conflicted"] as const).map((filter) => { const count = filter === "all" ? (gitStatus?.files.length ?? 0) : (gitStatus?.files.filter((file) => matchesGitFilter(file, filter)).length ?? 0); const label = filter === "all" ? "全部" : filter === "changed" ? "修改" : filter === "staged" ? "暂存" : filter === "untracked" ? "未跟踪" : "冲突"; return <button key={filter} type="button" className={gitFilter === filter ? "selected" : ""} disabled={filter !== "all" && !gitStatus?.isRepository} onClick={() => setGitFilter(filter)}>{label}{filter !== "all" && count > 0 ? ` ${count}` : ""}</button>; })}</div><button type="button" disabled={!workspace} onClick={() => workspace && beginNewFolder(workspace)} title="新建文件夹">＋ 新建文件夹</button>
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
          <button role="menuitem" onClick={() => handleAddPathToComposer(menu.entry.path)}>添加到聊天框</button>
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
    </DockFrame>
  );
}
