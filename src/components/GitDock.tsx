import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, GitBranch, Minus, Plus, RefreshCw, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  amendGitCommit,
  applyGitStash,
  cherryPickGitCommit,
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  createGitTag,
  deleteGitBranch,
  deleteGitTag,
  discardGitPaths,
  dropGitStash,
  fetchGit,
  getGitFileDiff,
  getWorkspaceGitStatus,
  isTauri,
  listGitBranches,
  listGitGraph,
  listGitLog,
  listGitStashes,
  listGitTags,
  pullGit,
  pushGit,
  pushGitStash,
  renameGitBranch,
  resetGitTo,
  revertGitCommit,
  stageAllGit,
  stageGitPaths,
  undoLastGitCommit,
  unstageAllGit,
  unstageGitPaths,
  writeClipboard,
  type GitCommandResult,
  type WorkspaceGitBranch,
  type WorkspaceGitCommit,
  type WorkspaceGitFile,
  type WorkspaceGitGraphLine,
  type WorkspaceGitStash,
  type WorkspaceGitStatus,
  type WorkspaceGitTag,
} from "../lib/desktop";
import { errorText } from "../app/model";
import { dockTabKey } from "../app/dock-layout";
import { useDockSettings } from "../app/dock-settings";
import {
  canStageFile,
  canUnstageFile,
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
import { GitCommitDetailView } from "./GitCommitDetailView";
import { GitDiffBody } from "./GitDiffBody";
import { t, type UiLocale } from "../app/i18n";
import { trackAsyncCleanup } from "../lib/async-cleanup";

type GitDockTab = "changes" | "history" | "branches" | "stash";

/** 破坏性操作的确认目标：确认后由 `runConfirmAction` 统一执行。 */
type GitConfirmTarget =
  | { kind: "reset-hard"; hash: string; shortHash: string }
  | { kind: "tag-delete"; name: string }
  | { kind: "stash-drop"; reference: string };

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
  const { openTab } = useDockSettings();
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
  // 只保存"选中的提交哈希"：提交详情与逐文件差异由 GitCommitDetailView 自己加载
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [branches, setBranches] = useState<WorkspaceGitBranch[] | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitStageAll, setCommitStageAll] = useState(false);
  const [commitAmend, setCommitAmend] = useState(false);
  const [discardTarget, setDiscardTarget] = useState<WorkspaceGitFile | null>(null);
  const [branchDialog, setBranchDialog] = useState<
    | { mode: "create"; value: string; from: string | null }
    | { mode: "rename"; branch: WorkspaceGitBranch; value: string }
    | { mode: "delete"; branch: WorkspaceGitBranch }
    | null
  >(null);
  const [tagDialog, setTagDialog] = useState<{ value: string; message: string; hash: string | null } | null>(null);
  const [stashDialog, setStashDialog] = useState<{ message: string; includeUntracked: boolean } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<GitConfirmTarget | null>(null);
  const [tags, setTags] = useState<WorkspaceGitTag[] | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [stashes, setStashes] = useState<WorkspaceGitStash[] | null>(null);
  const [stashesLoading, setStashesLoading] = useState(false);
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
  const diffRequestRef = useRef(0);

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

  const reloadTags = useCallback(async () => {
    if (!workspace) {
      setTags(null);
      return;
    }
    setTagsLoading(true);
    try {
      setTags(await listGitTags(workspace));
    } catch (error) {
      setTags(null);
      onError(t("git.error.readTags", locale, { error: errorText(error, locale) }));
    } finally {
      setTagsLoading(false);
    }
  }, [workspace, onError, locale]);

  const reloadStashes = useCallback(async () => {
    if (!workspace) {
      setStashes(null);
      return;
    }
    setStashesLoading(true);
    try {
      setStashes(await listGitStashes(workspace));
    } catch (error) {
      setStashes(null);
      onError(t("git.error.stashListFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setStashesLoading(false);
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
    const [nextStatus, , nextBranches] = await Promise.all([
      reloadStatus(),
      reloadCommits(),
      reloadBranches(),
      reloadTags(),
      reloadStashes(),
    ]);
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
  }, [reloadStatus, reloadCommits, reloadBranches, reloadTags, reloadStashes, requestGraph]);

  useEffect(() => {
    setTab("changes");
    setSelectedPath(null);
    setDiffText(null);
    setDiffError(null);
    setSelectedCommitHash(null);
    setDiscardTarget(null);
    setBranchDialog(null);
    setTagDialog(null);
    setConfirmTarget(null);
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
      setTagDialog(null);
      setConfirmTarget(null);
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

  // 窗口重新聚焦时刷新（切回应用后马上看到最新状态）。连续聚焦只跑最后一次，
  // 对应 VS Code 把 status 推迟到窗口聚焦、并用 debounce 合并后台变化的做法。
  useEffect(() => {
    if (collapsed || !workspace || !isTauri()) return;
    const cleanups: Array<() => void> = [];
    let disposed = false;
    let timer = 0;
    trackAsyncCleanup(cleanups, getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (disposed || !focused) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (refreshingRef.current) return;
          refreshingRef.current = true;
          void refreshAll().finally(() => {
            refreshingRef.current = false;
          });
        }, 250);
      }), () => disposed);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
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

  async function runMutation(action: () => Promise<void | GitCommandResult>, reason: string) {
    setBusy(true);
    try {
      const outcome = await action();
      // 拣选/回退/重置会把 git 输出回传：冲突时用户要看得到原因
      if (outcome) setResult(outcome);
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
    const amend = commitAmend;
    // 修正上次提交时允许留空：空信息表示沿用原提交信息
    if (!message && !amend) return;
    setCommitOpen(false);
    setBusy(true);
    try {
      if (commitStageAll) await stageAllGit(workspace);
      setResult(amend
        ? await amendGitCommit(workspace, message || null)
        : await commitGit(workspace, message));
    } catch (error) {
      onError(t(amend ? "git.error.amendFailed" : "git.error.commitFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setCommitMessage("");
      setCommitStageAll(false);
      setCommitAmend(false);
      setBusy(false);
      await refreshAll();
    }
  }

  /** 破坏性操作统一入口：只有经过确认弹窗才会调用。 */
  async function runConfirmAction() {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (!target) return;
    if (target.kind === "reset-hard") {
      await runMutation(() => resetGitTo(workspace, target.hash, "hard"), t("git.resetHard", locale));
      return;
    }
    if (target.kind === "tag-delete") {
      await runMutation(() => deleteGitTag(workspace, target.name), t("git.tagDelete", locale));
      return;
    }
    await runMutation(() => dropGitStash(workspace, target.reference), t("git.stashDrop", locale));
  }

  async function submitStashCreate() {
    if (!stashDialog) return;
    const message = stashDialog.message.trim();
    const includeUntracked = stashDialog.includeUntracked;
    setStashDialog(null);
    await runMutation(
      () => pushGitStash(workspace, message || null, includeUntracked),
      t("git.stashCreate", locale),
    );
    setTab("stash");
  }

  async function handleStashApply(stash: WorkspaceGitStash, drop: boolean) {
    await runMutation(
      () => applyGitStash(workspace, stash.reference, drop),
      t(drop ? "git.stashPop" : "git.stashApply", locale),
    );
  }

  async function submitBranchRename() {
    if (!branchDialog || branchDialog.mode !== "rename") return;
    const from = branchDialog.branch.name;
    const to = branchDialog.value.trim();
    setBranchDialog(null);
    if (!to || to === from) return;
    setBusy(true);
    try {
      setResult(await renameGitBranch(workspace, from, to));
    } catch (error) {
      onError(t("git.error.renameFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function submitTagCreate() {
    if (!tagDialog) return;
    const name = tagDialog.value.trim();
    const message = tagDialog.message.trim();
    const hash = tagDialog.hash;
    setTagDialog(null);
    if (!name) return;
    setBusy(true);
    try {
      setResult(await createGitTag(workspace, name, hash, message || null));
    } catch (error) {
      onError(t("git.error.tagCreateFailed", locale, { error: errorText(error, locale) }));
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function handleFetch() {
    setBusy(true);
    try {
      setResult(await fetchGit(workspace, true));
    } catch (error) {
      onError(t("git.error.fetchFailed", locale, { error: errorText(error, locale) }));
    } finally {
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
      setResult(await createGitBranch(workspace, name, branchDialog.from));
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

  // 选中即展开：提交详情由 GitCommitDetailView 自己加载，这里只记录选中项。
  function selectCommitByHash(hash: string) {
    setSelectedCommitHash((current) => (current === hash ? null : hash));
  }

  /**
   * 在右栏开一个提交详情标签：与「图谱/历史」面板并排对照。
   * 按 `commit:<hash>` 去重，重复打开同一个提交是复用并激活。
   */
  function openCommitTab(detail: { hash: string; subject: string; author: string }) {
    openTab({
      kind: "git-commit",
      title: detail.subject || detail.hash.slice(0, 7),
      detail: detail.hash.slice(0, 7),
      contentKey: `commit:${detail.hash}`,
      payload: { cwd: workspace, hash: detail.hash },
    });
  }

  /** 在右栏开一个文件差异标签：与变更列表/图谱并排对照。 */
  function openDiffTab(path: string, staged: boolean) {
    openTab({
      kind: "git-diff",
      title: path.split("/").pop() || path,
      detail: staged ? t("git.diffStaged", locale) : t("git.diffWorktree", locale),
      contentKey: `diff:${path}:${staged ? "staged" : "worktree"}`,
      payload: { cwd: workspace, path, staged: staged ? "1" : "0" },
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
          onChange={(event) => setBranchDialog({ mode: "create", value: event.target.value, from: branchDialog.from })}
          onKeyDown={(event) => { if (event.key === "Enter") void submitBranchCreate(); }}
          placeholder={t("git.branchPlaceholder", locale)}
          autoFocus
          aria-label={t("git.branchNameAria", locale)}
        />
        <label className="git-dialog-select">
          <span>{t("git.branchFromLabel", locale)}</span>
          <select
            value={branchDialog.from ?? ""}
            onChange={(event) => setBranchDialog({ mode: "create", value: branchDialog.value, from: event.target.value || null })}
            aria-label={t("git.branchFromLabel", locale)}
          >
            <option value="">{t("git.branchFromCurrent", locale)}</option>
            {(branches ?? []).map((branch) => (
              <option key={branch.name} value={branch.name}>{branch.name}</option>
            ))}
            {(tags ?? []).map((tag) => (
              <option key={`tag:${tag.name}`} value={tag.name}>tag: {tag.name}</option>
            ))}
          </select>
        </label>
        <p className="git-dialog-hint">
          {branchDialog.from
            ? t("git.branchCreateFromHint", locale, { from: branchDialog.from })
            : t("git.branchCreateHint", locale)}
        </p>
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
        <button type="button" disabled={!isRepo || busy} onClick={() => void handleFetch()} title={t("git.fetchTitle", locale)} aria-label={t("git.fetch", locale)}>↺ {t("git.fetch", locale)}</button>
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
            {(["changes", "history", "branches", "stash"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? "selected" : ""}
                onClick={() => setTab(item)}
              >
                {item === "changes" ? t("git.tabChanges", locale)
                  : item === "history" ? t("git.tabHistory", locale)
                  : item === "branches" ? t("git.tabBranches", locale)
                  : t("git.tabStash", locale)}
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
                <button type="button" className="confirm" disabled={!isRepo || busy} onClick={() => { setCommitOpen(true); setCommitMessage(""); setCommitAmend(false); }}>{t("git.commitEllipsis", locale)}</button>
                <button type="button" disabled={!isRepo || busy} title={t("git.undoLastCommitTitle", locale)} onClick={() => void runMutation(() => undoLastGitCommit(workspace), t("git.undoLastCommit", locale))}>{t("git.undoLastCommit", locale)}</button>
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
                    <button type="button" className="git-diff-open-in-rail" title={t("git.openInDockTitle", locale)} onClick={() => openDiffTab(selectedPath, diffStaged)}>{t("git.openInDock", locale)}</button>
                    <button type="button" className="git-diff-close" aria-label={t("git.closeDiff", locale)} onClick={() => setSelectedPath(null)}><X aria-hidden="true" /></button>
                  </div>
                  {diffLoading ? (
                    <div className="git-diff-empty">{t("git.loadingDiff", locale)}</div>
                  ) : diffError ? (
                    <div className="git-diff-empty">{diffError}</div>
                  ) : (
                    <GitDiffBody text={diffText} locale={locale} />
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
                    selectedHash={selectedCommitHash}
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
                      className={`git-commit-row ${selectedCommitHash === commit.hash ? "selected" : ""}`}
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
              {selectedCommitHash && (
                <GitCommitDetailView
                  workspace={workspace}
                  hash={selectedCommitHash}
                  locale={locale}
                  onError={onError}
                  renderHeader={(detail) => (
                    <div className="git-commit-detail-header">
                      <span className="git-commit-short">{detail.hash.slice(0, 7)}</span>
                      <span className="git-commit-subject">{detail.subject}</span>
                      <button type="button" className="git-diff-close" aria-label={t("git.closeDetail", locale)} onClick={() => setSelectedCommitHash(null)}><X aria-hidden="true" /></button>
                    </div>
                  )}
                  renderActions={(detail) => (
                    <>
                      <button type="button" disabled={copyingHash === detail.hash} onClick={() => void handleCopyHash(detail.hash)}>
                        {copyingHash === detail.hash ? t("git.copied", locale) : t("git.copyHash", locale)}
                      </button>
                      <button type="button" disabled={busy} title={t("git.tagCreateTitle", locale)} onClick={() => setTagDialog({ value: "", message: "", hash: detail.hash })}>{t("git.tagCreate", locale)}</button>
                      <button type="button" disabled={busy} title={t("git.branchFromCommitTitle", locale)} onClick={() => setBranchDialog({ mode: "create", value: "", from: detail.hash })}>{t("git.branchFromCommit", locale)}</button>
                      <button type="button" disabled={busy} title={t("git.openInDockTitle", locale)} onClick={() => openCommitTab(detail)}>{t("git.openInDock", locale)}</button>
                      <button type="button" disabled={busy} title={t("git.cherryPickTitle", locale)} onClick={() => void runMutation(() => cherryPickGitCommit(workspace, detail.hash, "start"), t("git.cherryPick", locale))}>{t("git.cherryPick", locale)}</button>
                      <button type="button" disabled={busy} title={t("git.revertTitle", locale)} onClick={() => void runMutation(() => revertGitCommit(workspace, detail.hash), t("git.revert", locale))}>{t("git.revert", locale)}</button>
                      <button type="button" disabled={busy} title={t("git.resetSoftTitle", locale)} onClick={() => void runMutation(() => resetGitTo(workspace, detail.hash, "soft"), t("git.resetSoft", locale))}>{t("git.resetSoft", locale)}</button>
                      <button type="button" className="danger" disabled={busy} title={t("git.resetHardTitle", locale)} onClick={() => setConfirmTarget({ kind: "reset-hard", hash: detail.hash, shortHash: detail.hash.slice(0, 7) })}>{t("git.resetHard", locale)}</button>
                    </>
                  )}
                />
              )}
            </div>
          )}

          {tab === "branches" && (
            <div className="git-branches">
              <div className="git-branches-toolbar">
                <button type="button" disabled={!isRepo || busy} onClick={() => setBranchDialog({ mode: "create", value: "", from: null })}><Plus aria-hidden="true" /> {t("git.newBranch", locale)}</button>
                <button type="button" disabled={!isRepo || busy} onClick={() => setTagDialog({ value: "", message: "", hash: null })}>{t("git.tagCreate", locale)}</button>
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
                          <button type="button" disabled={busy} title={t("git.renameBranchTitle", locale)} aria-label={t("git.renameBranchAria", locale, { name: branch.name })} onClick={() => setBranchDialog({ mode: "rename", branch, value: branch.name })}>{t("git.renameBranch", locale)}</button>
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
                  {tagsLoading && tags === null ? (
                    <div className="git-empty">{t("git.loadingTags", locale)}</div>
                  ) : tags && tags.length > 0 && (
                    <section className="git-group git-group-tags">
                      <h4>{t("git.tags", locale)}</h4>
                      {tags.map((tag) => (
                        <div key={tag.name} className="git-branch-row">
                          <span className="git-branch-name" title={`${tag.name} → ${tag.target}`}>
                            <span className="git-tag-name">{tag.name}</span>
                            <span className="git-branch-oid" title={tag.target}>{tag.target.slice(0, 7)}</span>
                          </span>
                          <div className="git-branch-actions">
                            <button type="button" className="danger" disabled={busy} title={t("git.tagDeleteTitle", locale)} aria-label={t("git.tagDeleteAria", locale, { name: tag.name })} onClick={() => setConfirmTarget({ kind: "tag-delete", name: tag.name })}>{t("common.delete", locale)}</button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "stash" && (
            <div className="git-branches">
              <div className="git-branches-toolbar">
                <button type="button" disabled={!isRepo || busy} onClick={() => setStashDialog({ message: "", includeUntracked: false })}><Plus aria-hidden="true" /> {t("git.stashCreate", locale)}</button>
                <button type="button" disabled={!isRepo || busy} onClick={() => void reloadStashes()}>{t("common.refresh", locale)}</button>
              </div>
              {stashesLoading && stashes === null ? (
                <div className="git-empty">{t("git.loadingStashes", locale)}</div>
              ) : !stashes || stashes.length === 0 ? (
                <div className="git-empty">{t("git.stashEmpty", locale)}</div>
              ) : (
                <div className="git-branches-scroll">
                  {stashes.map((stash) => (
                    <div key={stash.reference} className="git-branch-row">
                      <span className="git-branch-name" title={stash.subject}>
                        <span className="git-stash-ref">{stash.reference}</span>
                        <span className="git-stash-subject">{stash.subject}</span>
                        {stash.timestamp > 0 && <span className="git-branch-oid">{formatRelativeTime(stash.timestamp, undefined, locale)}</span>}
                      </span>
                      <div className="git-branch-actions">
                        <button type="button" disabled={busy} title={t("git.stashApplyTitle", locale)} onClick={() => void handleStashApply(stash, false)}>{t("git.stashApply", locale)}</button>
                        <button type="button" disabled={busy} title={t("git.stashPopTitle", locale)} onClick={() => void handleStashApply(stash, true)}>{t("git.stashPop", locale)}</button>
                        <button type="button" className="danger" disabled={busy} title={t("git.stashDropTitle", locale)} aria-label={t("git.stashDropAria", locale, { reference: stash.reference })} onClick={() => setConfirmTarget({ kind: "stash-drop", reference: stash.reference })}>{t("common.delete", locale)}</button>
                      </div>
                    </div>
                  ))}
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
          <label className="git-commit-stage-all" title={t("git.amendTitle", locale)}>
            <input type="checkbox" checked={commitAmend} onChange={(event) => setCommitAmend(event.target.checked)} />
            <span>{t("git.amend", locale)}</span>
          </label>
        </PopupDialog>
      )}

      {tagDialog && (
        <PopupDialog
          title={t("git.tagCreateTitle", locale)}
          eyebrow="GIT / 标签"
          locale={locale}
          description={tagDialog.hash
            ? t("git.tagCreateAtDescription", locale, { hash: tagDialog.hash.slice(0, 7) })
            : t("git.tagCreateDescription", locale)}
          className="popup-git-tag-create"
          onClose={() => setTagDialog(null)}
          footer={<>
            <button type="button" onClick={() => setTagDialog(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm" disabled={!tagDialog.value.trim() || busy} onClick={() => void submitTagCreate()}>{t("git.tagCreateAction", locale)}</button>
          </>}
        >
          <div className="git-dialog-field">
            <input
              value={tagDialog.value}
              onChange={(event) => setTagDialog({ ...tagDialog, value: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Enter") void submitTagCreate(); }}
              placeholder={t("git.tagNamePlaceholder", locale)}
              autoFocus
              aria-label={t("git.tagNamePlaceholder", locale)}
            />
            <input
              value={tagDialog.message}
              onChange={(event) => setTagDialog({ ...tagDialog, message: event.target.value })}
              placeholder={t("git.tagMessagePlaceholder", locale)}
              aria-label={t("git.tagMessagePlaceholder", locale)}
            />
            <p className="git-dialog-hint">{t("git.tagCreateHint", locale)}</p>
          </div>
        </PopupDialog>
      )}

      {confirmTarget?.kind === "reset-hard" && (
        <PopupDialog
          title={t("git.resetHardTitle", locale)}
          eyebrow="GIT / 重置"
          locale={locale}
          description={t("git.resetHardDescription", locale, { hash: confirmTarget.shortHash })}
          className="popup-git-reset-hard"
          role="alertdialog"
          onClose={() => setConfirmTarget(null)}
          footer={<>
            <button type="button" onClick={() => setConfirmTarget(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm danger-button" disabled={busy} onClick={() => void runConfirmAction()}>{t("git.resetHardAction", locale)}</button>
          </>}
        >
          <p className="popup-warning-copy">{t("git.resetHardWarning", locale)}</p>
        </PopupDialog>
      )}

      {branchDialog?.mode === "rename" && (
        <PopupDialog
          title={t("git.renameBranchTitle", locale)}
          eyebrow="GIT / 分支"
          locale={locale}
          description={t("git.renameBranchDescription", locale, { name: branchDialog.branch.name })}
          className="popup-git-branch-rename"
          onClose={() => setBranchDialog(null)}
          footer={<>
            <button type="button" onClick={() => setBranchDialog(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm" disabled={!branchDialog.value.trim() || busy} onClick={() => void submitBranchRename()}>{t("git.renameBranchAction", locale)}</button>
          </>}
        >
          <div className="git-dialog-field">
            <input
              value={branchDialog.value}
              onChange={(event) => setBranchDialog({ mode: "rename", branch: branchDialog.branch, value: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Enter") void submitBranchRename(); }}
              placeholder={t("git.renameBranchPlaceholder", locale)}
              autoFocus
              aria-label={t("git.renameBranchAria", locale, { name: branchDialog.branch.name })}
            />
          </div>
        </PopupDialog>
      )}

      {stashDialog && (
        <PopupDialog
          title={t("git.stashCreateTitle", locale)}
          eyebrow="GIT / 储藏"
          locale={locale}
          description={t("git.stashCreateDescription", locale)}
          className="popup-git-stash-create"
          onClose={() => setStashDialog(null)}
          footer={<>
            <button type="button" onClick={() => setStashDialog(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm" disabled={busy} onClick={() => void submitStashCreate()}>{t("git.stashCreateAction", locale)}</button>
          </>}
        >
          <div className="git-dialog-field">
            <input
              value={stashDialog.message}
              onChange={(event) => setStashDialog({ ...stashDialog, message: event.target.value })}
              onKeyDown={(event) => { if (event.key === "Enter") void submitStashCreate(); }}
              placeholder={t("git.stashMessagePlaceholder", locale)}
              autoFocus
              aria-label={t("git.stashMessagePlaceholder", locale)}
            />
            <label className="git-commit-stage-all">
              <input
                type="checkbox"
                checked={stashDialog.includeUntracked}
                onChange={(event) => setStashDialog({ ...stashDialog, includeUntracked: event.target.checked })}
              />
              <span>{t("git.stashIncludeUntracked", locale)}</span>
            </label>
          </div>
        </PopupDialog>
      )}

      {confirmTarget?.kind === "tag-delete" && (
        <PopupDialog
          title={t("git.tagDeleteTitle", locale)}
          eyebrow="GIT / 标签"
          locale={locale}
          description={t("git.tagDeleteDescription", locale, { name: confirmTarget.name })}
          className="popup-git-tag-delete"
          role="alertdialog"
          onClose={() => setConfirmTarget(null)}
          footer={<>
            <button type="button" onClick={() => setConfirmTarget(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm danger-button" disabled={busy} onClick={() => void runConfirmAction()}>{t("common.delete", locale)}</button>
          </>}
        >
          <p className="popup-warning-copy">{t("git.tagDeleteWarning", locale)}</p>
        </PopupDialog>
      )}

      {confirmTarget?.kind === "stash-drop" && (
        <PopupDialog
          title={t("git.stashDropTitle", locale)}
          eyebrow="GIT / 储藏"
          locale={locale}
          description={t("git.stashDropDescription", locale, { reference: confirmTarget.reference })}
          className="popup-git-stash-drop"
          role="alertdialog"
          onClose={() => setConfirmTarget(null)}
          footer={<>
            <button type="button" onClick={() => setConfirmTarget(null)}>{t("common.cancel", locale)}</button>
            <button type="button" className="confirm danger-button" disabled={busy} onClick={() => void runConfirmAction()}>{t("common.delete", locale)}</button>
          </>}
        >
          <p className="popup-warning-copy">{t("git.stashDropWarning", locale)}</p>
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
