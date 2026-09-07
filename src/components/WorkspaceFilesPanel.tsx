import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Braces, ChevronLeft, ChevronRight, FileCode2, FileCog, FileText, FileType2, Folder, FolderOpen, Image, Plus, RefreshCw } from "lucide-react";
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
import { t, type UiLocale } from "../app/i18n";
import { WORKSPACE_FILES_CONTEXT_MENU_SELECTOR } from "../app/context-menu";
import { useFloatingMenuPosition } from "../app/useFloatingMenuPosition";
import { DockFrame } from "./DockFrame";

type FilesContextMenu = {
  x: number;
  y: number;
  entry: WorkspaceFileEntry;
};

type WorkspaceFilesPanelProps = {
  workspace: string;
  collapsed: boolean;
  locale?: UiLocale;
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

function fileIcon(name: string): ReactNode {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
      return <FileCode2 />;
    case "json":
      return <Braces />;
    case "md":
    case "mdx":
      return <FileText />;
    case "html":
    case "htm":
    case "css":
    case "scss":
    case "less":
      return <FileType2 />;
    case "rs":
    case "yml":
    case "yaml":
    case "toml":
      return <FileCog />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return <Image />;
    default:
      return <FileText />;
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

function gitFileLabel(file: WorkspaceGitFile, locale: UiLocale): string {
  if (file.status === "untracked") return t("files.gitUntracked", locale);
  if (file.status === "conflicted") return t("files.gitConflicted", locale);
  if (file.isRenamed) return t("files.gitRenamed", locale);
  if (file.code.includes("D")) return t("files.gitDeleted", locale);
  if (file.code.includes("A")) return t("files.gitAdded", locale);
  if (file.status === "staged") return t("files.gitStaged", locale);
  if (file.status === "staged-changed") return t("files.gitStagedChanged", locale);
  return t("files.gitModified", locale);
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
  locale: UiLocale;
};

function NewFolderRow({ onCommit, onCancel, locale }: NewFolderRowProps) {
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
      <span className="workspace-file-icon" aria-hidden="true"><Folder /></span>
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
        placeholder={t("files.newFolderPlaceholder", locale)}
        autoFocus
        aria-label={t("files.newFolderPlaceholder", locale)}
      />
    </div>
  );
}

export function WorkspaceFilesPanel({ workspace, collapsed, locale = "zh", onToggle, onError, onAddPathToComposer }: WorkspaceFilesPanelProps) {
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
      onError(t("files.errGitStatus", locale, { detail: errorText(error) }));
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
      onError(t("files.errListFiles", locale, { detail: errorText(error) }));
    } finally {
      setLoadingRoot(false);
    }
    void reloadGit();
  }, [locale, workspace, loadDirectory, onError, reloadGit]);

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
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(WORKSPACE_FILES_CONTEXT_MENU_SELECTOR)) return;
      setContextMenu(null);
    };
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
        onError(t("files.errListFolder", locale, { detail: errorText(error) }));
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
      onError(t("files.errRefresh", locale, { detail: errorText(error) }));
    }
  }

  async function handleOpenInVscode(path: string) {
    setBusy(true);
    try {
      await openInVscode(path);
    } catch (error) {
      onError(t("files.errOpenVscode", locale, { detail: errorText(error) }));
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
      onError(t("files.errReveal", locale, { detail: errorText(error) }));
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
      onError(t("files.errCopyPath", locale, { detail: errorText(error) }));
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
      onError(t("files.errNewFolder", locale, { detail: errorText(error) }));
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
      onError(t("files.errDelete", locale, { detail: errorText(error) }));
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
              {entry.isDir && !loading && <ChevronRight className={isOpen ? "open" : undefined} />}
              {entry.isDir && loading && "…"}
            </span>
            <span className="workspace-file-icon" aria-hidden="true">{entry.isDir ? (isOpen ? <FolderOpen /> : <Folder />) : fileIcon(entry.name)}</span>
            <span className="workspace-file-name">{entry.name}</span>
            {visibleStatus && <span className={`workspace-file-git-mark git-mark-${visibleStatus.status}`} title={gitFileLabel(visibleStatus, locale)} aria-label={gitFileLabel(visibleStatus, locale)}>{gitFileMark(visibleStatus)}</span>}
            {!entry.isDir && <span className="workspace-file-size">{formatFileSize(entry.size)}</span>}
          </button>
          {entry.isDir && isOpen && (
            <div className="workspace-file-children">
              {creatingFolderIn === entry.path && <NewFolderRow locale={locale} onCommit={(name) => void handleCreateFolder(entry.path, name)} onCancel={() => setCreatingFolderIn(null)} />}
              {loading && !children ? <div className="workspace-file-loading">{t("files.loading", locale)}</div> : renderEntries(children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  const menu = contextMenu;
  const { menuRef, menuAt } = useFloatingMenuPosition(menu);
  const showingNewFolderAtRoot = creatingFolderIn === workspace;
  const rootEmpty = rootEntries !== null && rootEntries.length === 0 && !showingNewFolderAtRoot;

  return (
    <DockFrame
      id="workspace-files-dock"
      side="left"
      className="workspace-files-panel"
      collapsed={collapsed}
      label={t("files.label", locale)}
      title={t("files.title", locale)}
      kicker={t("files.kicker", locale)}
       icon={<FileText />}
       toggleGlyph={<ChevronLeft />}
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
              <span className={`workspace-files-live ${loadingRoot || loadingGit ? "loading" : ""}`}>{loadingRoot || loadingGit ? t("files.syncing", locale) : t("files.entryCount", locale, { count: rootEntries?.length ?? 0 })}</span>
              <span className="workspace-files-path" title={workspace}>{workspace || t("files.noWorkspace", locale)}</span>
            </div>
            {workspace && <div className="workspace-git-summary" aria-label={t("files.gitSummaryAria", locale)}>{gitStatus?.isRepository && <span className="workspace-git-branch">⌘ {gitStatus.branch ?? "HEAD"}</span>}{!gitStatus?.isRepository && <span className="workspace-git-no-repo">{t("files.noGitRepo", locale)}</span>}{gitStatus?.isRepository && <><span className="workspace-git-count git-count-changed">{t("files.changedCount", locale, { count: (gitStatus.changed + gitStatus.staged) || 0 })}</span><span className="workspace-git-count git-count-untracked">{t("files.untrackedCount", locale, { count: gitStatus.untracked })}</span>{gitStatus.conflicted > 0 && <span className="workspace-git-count git-count-conflicted">{t("files.conflictCount", locale, { count: gitStatus.conflicted })}</span>}</>}</div>}
             <div className="workspace-files-toolbar">
              <div className="workspace-files-filter" role="group" aria-label={t("files.filterAria", locale)}>{(["all", "changed", "staged", "untracked", "conflicted"] as const).map((filter) => { const count = filter === "all" ? (gitStatus?.files.length ?? 0) : (gitStatus?.files.filter((file) => matchesGitFilter(file, filter)).length ?? 0); const label = filter === "all" ? t("files.filterAll", locale) : filter === "changed" ? t("files.filterChanged", locale) : filter === "staged" ? t("files.filterStaged", locale) : filter === "untracked" ? t("files.filterUntracked", locale) : t("files.filterConflicted", locale); return <button key={filter} type="button" className={gitFilter === filter ? "selected" : ""} disabled={filter !== "all" && !gitStatus?.isRepository} onClick={() => setGitFilter(filter)}>{label}{filter !== "all" && count > 0 ? ` ${count}` : ""}</button>; })}</div><button type="button" disabled={!workspace} onClick={() => workspace && beginNewFolder(workspace)} title={t("files.newFolder", locale)}><Plus aria-hidden="true" /> {t("files.newFolder", locale)}</button>
              <button type="button" disabled={!workspace} onClick={() => void reloadRoot()} title={t("files.refresh", locale)}><RefreshCw aria-hidden="true" /></button>
            </div>
            <div className="workspace-files-tree">
              {!workspace ? (
                <div className="workspace-files-empty">{t("files.noWorkspaceYet", locale)}</div>
              ) : loadingRoot ? (
                <div className="workspace-files-empty">{t("files.reading", locale)}</div>
              ) : rootEntries === null ? (
                <div className="workspace-files-empty">{t("files.readFailed", locale)}</div>
              ) : (
                <>
                  {showingNewFolderAtRoot && <NewFolderRow locale={locale} onCommit={(name) => void handleCreateFolder(workspace, name)} onCancel={() => setCreatingFolderIn(null)} />}
                  {renderEntries(rootEntries, 0)}
                  {rootEmpty && <div className="workspace-files-empty">{t("files.emptyDir", locale)}</div>}
                </>
              )}

      </div>

      {menu && createPortal(
        <div
          ref={menuRef}
          className="workspace-files-context-menu"
          style={{ left: menuAt?.left ?? menu.x, top: menuAt?.top ?? menu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button role="menuitem" disabled={busy} onClick={() => void handleOpenInVscode(menu.entry.path)}>{t("files.openWithVscode", locale)}</button>
          <button role="menuitem" disabled={busy} onClick={() => void handleReveal(menu.entry.path)}>{t("files.revealInExplorer", locale)}</button>
          <button role="menuitem" onClick={() => void handleCopyPath(menu.entry.path)}>{t("files.copyPath", locale)}</button>
          <button role="menuitem" onClick={() => handleAddPathToComposer(menu.entry.path)}>{t("files.addToComposer", locale)}</button>
          {menu.entry.isDir && <button role="menuitem" onClick={() => beginNewFolder(menu.entry.path)}>{t("files.newFolder", locale)}</button>}
          <button role="menuitem" className="danger" onClick={() => setDeleteTarget(menu.entry)}>{t("common.delete", locale)}</button>
        </div>,
        document.body,
      )}

      {deleteTarget && (
        <div className="confirm-backdrop" onMouseDown={() => setDeleteTarget(null)}>
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{deleteTarget.isDir ? t("files.deleteFolder", locale) : t("files.deleteFile", locale)}</strong>
            <p>{t("files.deleteWarning", locale, { name: deleteTarget.name })}</p>
            <div className="surface-dialog-actions">
              <button onClick={() => setDeleteTarget(null)}>{t("common.cancel", locale)}</button>
              <button className="confirm danger-button" disabled={busy} onClick={() => void confirmDelete()}>{t("common.delete", locale)}</button>
            </div>
          </div>
        </div>
      )}
    </DockFrame>
  );
}
