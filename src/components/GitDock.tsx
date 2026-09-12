import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, GitBranch, Minus, Plus, RefreshCw, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  deleteGitBranch,
  discardGitPaths,
  getGitCommitDetail,
  getGitCommitFileDiff,
  getGitFileDiff,
  getWorkspaceGitStatus,
  isTauri,
  listGitBranches,
  listGitGraph,
  listGitLog,
  pullGit,
  pushGit,
  stageAllGit,
  stageGitPaths,
  unstageAllGit,
  unstageGitPaths,
  writeClipboard,
  type GitCommandResult,
  type WorkspaceGitBranch,
  type WorkspaceGitCommit,
  type WorkspaceGitCommitDetail,
  type WorkspaceGitFile,
  type WorkspaceGitGraphLine,
  type WorkspaceGitStatus,
} from "../lib/desktop";
import { errorText } from "../app/model";
import {
  canStageFile,
  canUnstageFile,
  diffLineKind,
  formatRelativeTime,
  gitFileLabel,
  gitFileMark,
  groupGitBranches,
  groupGitFiles,
} from "../app/git-model";
import {
  beginRefresh,
  decideGitGraphRefresh,
  GIT_GRAPH_PAGE_SIZE,
  gitGraphHasMore,
  gitGraphRefreshLimit,
  gitRefSignature,
  INITIAL_GIT_GRAPH_REFRESH_STATE,
  mergeRefreshedRows,
  settleRefresh,
  type GitGraphRefreshState,
} from "../app/git-graph-refresh";
import { DockFrame } from "./DockFrame";
import { PopupDialog } from "./PopupDialog";
import { GitTreeGraph } from "./GitTreeGraph";
import { t, type UiLocale } from "../app/i18n";
import { trackAsyncCleanup } from "../lib/async-cleanup";

type GitDockTab = "changes" | "history" | "branches";

type GitDockProps = {
  locale?: UiLocale;
  workspace: string;
  collapsed: boolean;
  onToggle: () => void;
  onError: (message: string) => void;
};

const GIT_RAIL_LABEL = "Git";

function ChangeRow({
  file,
  selected,
  busy,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  locale,
}: {
  file: WorkspaceGitFile;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  locale: UiLocale;
}) {
  return (
    <div className={`git-change-row ${selected ? "selected" : ""}`}>
      <button className="git-change-main" type="button" onClick={onSelect} title={file.path}>
        <span className={`git-change-mark git-mark-${file.status}`} aria-hidden="true">{gitFileMark(file)}</span>
        <span className="git-change-path">{file.path}</span>
      </button>
      <div className="git-change-actions">
        {canStageFile(file) && (
          <button type="button" className="git-change-action" title={t("git.stage", locale)} aria-label={t("git.stageFile", locale, { path: file.path })} disabled={busy} onClick={onStage}><Plus aria-hidden="true" /></button>
        )}
        {canUnstageFile(file) && (
          <button type="button" className="git-change-action" title={t("git.unstage", locale)} aria-label={t("git.unstageFile", locale, { path: file.path })} disabled={busy} onClick={onUnstage}><Minus aria-hidden="true" /></button>
        )}
        <button type="button" className="git-change-action danger" title={t("git.discard", locale)} aria-label={t("git.discardFile", locale, { path: file.path })} disabled={busy} onClick={onDiscard}><X aria-hidden="true" /></button>
      </div>
    </div>
  );
}

export function GitDock({ workspace, collapsed, onToggle, onError, locale = "zh" }: GitDockProps) {
  const [tab, setTab] = useState<GitDockTab>("changes");
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffStaged, setDiffStaged] = useState(false);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [commits, setCommits] = useState<WorkspaceGitCommit[] | null>(null);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitDetail, setCommitDetail] = useState<WorkspaceGitCommitDetail | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);
  const [branches, setBranches] = useState<WorkspaceGitBranch[] | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitStageAll, setCommitStageAll] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<WorkspaceGitFile | null>(null);
  const [branchDialog, setBranchDialog] = useState<
    { mode: "create"; value: string } | { mode: "delete"; branch: WorkspaceGitBranch } | null
  >(null);
  const [result, setResult] = useState<GitCommandResult | null>(null);
  const [copyingHash, setCopyingHash] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<"list" | "graph">("list");
  const [graph, setGraph] = useState<WorkspaceGitGraphLine[] | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphRev, setGraphRev] = useState<string | null>(null);
  const [graphSimplify, setGraphSimplify] = useState(false);
  const [graphHasMore, setGraphHasMore] = useState(true);
  const [graphLoadingMore, setGraphLoadingMore] = useState(false);
  const [graphStale, setGraphStale] = useState(false);
  const graphRequestRef = useRef(0);
  const [commitDiffPath, setCommitDiffPath] = useState<string | null>(null);
  const [commitDiffText, setCommitDiffText] = useState<string | null>(null);
  const [commitDiffLoading, setCommitDiffLoading] = useState(false);
  const [commitDiffError, setCommitDiffError] = useState<string | null>(null);
  const graphRevRef = useRef<string | null>(null);
  const graphSimplifyRef = useRef(false);
  // 图谱刷新的判定依据用 ref 保存：刷新回调因此不依赖 graph/graphHasMore，
  // 定时器与窗口聚焦订阅不会因为一次翻页而反复重建。
  const graphRef = useRef<WorkspaceGitGraphLine[] | null>(null);
  const graphHasMoreRef = useRef(true);
  const graphStaleRef = useRef(false);
  const graphVisibleRef = useRef(false);
  const refSignatureRef = useRef<string | null>(null);
  const refreshStateRef = useRef<GitGraphRefreshState>(INITIAL_GIT_GRAPH_REFRESH_STATE);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  useEffect(() => {
    graphHasMoreRef.current = graphHasMore;
  }, [graphHasMore]);
  const commitDiffRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const isRepo = Boolean(workspace && status?.isRepository);
  const groups = useMemo(() => groupGitFiles(status?.files ?? []), [status]);
  const totalChanges = useMemo(
    () => (status ? status.files.length : 0),
    [status],
  );

  const reloadStatus = useCallback(async () => {
    if (!workspace) {
      setStatus(null);
      return null;
    }
    setLoadingStatus(true);
    try {
      const next = await getWorkspaceGitStatus(workspace);
      setStatus(next);
      return next;
    } catch (error) {
      setStatus(null);
      onError(t("git.error.readStatus", locale, { error: errorText(error, locale) }));
      return null;
    } finally {
      setLoadingStatus(false);
    }
  }, [workspace, onError, locale]);

  const reloadCommits = useCallback(async () => {
    if (!workspace) {
      setCommits(null);
      return;
    }
    setCommitsLoading(true);
    try {
      setCommits(await listGitLog(workspace));
    } catch (error) {
      setCommits(null);
      onError(t("git.error.readHistory", locale, { error: errorText(error, locale) }));
    } finally {
      setCommitsLoading(false);
    }
  }, [workspace, onError]);

  const reloadBranches = useCallback(async () => {
    if (!workspace) {
      setBranches(null);
      return null;
    }
    setBranchesLoading(true);
    try {
      const next = await listGitBranches(workspace);
      setBranches(next);
      return next;
    } catch (error) {
      setBranches(null);
      onError(t("git.error.readBranches", locale, { error: errorText(error, locale) }));
      return null;
    } finally {
      setBranchesLoading(false);
    }
  }, [workspace, onError, locale]);

  // 图谱取数：`keepWindow` 为真时按「已加载窗口」取数，并把新提交接到既有行前面，
  // 因此刷新不会把用户翻出来的历史与滚动位置丢掉；重写历史时自动退化为整页替换。
  const fetchGraph = useCallback(async (options: { keepWindow: boolean }) => {
    if (!workspace) {
      setGraph(null);
      setGraphHasMore(true);
      return;
    }
    const request = ++graphRequestRef.current;
    const previous = graphRef.current ?? [];
    const previousHasMore = graphHasMoreRef.current;
    const limit = options.keepWindow && previous.length > 0
      ? gitGraphRefreshLimit(previous.length)
      : GIT_GRAPH_PAGE_SIZE;
    setGraphLoading(true);
    try {
      const fresh = await listGitGraph(workspace, limit, graphRevRef.current, graphSimplifyRef.current, 0);
      if (request !== graphRequestRef.current) return;
      const merged = mergeRefreshedRows({ fresh, previous, limit, previousHasMore });
      setGraph(merged.rows);
      setGraphHasMore(merged.hasMore);
      graphStaleRef.current = false;
      setGraphStale(false);
    } catch (error) {
      if (request !== graphRequestRef.current) return;
      // 刷新失败时保留已经取到的行：旧的提交图比空白更有用
      if (previous.length === 0) {
        setGraph(null);
        setGraphHasMore(true);
      }
      onError(t("git.error.readGraph", locale, { error: errorText(error, locale) }));
    } finally {
      if (request === graphRequestRef.current) setGraphLoading(false);
    }
  }, [workspace, onError, locale]);

  // 图谱请求入口：同一时刻只跑一个，期间到来的刷新合并成一次尾随刷新——
  // 15 秒轮询、窗口聚焦与每次 git 操作都会触发刷新，合并后不会并发跑多条 git log。
  const requestGraph = useCallback((options: { keepWindow: boolean }) => {
    const begun = beginRefresh(refreshStateRef.current);
    refreshStateRef.current = begun.state;
    if (!begun.run) return;
    void (async () => {
      // settleRefresh 说明还有合并进来的刷新时，名额仍在本循环手上，直接再跑一次；
      // 重新走入口会被自己合并掉，所以这里用循环而不是递归。
      for (;;) {
        try {
          await fetchGraph(options);
        } finally {
          const settled = settleRefresh(refreshStateRef.current);
          refreshStateRef.current = settled.state;
          if (!settled.run) break;
        }
      }
    })();
  }, [fetchGraph]);

  // 拉取下一页更早的提交并拼接到已有数据。后端只返回提交行，所以已加载条数就是
  // `git log --skip=N` 的 N；翻页期间若发生过刷新，本页结果直接丢弃。
  const loadMoreGraph = useCallback(async () => {
    if (!workspace) return;
    if (graphLoading || graphLoadingMore || !graphHasMoreRef.current) return;
    const loaded = graphRef.current ?? [];
    if (loaded.length === 0) return;
    const request = graphRequestRef.current;
    setGraphLoadingMore(true);
    try {
      const lines = await listGitGraph(workspace, GIT_GRAPH_PAGE_SIZE, graphRevRef.current, graphSimplifyRef.current, loaded.length);
      if (request !== graphRequestRef.current) return;
      setGraph((prev) => [...(prev ?? []), ...lines]);
      setGraphHasMore(gitGraphHasMore(lines.length, GIT_GRAPH_PAGE_SIZE));
    } catch (error) {
      if (request !== graphRequestRef.current) return;
      onError(t("git.error.readGraph", locale, { error: errorText(error, locale) }));
    } finally {
      if (request === graphRequestRef.current) setGraphLoadingMore(false);
    }
  }, [workspace, graphLoading, graphLoadingMore, onError, locale]);

  // 统一刷新入口：状态/历史/分支每次都刷，图谱只在 refs 真的变了（或用户手动刷新）
  // 且视图可见时重取；不可见时只标记过期，进入图谱视图再补取。
  const refreshAll = useCallback(async (options: { force?: boolean } = {}) => {
    const [nextStatus, , nextBranches] = await Promise.all([reloadStatus(), reloadCommits(), reloadBranches()]);
    const signature = gitRefSignature(nextStatus, nextBranches);
    const refsChanged = signature !== refSignatureRef.current;
    refSignatureRef.current = signature;
    const decision = decideGitGraphRefresh({
      visible: graphVisibleRef.current,
      hasData: graphRef.current !== null,
      stale: graphStaleRef.current,
      refsChanged,
      forced: options.force === true,
    });
    if (decision.reload) requestGraph({ keepWindow: graphRef.current !== null });
    if (decision.markStale && !graphStaleRef.current) {
      graphStaleRef.current = true;
      setGraphStale(true);
    }
  }, [reloadStatus, reloadCommits, reloadBranches, requestGraph]);

  useEffect(() => {
    setTab("changes");
    setSelectedPath(null);
    setDiffText(null);
    setDiffError(null);
    setCommitDetail(null);
    setDiscardTarget(null);
    setBranchDialog(null);
    setResult(null);
    // 换工作区时先清空图谱相关状态，避免把上一个仓库的行当成可拼接的旧窗口
    graphRef.current = null;
    graphHasMoreRef.current = true;
    graphStaleRef.current = false;
    refSignatureRef.current = null;
    refreshStateRef.current = INITIAL_GIT_GRAPH_REFRESH_STATE;
    setGraph(null);
    setGraphHasMore(true);
    setGraphStale(false);
    void refreshAll();
  }, [workspace, refreshAll]);

  useEffect(() => {
    if (collapsed) {
      setSelectedPath(null);
      setDiffText(null);
      setDiffError(null);
      setDiscardTarget(null);
      setBranchDialog(null);
      setCommitOpen(false);
    }
  }, [collapsed]);

  // 读取所选文件的差异（工作区/暂存区切换时重新加载）。
  useEffect(() => {
    if (!selectedPath || !isRepo) {
      setDiffText(null);
      setDiffError(null);
      return;
    }
    const request = ++diffRequestRef.current;
    setDiffLoading(true);
    setDiffError(null);
    let active = true;
    void getGitFileDiff(workspace, selectedPath, diffStaged)
      .then((text) => {
        if (!active || request !== diffRequestRef.current) return;
        setDiffText(text);
      })
      .catch((error) => {
        if (!active || request !== diffRequestRef.current) return;
        setDiffText(null);
        setDiffError(errorText(error));
      })
      .finally(() => {
        if (active && request === diffRequestRef.current) setDiffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedPath, diffStaged, workspace, isRepo]);

  // 仅在进入对应标签页时懒加载历史/分支。
  useEffect(() => {
    if (tab === "history" && commits === null) void reloadCommits();
  }, [tab, commits, reloadCommits]);

  useEffect(() => {
    if (tab === "branches" && branches === null) void reloadBranches();
  }, [tab, branches, reloadBranches]);

  // 图谱视图可见时才取数：不可见期间发生的 refs 变化只记账，进入视图时补取。
  useEffect(() => {
    const visible = tab === "history" && historyView === "graph";
    graphVisibleRef.current = visible;
    if (!visible) return;
    if (graphRef.current === null || graphStaleRef.current) {
      graphStaleRef.current = false;
      setGraphStale(false);
      requestGraph({ keepWindow: graphRef.current !== null });
    }
  }, [tab, historyView, graphStale, requestGraph]);

  // 图谱分支过滤需要分支列表；进入图谱视图时若尚未加载则补齐。
  useEffect(() => {
    if (tab === "history" && historyView === "graph" && branches === null) void reloadBranches();
  }, [tab, historyView, branches, reloadBranches]);

  // 实时性：外层 git 操作可能改变仓库状态。展开时每 15 秒轮询刷新一次，
  // 避免重复请求（用 ref 防重入）。图谱只在 refs 变化时才会跟着重取。
  const refreshingRef = useRef(false);
  useEffect(() => {
    if (collapsed || !workspace) return;
    const timer = window.setInterval(() => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      void refreshAll().finally(() => {
        refreshingRef.current = false;
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [collapsed, workspace, refreshAll]);

  // 窗口重新聚焦时立即刷新（切回应用后马上看到最新状态）。
  useEffect(() => {
    if (collapsed || !workspace || !isTauri()) return;
    const cleanups: Array<() => void> = [];
    let disposed = false;
    trackAsyncCleanup(cleanups, getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (disposed || !focused) return;
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        void refreshAll().finally(() => {
          refreshingRef.current = false;
        });
      }), () => disposed);
    return () => {
      disposed = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, [collapsed, workspace, refreshAll]);

  function changeGraphRev(rev: string) {
    const next = rev || null;
    graphRevRef.current = next;
    setGraphRev(next);
    // 过滤条件变化必须从第一页重取，不能沿用旧窗口
    requestGraph({ keepWindow: false });
  }

  function toggleGraphSimplify(enabled: boolean) {
    graphSimplifyRef.current = enabled;
    setGraphSimplify(enabled);
    requestGraph({ keepWindow: false });
  }

  // 读取已选提交里指定文件的差异。
  useEffect(() => {
    if (!commitDiffPath || !commitDetail) {
      setCommitDiffText(null);
      setCommitDiffError(null);
      return;
    }
    const request = ++commitDiffRequestRef.current;
    setCommitDiffLoading(true);
    setCommitDiffError(null);
    let active = true;
    void getGitCommitFileDiff(workspace, commitDetail.hash, commitDiffPath)
      .then((text) => {
        if (!active || request !== commitDiffRequestRef.current) return;
        setCommitDiffText(text);
      })
      .catch((error) => {
        if (!active || request !== commitDiffRequestRef.current) return;
        setCommitDiffText(null);
        setCommitDiffError(errorText(error));
      })
      .finally(() => {
        if (active && request === commitDiffRequestRef.current) setCommitDiffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [commitDiffPath, commitDetail, workspace]);

  async function runMutation(action: () => Promise<void>, reason: string) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError(t("git.error.runFailed", locale, { reason, error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function handleStage(file: WorkspaceGitFile) {
    await runMutation(() => stageGitPaths(workspace, [file.path]), t("git.stage", locale));
  }

  async function handleUnstage(file: WorkspaceGitFile) {
    await runMutation(() => unstageGitPaths(workspace, [file.path]), t("git.unstage", locale));
  }

  async function handleStageAll() {
    await runMutation(() => stageAllGit(workspace), t("git.stageAll", locale));
  }

  async function handleUnstageAll() {
    await runMutation(() => unstageAllGit(workspace), t("git.unstageAll", locale));
  }

  async function confirmDiscard() {
    const target = discardTarget;
    setDiscardTarget(null);
    if (!target) return;
    await runMutation(() => discardGitPaths(workspace, [target.path]), t("git.discard", locale));
    setSelectedPath((current) => (current === target.path ? null : current));
  }

  async function submitCommit() {
    const message = commitMessage.trim();
    if (!message) return;
    setCommitOpen(false);
    setBusy(true);
    try {
      if (commitStageAll) await stageAllGit(workspace);
      setResult(await commitGit(workspace, message));
    } catch (error) {
      onError(t("git.error.commitFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setCommitMessage("");
      setCommitStageAll(false);
      setBusy(false);
      await refreshAll();
    }
  }

  async function handlePull() {
    setBusy(true);
    try {
      setResult(await pullGit(workspace));
    } catch (error) {
      onError(t("git.error.pullFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function handlePush() {
    setBusy(true);
    try {
      setResult(await pushGit(workspace));
    } catch (error) {
      onError(t("git.error.pushFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function submitBranchCreate() {
    if (!branchDialog || branchDialog.mode !== "create") return;
    const name = branchDialog.value.trim();
    setBranchDialog(null);
    if (!name) return;
    setBusy(true);
    try {
      setResult(await createGitBranch(workspace, name));
    } catch (error) {
      onError(t("git.error.branchCreateFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function submitBranchDelete() {
    if (!branchDialog || branchDialog.mode !== "delete") return;
    const branch = branchDialog.branch;
    setBranchDialog(null);
    setBusy(true);
    try {
      setResult(await deleteGitBranch(workspace, branch.name));
    } catch (error) {
      onError(t("git.error.branchDeleteFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function handleCheckout(branch: WorkspaceGitBranch) {
    setBusy(true);
    try {
      setResult(await checkoutGitBranch(workspace, branch.name));
    } catch (error) {
      onError(t("git.error.checkoutFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function handleCopyHash(hash: string) {
    setCopyingHash(hash);
    try {
      await writeClipboard(hash);
    } catch (error) {
      onError(t("git.error.copyHashFailed", locale, { error: errorText(error, locale) }));
    } finally {
      window.setTimeout(() => setCopyingHash(null), 1200);
    }
  }

  function selectCommitByHash(hash: string) {
    if (commitDetail?.hash === hash) return;
    setCommitDetail(null);
    setCommitDetailLoading(true);
    setCommitDiffPath(null);
    setCommitDiffText(null);
    setCommitDiffError(null);
    const request = ++detailRequestRef.current;
    void getGitCommitDetail(workspace, hash)
      .then((detail) => {
        if (request === detailRequestRef.current) setCommitDetail(detail);
      })
      .catch((error) => onError(t("git.error.readDetailFailed", locale, { error: errorText(error, locale) })))
      .finally(() => {
        if (request === detailRequestRef.current) setCommitDetailLoading(false);
      });
  }

  function selectFileAndDiff(file: WorkspaceGitFile) {
    setSelectedPath(file.path);
    setDiffStaged(false);
  }

  const branchGroups = useMemo(() => groupGitBranches(branches ?? []), [branches]);

  const dialogChildren = branchDialog?.mode === "create"
    ? (
      <div className="git-dialog-field">
        <input
          value={branchDialog.value}
          onChange={(event) => setBranchDialog({ mode: "create", value: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter") void submitBranchCreate(); }}
          placeholder={t("git.branchPlaceholder", locale)}
          autoFocus
          aria-label={t("git.branchNameAria", locale)}
        />
        <p className="git-dialog-hint">{t("git.branchCreateHint", locale)}</p>
      </div>
    )
    : null;

  return (
    <DockFrame
      id="git-dock"
      side="left"
      className="git-dock-panel"
      collapsed={collapsed}
      label={GIT_RAIL_LABEL}
      locale={locale}
      title="Git"
      kicker={t("git.kicker", locale)}
       icon={<GitBranch />}
      total={t("git.totalChanges", locale, { count: totalChanges })}
       toggleGlyph={<ChevronLeft />}
      onToggle={onToggle}
      railClassName="git-dock-rail"
      railMarkClassName="git-dock-rail-mark"
      headerMarkClassName="git-dock-mark"
      cardClassName="git-dock-card"
      headerClassName="git-dock-header"
      headingClassName="git-dock-heading"
      kickerClassName="git-dock-kicker"
      headerActionsClassName="git-dock-header-actions"
      totalClassName="git-dock-total"
      toggleClassName="git-dock-toggle"
      bodyClassName="git-dock-body"
    >
      <div className="git-summary">
        {loadingStatus ? (
          <span className="git-summary-loading">{t("git.syncing", locale)}</span>
        ) : isRepo && status?.branch ? (
          <>
            <span className="git-summary-branch" title={status.branch}>⌘ {status.branch}</span>
            {status.upstream && (
              <span className="git-summary-upstream" title={status.upstream}>
                {status.ahead > 0 && <span className="git-summary-ahead">↑{status.ahead}</span>}
                {status.behind > 0 && <span className="git-summary-behind">↓{status.behind}</span>}
                <span className="git-summary-upstream-name">{status.upstream}</span>
              </span>
            )}
          </>
        ) : (
          <span className="git-summary-no-repo">{t("git.noRepo", locale)}</span>
        )}
      </div>
      <div className="git-toolbar">
        <button type="button" disabled={!isRepo || busy} onClick={() => void handlePull()} title={t("git.pullTitle", locale)} aria-label={t("git.pull", locale)}>↓ {t("git.pull", locale)}</button>
        <button type="button" disabled={!isRepo || busy} onClick={() => void handlePush()} title={t("git.pushTitle", locale)} aria-label={t("git.push", locale)}>↑ {t("git.push", locale)}</button>
        <button type="button" disabled={!workspace || busy} onClick={() => void refreshAll({ force: true })} title={t("git.refresh", locale)} aria-label={t("git.refresh", locale)}><RefreshCw aria-hidden="true" /></button>
        {isRepo && (
          <span className="git-toolbar-counts">
            <span className="git-count git-count-staged">{t("git.countStaged", locale, { count: status?.staged ?? 0 })}</span>
            <span className="git-count git-count-changed">{t("git.countChanged", locale, { count: status?.changed ?? 0 })}</span>
            <span className="git-count git-count-untracked">{t("git.countUntracked", locale, { count: status?.untracked ?? 0 })}</span>
            {(status?.conflicted ?? 0) > 0 && <span className="git-count git-count-conflicted">{t("git.countConflicted", locale, { count: status?.conflicted ?? 0 })}</span>}
          </span>
        )}
      </div>

      {!workspace ? (
        <div className="git-empty">{t("git.emptyWorkspace", locale)}</div>
      ) : (
        <>
          <div className="git-tabs" role="tablist" aria-label={t("git.tabsAria", locale)}>
            {(["changes", "history", "branches"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? "selected" : ""}
                onClick={() => setTab(item)}
              >
                {item === "changes" ? t("git.tabChanges", locale) : item === "history" ? t("git.tabHistory", locale) : t("git.tabBranches", locale)}
              </button>
            ))}
          </div>

          {result && (
            <div className={`git-result ${result.ok ? "ok" : "fail"}`} role="status">
              <pre>{result.text || (result.ok ? t("git.resultOk", locale) : t("git.resultFailed", locale))}</pre>
              <button type="button" className="git-result-dismiss" aria-label={t("common.close", locale)} onClick={() => setResult(null)}><X aria-hidden="true" /></button>
            </div>
          )}

          {tab === "changes" && (
            <div className="git-changes">
              <div className="git-changes-toolbar">
                <button type="button" disabled={!isRepo || busy} onClick={() => void handleStageAll()}>{t("git.stageAll", locale)}</button>
                <button type="button" disabled={!isRepo || busy} onClick={() => void handleUnstageAll()}>{t("git.unstageAll", locale)}</button>
                <button type="button" className="confirm" disabled={!isRepo || busy} onClick={() => { setCommitOpen(true); setCommitMessage(""); }}>{t("git.commitEllipsis", locale)}</button>
              </div>

              {!isRepo ? (
                <div className="git-empty">{t("git.emptyNoRepo", locale)}</div>
              ) : (
                <div className="git-changes-scroll">
                  {totalChanges === 0 && !loadingStatus ? (
                    <div className="git-empty">{t("git.emptyClean", locale)}</div>
                  ) : (
                    <>
                      {groups.conflicted.length > 0 && (
                        <section className="git-group git-group-conflicted">
                          <h4>{t("git.groupConflicted", locale, { count: groups.conflicted.length })}</h4>
                          {groups.conflicted.map((file) => (
                            <ChangeRow
                              key={`c${file.path}`}
                              file={file}
                              selected={selectedPath === file.path}
                              busy={busy}
                              onSelect={() => selectFileAndDiff(file)}
                              onStage={() => void handleStage(file)}
                              onUnstage={() => void handleUnstage(file)}
                              onDiscard={() => setDiscardTarget(file)}
                              locale={locale}
                            />
                          ))}
                        </section>
                      )}
                      {groups.staged.length > 0 && (
                        <section className="git-group git-group-staged">
                          <h4>{t("git.groupStaged", locale, { count: groups.staged.length })}</h4>
                          {groups.staged.map((file) => (
                            <ChangeRow
                              key={`s${file.path}`}
                              file={file}
                              selected={selectedPath === file.path}
                              busy={busy}
                              onSelect={() => selectFileAndDiff(file)}
                              onStage={() => void handleStage(file)}
                              onUnstage={() => void handleUnstage(file)}
                              onDiscard={() => setDiscardTarget(file)}
                              locale={locale}
                            />
                          ))}
                        </section>
                      )}
                      {groups.unstaged.length > 0 && (
                        <section className="git-group git-group-unstaged">
                          <h4>{t("git.groupUnstaged", locale, { count: groups.unstaged.length })}</h4>
                          {groups.unstaged.map((file) => (
                            <ChangeRow
                              key={`u${file.path}`}
                              file={file}
                              selected={selectedPath === file.path}
                              busy={busy}
                              onSelect={() => selectFileAndDiff(file)}
                              onStage={() => void handleStage(file)}
                              onUnstage={() => void handleUnstage(file)}
                              onDiscard={() => setDiscardTarget(file)}
                              locale={locale}
                            />
                          ))}
                        </section>
                      )}
                      {groups.untracked.length > 0 && (
                        <section className="git-group git-group-untracked">
                          <h4>{t("git.groupUntracked", locale, { count: groups.untracked.length })}</h4>
                          {groups.untracked.map((file) => (
                            <ChangeRow
                              key={`n${file.path}`}
                              file={file}
                              selected={selectedPath === file.path}
                              busy={busy}
                              onSelect={() => selectFileAndDiff(file)}
                              onStage={() => void handleStage(file)}
                              onUnstage={() => void handleUnstage(file)}
                              onDiscard={() => setDiscardTarget(file)}
                              locale={locale}
                            />
                          ))}
                        </section>
                      )}
                    </>
                  )}
                </div>
              )}

              {selectedPath && (
                <div className="git-diff-panel">
                  <div className="git-diff-header">
                    <span className="git-diff-path" title={selectedPath}>{selectedPath}</span>
                    <div className="git-diff-mode" role="group" aria-label={t("git.diffSourceAria", locale)}>
                      <button type="button" className={!diffStaged ? "selected" : ""} onClick={() => setDiffStaged(false)}>{t("git.diffWorktree", locale)}</button>
                      <button type="button" className={diffStaged ? "selected" : ""} onClick={() => setDiffStaged(true)}>{t("git.diffStaged", locale)}</button>
                    </div>
                    <button type="button" className="git-diff-close" aria-label={t("git.closeDiff", locale)} onClick={() => setSelectedPath(null)}><X aria-hidden="true" /></button>
                  </div>
                  {diffLoading ? (
                    <div className="git-diff-empty">{t("git.loadingDiff", locale)}</div>
                  ) : diffError ? (
                    <div className="git-diff-empty">{diffError}</div>
                  ) : diffText && diffText.trim() ? (
                    <div className="git-diff-body">
                      {diffText.split("\n").map((line, index) => (
                        <div key={index} className={`git-diff-line git-diff-line-${diffLineKind(line)}`}>{line || "\u00a0"}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="git-diff-empty">{t("git.emptyDiff", locale)}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="git-history">
              <div className="git-history-view-toggle" role="group" aria-label={t("git.historyAria", locale)}>
                <button type="button" className={historyView === "list" ? "selected" : ""} onClick={() => setHistoryView("list")}>{t("git.viewList", locale)}</button>
                <button type="button" className={historyView === "graph" ? "selected" : ""} onClick={() => setHistoryView("graph")}>{t("git.viewGraph", locale)}</button>
              </div>
              {historyView === "graph" ? (
                <>
                  <div className="git-graph-options">
                    <select value={graphRev ?? ""} onChange={(event) => changeGraphRev(event.target.value)} disabled={busy} aria-label={t("git.filterBranchAria", locale)}>
                      <option value="">{t("git.allBranches", locale)}</option>
                      {(branches ?? []).map((branch) => (
                        <option key={branch.name} value={branch.name}>{branch.name}</option>
                      ))}
                    </select>
                    <label className="git-graph-simplify" title={t("git.simplifyTitle", locale)}>
                      <input type="checkbox" checked={graphSimplify} onChange={(event) => toggleGraphSimplify(event.target.checked)} disabled={busy} />
                      <span>{t("git.simplifyLabel", locale)}</span>
                    </label>
                  </div>
                  {graphLoading && graph === null ? (
                  <div className="git-empty">{t("git.loadingGraph", locale)}</div>
                ) : !graph || graph.length === 0 ? (
                  <div className="git-empty">{t("git.emptyCommits", locale)}</div>
                ) : (
                  <GitTreeGraph
                    lines={graph}
                    selectedHash={commitDetail?.hash ?? null}
                    onSelect={selectCommitByHash}
                    onLoadMore={loadMoreGraph}
                    hasMore={graphHasMore}
                    loadingMore={graphLoadingMore}
                    locale={locale}
                  />
                  )}
                </>
              ) : commitsLoading && commits === null ? (
                <div className="git-empty">{t("git.loadingHistory", locale)}</div>
              ) : !commits || commits.length === 0 ? (
                <div className="git-empty">{t("git.emptyCommits", locale)}</div>
              ) : (
                <div className="git-history-list">
                  {commits.map((commit) => (
                    <button
                      key={commit.hash}
                      type="button"
                      className={`git-commit-row ${commitDetail?.hash === commit.hash ? "selected" : ""}`}
                      onClick={() => selectCommitByHash(commit.hash)}
                      title={commit.subject}
                    >
                      <span className="git-commit-short">{commit.shortHash}</span>
                      <span className="git-commit-main">
                        <span className="git-commit-subject">{commit.subject}</span>
                        <span className="git-commit-meta">{commit.author} · {formatRelativeTime(commit.timestamp, undefined, locale)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {commitDetailLoading && <div className="git-empty">{t("git.loadingDetail", locale)}</div>}
              {commitDetail && !commitDetailLoading && (
                <div className="git-commit-detail">
                  <div className="git-commit-detail-header">
                    <span className="git-commit-short">{commitDetail.hash.slice(0, 7)}</span>
                    <span className="git-commit-subject">{commitDetail.subject}</span>
                    <button type="button" className="git-diff-close" aria-label={t("git.closeDetail", locale)} onClick={() => { setCommitDetail(null); setCommitDiffPath(null); }}><X aria-hidden="true" /></button>
                  </div>
                  <div className="git-commit-detail-meta">
                    <span>{commitDetail.author}</span>
                    <span>{formatRelativeTime(commitDetail.timestamp, undefined, locale)}</span>
                    <span>{t("git.fileCount", locale, { count: commitDetail.files.length })}</span>
                  </div>
                  {commitDetail.body && <pre className="git-commit-detail-body">{commitDetail.body}</pre>}
                  <div className="git-commit-detail-files">
                    {commitDetail.files.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={`git-commit-file-row ${commitDiffPath === file.path ? "active" : ""}`}
                        onClick={() => setCommitDiffPath((current) => (current === file.path ? null : file.path))}
                        title={t("git.viewFileDiff", locale, { path: file.path })}
                      >
                        <span className="git-commit-file-path" title={file.path}>{file.path}</span>
                        <span className="git-commit-file-stats">
                          {file.additions > 0 && <span className="git-stat-add">+{file.additions}</span>}
                          {file.deletions > 0 && <span className="git-stat-del">−{file.deletions}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                  {commitDiffPath && (
                    <div className="git-commit-diff">
                      <div className="git-diff-header">
                        <span className="git-diff-path" title={commitDiffPath}>{commitDiffPath}</span>
                        <button type="button" className="git-diff-close" aria-label={t("git.closeFileDiff", locale)} onClick={() => setCommitDiffPath(null)}><X aria-hidden="true" /></button>
                      </div>
                      {commitDiffLoading ? (
                        <div className="git-diff-empty">{t("git.loadingDiff", locale)}</div>
                      ) : commitDiffError ? (
                        <div className="git-diff-empty">{commitDiffError}</div>
                      ) : commitDiffText && commitDiffText.trim() ? (
                        <div className="git-diff-body">
                          {commitDiffText.split("\n").map((line, index) => (
                            <div key={index} className={`git-diff-line git-diff-line-${diffLineKind(line)}`}>{line || "\u00a0"}</div>
                          ))}
                        </div>
                      ) : (
                        <div className="git-diff-empty">{t("git.emptyDiff", locale)}</div>
                      )}
                    </div>
                  )}
                  <div className="git-commit-detail-actions">
                    <button type="button" disabled={copyingHash === commitDetail.hash} onClick={() => void handleCopyHash(commitDetail.hash)}>
                      {copyingHash === commitDetail.hash ? t("git.copied", locale) : t("git.copyHash", locale)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "branches" && (
            <div className="git-branches">
              <div className="git-branches-toolbar">
                <button type="button" disabled={!isRepo || busy} onClick={() => setBranchDialog({ mode: "create", value: "" })}><Plus aria-hidden="true" /> {t("git.newBranch", locale)}</button>
              </div>
              {branchesLoading && branches === null ? (
                <div className="git-empty">{t("git.loadingBranches", locale)}</div>
              ) : !branches || branches.length === 0 ? (
                <div className="git-empty">{t("git.emptyBranches", locale)}</div>
              ) : (
                <div className="git-branches-scroll">
                  <section className="git-group git-group-local">
                    <h4>{t("git.localBranches", locale)}</h4>
                    {branchGroups.local.map((branch) => (
                      <div key={branch.name} className={`git-branch-row ${branch.isCurrent ? "current" : ""}`}>
                        <span className="git-branch-name" title={branch.name}>
                          {branch.isCurrent && <span className="git-branch-current-mark" aria-hidden="true"><Check /></span>}
                          <span className={branch.isCurrent ? "git-branch-current" : ""}>{branch.name}</span>
                          {branch.upstream && <span className="git-branch-upstream">→ {branch.upstream}</span>}
                        </span>
                        <div className="git-branch-actions">
                          {!branch.isCurrent && (
                            <button type="button" disabled={busy} title={t("git.checkoutTitle", locale)} aria-label={t("git.checkoutBranch", locale, { name: branch.name })} onClick={() => void handleCheckout(branch)}>{t("git.checkout", locale)}</button>
                          )}
                          {!branch.isCurrent && (
                            <button type="button" className="danger" disabled={busy} title={t("git.deleteBranchTitle", locale)} aria-label={t("git.deleteBranch", locale, { name: branch.name })} onClick={() => setBranchDialog({ mode: "delete", branch })}>{t("common.delete", locale)}</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </section>
                  {branchGroups.remote.length > 0 && (
                    <section className="git-group git-group-remote">
                      <h4>{t("git.remoteBranches", locale)}</h4>
                      {branchGroups.remote.map((branch) => (
                        <div key={branch.name} className={`git-branch-row ${branch.isCurrent ? "current" : ""}`}>
                          <span className="git-branch-name" title={branch.name}>
                            <span className="git-branch-remote-name">{branch.name}</span>
                          </span>
                          <span className="git-branch-oid" title={branch.shortOid}>{branch.shortOid.slice(0, 7)}</span>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {commitOpen && (
        <PopupDialog
          title={t("git.commitTitle", locale)}
          eyebrow="GIT / 提交"
          locale={locale}
          description={t("git.commitDescription", locale, { count: status?.staged ?? 0, branch: status?.branch ?? t("git.currentBranch", locale) })}
          className="popup-git-commit"
          onClose={() => setCommitOpen(false)}
          footer={<>
            <button type="button" onClick={() => setCommitOpen(false)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm" disabled={!commitMessage.trim() || busy} onClick={() => void submitCommit()}>{t("git.commitAction", locale)}</button>
          </>}
        >
          <textarea
            className="git-commit-message"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (commitMessage.trim() && !busy) void submitCommit();
              }
            }}
            placeholder={t("git.commitPlaceholder", locale)}
            rows={4}
            autoFocus
            aria-label={t("git.commitPlaceholder", locale)}
          />
          <label className="git-commit-stage-all">
            <input type="checkbox" checked={commitStageAll} onChange={(event) => setCommitStageAll(event.target.checked)} />
            <span>{t("git.commitStageAll", locale)}</span>
          </label>
        </PopupDialog>
      )}

      {discardTarget && (
        <PopupDialog
          title={t("git.discardTitle", locale)}
          eyebrow="GIT / 放弃"
          locale={locale}
          description={discardTarget.status === "untracked"
            ? t("git.discardUntracked", locale, { path: discardTarget.path })
            : t("git.discardTracked", locale, { path: discardTarget.path })}
          className="popup-git-discard"
          role="alertdialog"
          onClose={() => setDiscardTarget(null)}
          footer={<>
            <button type="button" onClick={() => setDiscardTarget(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm danger-button" disabled={busy} onClick={() => void confirmDiscard()}>{t("git.discardAction", locale)}</button>
          </>}
        >
          <p className="popup-warning-copy">{t("git.discardWarning", locale)}</p>
        </PopupDialog>
      )}

      {branchDialog?.mode === "create" && (
        <PopupDialog
          title={t("git.branchCreateTitle", locale)}
          eyebrow="GIT / 分支"
          locale={locale}
          description={t("git.branchCreateDescription", locale)}
          className="popup-git-branch-create"
          onClose={() => setBranchDialog(null)}
          footer={<>
            <button type="button" onClick={() => setBranchDialog(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm" disabled={!branchDialog.value.trim() || busy} onClick={() => void submitBranchCreate()}>{t("git.createAndSwitch", locale)}</button>
          </>}
        >
          {dialogChildren}
        </PopupDialog>
      )}

      {branchDialog?.mode === "delete" && (
        <PopupDialog
          title={t("git.branchDeleteTitle", locale)}
          eyebrow="GIT / 分支"
          locale={locale}
          description={t("git.branchDeleteDescription", locale, { name: branchDialog.branch.name })}
          className="popup-git-branch-delete"
          role="alertdialog"
          onClose={() => setBranchDialog(null)}
          footer={<>
            <button type="button" onClick={() => setBranchDialog(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm danger-button" disabled={busy} onClick={() => void submitBranchDelete()}>{t("common.delete", locale)}</button>
          </>}
        >
          <p className="popup-warning-copy">{t("git.branchDeleteWarning", locale)}</p>
        </PopupDialog>
      )}
    </DockFrame>
  );
}
