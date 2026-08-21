import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  deleteGitBranch,
  discardGitPaths,
  getGitCommitDetail,
  getGitFileDiff,
  getWorkspaceGitStatus,
  listGitBranches,
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
import { DockFrame } from "./DockFrame";
import { PopupDialog } from "./PopupDialog";

type GitDockTab = "changes" | "history" | "branches";

type GitDockProps = {
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
}: {
  file: WorkspaceGitFile;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className={`git-change-row ${selected ? "selected" : ""}`}>
      <button className="git-change-main" type="button" onClick={onSelect} title={file.path}>
        <span className={`git-change-mark git-mark-${file.status}`} aria-hidden="true">{gitFileMark(file)}</span>
        <span className="git-change-path">{file.path}</span>
      </button>
      <div className="git-change-actions">
        {canStageFile(file) && (
          <button type="button" className="git-change-action" title="暂存" aria-label={`暂存 ${file.path}`} disabled={busy} onClick={onStage}>＋</button>
        )}
        {canUnstageFile(file) && (
          <button type="button" className="git-change-action" title="取消暂存" aria-label={`取消暂存 ${file.path}`} disabled={busy} onClick={onUnstage}>−</button>
        )}
        <button type="button" className="git-change-action danger" title="放弃改动" aria-label={`放弃改动 ${file.path}`} disabled={busy} onClick={onDiscard}>✕</button>
      </div>
    </div>
  );
}

export function GitDock({ workspace, collapsed, onToggle, onError }: GitDockProps) {
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
      return;
    }
    setLoadingStatus(true);
    try {
      setStatus(await getWorkspaceGitStatus(workspace));
    } catch (error) {
      setStatus(null);
      onError(`读取 Git 状态失败：${errorText(error)}`);
    } finally {
      setLoadingStatus(false);
    }
  }, [workspace, onError]);

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
      onError(`读取提交历史失败：${errorText(error)}`);
    } finally {
      setCommitsLoading(false);
    }
  }, [workspace, onError]);

  const reloadBranches = useCallback(async () => {
    if (!workspace) {
      setBranches(null);
      return;
    }
    setBranchesLoading(true);
    try {
      setBranches(await listGitBranches(workspace));
    } catch (error) {
      setBranches(null);
      onError(`读取分支失败：${errorText(error)}`);
    } finally {
      setBranchesLoading(false);
    }
  }, [workspace, onError]);

  const refreshAll = useCallback(async () => {
    await Promise.all([reloadStatus(), reloadCommits(), reloadBranches()]);
  }, [reloadStatus, reloadCommits, reloadBranches]);

  useEffect(() => {
    setTab("changes");
    setSelectedPath(null);
    setDiffText(null);
    setDiffError(null);
    setCommitDetail(null);
    setDiscardTarget(null);
    setBranchDialog(null);
    setResult(null);
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

  async function runMutation(action: () => Promise<void>, reason: string) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError(`${reason}失败：${errorText(error)}`);
    } finally {
      setBusy(false);
      await refreshAll();
    }
  }

  async function handleStage(file: WorkspaceGitFile) {
    await runMutation(() => stageGitPaths(workspace, [file.path]), "暂存");
  }

  async function handleUnstage(file: WorkspaceGitFile) {
    await runMutation(() => unstageGitPaths(workspace, [file.path]), "取消暂存");
  }

  async function handleStageAll() {
    await runMutation(() => stageAllGit(workspace), "全部暂存");
  }

  async function handleUnstageAll() {
    await runMutation(() => unstageAllGit(workspace), "取消全部暂存");
  }

  async function confirmDiscard() {
    const target = discardTarget;
    setDiscardTarget(null);
    if (!target) return;
    await runMutation(() => discardGitPaths(workspace, [target.path]), "放弃改动");
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
      onError(`提交失败：${errorText(error)}`);
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
      onError(`拉取失败：${errorText(error)}`);
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
      onError(`推送失败：${errorText(error)}`);
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
      onError(`新建分支失败：${errorText(error)}`);
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
      onError(`删除分支失败：${errorText(error)}`);
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
      onError(`切换分支失败：${errorText(error)}`);
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
      onError(`复制提交哈希失败：${errorText(error)}`);
    } finally {
      window.setTimeout(() => setCopyingHash(null), 1200);
    }
  }

  function selectCommit(commit: WorkspaceGitCommit) {
    if (commitDetail?.hash === commit.hash) return;
    setCommitDetail(null);
    setCommitDetailLoading(true);
    const request = ++detailRequestRef.current;
    void getGitCommitDetail(workspace, commit.hash)
      .then((detail) => {
        if (request === detailRequestRef.current) setCommitDetail(detail);
      })
      .catch((error) => onError(`读取提交详情失败：${errorText(error)}`))
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
          placeholder="基于当前分支新建"
          autoFocus
          aria-label="新分支名称"
        />
        <p className="git-dialog-hint">将基于当前分支创建并自动切换到新分支。</p>
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
      title="Git"
      kicker="源码管理"
      icon="⑂"
      total={totalChanges}
      toggleGlyph="‹"
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
          <span className="git-summary-loading">同步中…</span>
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
          <span className="git-summary-no-repo">未选择工作区或未检测到 Git 仓库</span>
        )}
      </div>
      <div className="git-toolbar">
        <button type="button" disabled={!isRepo || busy} onClick={() => void handlePull()} title="拉取当前分支上游" aria-label="拉取">↓ 拉取</button>
        <button type="button" disabled={!isRepo || busy} onClick={() => void handlePush()} title="推送当前分支" aria-label="推送">↑ 推送</button>
        <button type="button" disabled={!workspace || busy} onClick={() => void refreshAll()} title="刷新" aria-label="刷新">⟳</button>
        {isRepo && (
          <span className="git-toolbar-counts">
            <span className="git-count git-count-staged">{status?.staged ?? 0} 暂存</span>
            <span className="git-count git-count-changed">{status?.changed ?? 0} 修改</span>
            <span className="git-count git-count-untracked">{status?.untracked ?? 0} 未跟踪</span>
            {(status?.conflicted ?? 0) > 0 && <span className="git-count git-count-conflicted">{status?.conflicted} 冲突</span>}
          </span>
        )}
      </div>

      {!workspace ? (
        <div className="git-empty">选择工作区后显示 Git 状态</div>
      ) : (
        <>
          <div className="git-tabs" role="tablist" aria-label="Git 视图">
            {(["changes", "history", "branches"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                className={tab === item ? "selected" : ""}
                onClick={() => setTab(item)}
              >
                {item === "changes" ? "更改" : item === "history" ? "历史" : "分支"}
              </button>
            ))}
          </div>

          {result && (
            <div className={`git-result ${result.ok ? "ok" : "fail"}`} role="status">
              <pre>{result.text || (result.ok ? "操作完成" : "操作未完成")}</pre>
              <button type="button" className="git-result-dismiss" aria-label="关闭结果" onClick={() => setResult(null)}>×</button>
            </div>
          )}

          {tab === "changes" && (
            <div className="git-changes">
              <div className="git-changes-toolbar">
                <button type="button" disabled={!isRepo || busy} onClick={() => void handleStageAll()}>全部暂存</button>
                <button type="button" disabled={!isRepo || busy} onClick={() => void handleUnstageAll()}>取消全部暂存</button>
                <button type="button" className="confirm" disabled={!isRepo || busy} onClick={() => { setCommitOpen(true); setCommitMessage(""); }}>提交…</button>
              </div>

              {!isRepo ? (
                <div className="git-empty">未检测到 Git 仓库</div>
              ) : (
                <div className="git-changes-scroll">
                  {totalChanges === 0 && !loadingStatus ? (
                    <div className="git-empty">工作区干净，没有待处理更改</div>
                  ) : (
                    <>
                      {groups.conflicted.length > 0 && (
                        <section className="git-group git-group-conflicted">
                          <h4>冲突 · {groups.conflicted.length}</h4>
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
                            />
                          ))}
                        </section>
                      )}
                      {groups.staged.length > 0 && (
                        <section className="git-group git-group-staged">
                          <h4>暂存区 · {groups.staged.length}</h4>
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
                            />
                          ))}
                        </section>
                      )}
                      {groups.unstaged.length > 0 && (
                        <section className="git-group git-group-unstaged">
                          <h4>工作区 · {groups.unstaged.length}</h4>
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
                            />
                          ))}
                        </section>
                      )}
                      {groups.untracked.length > 0 && (
                        <section className="git-group git-group-untracked">
                          <h4>未跟踪 · {groups.untracked.length}</h4>
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
                    <div className="git-diff-mode" role="group" aria-label="差异来源">
                      <button type="button" className={!diffStaged ? "selected" : ""} onClick={() => setDiffStaged(false)}>工作区</button>
                      <button type="button" className={diffStaged ? "selected" : ""} onClick={() => setDiffStaged(true)}>暂存区</button>
                    </div>
                    <button type="button" className="git-diff-close" aria-label="关闭差异" onClick={() => setSelectedPath(null)}>×</button>
                  </div>
                  {diffLoading ? (
                    <div className="git-diff-empty">加载差异…</div>
                  ) : diffError ? (
                    <div className="git-diff-empty">{diffError}</div>
                  ) : diffText && diffText.trim() ? (
                    <div className="git-diff-body">
                      {diffText.split("\n").map((line, index) => (
                        <div key={index} className={`git-diff-line git-diff-line-${diffLineKind(line)}`}>{line || "\u00a0"}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="git-diff-empty">该文件没有可显示的差异</div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="git-history">
              {commitsLoading && commits === null ? (
                <div className="git-empty">加载提交历史…</div>
              ) : !commits || commits.length === 0 ? (
                <div className="git-empty">暂无提交记录</div>
              ) : (
                <>
                  <div className="git-history-list">
                    {commits.map((commit) => (
                      <button
                        key={commit.hash}
                        type="button"
                        className={`git-commit-row ${commitDetail?.hash === commit.hash ? "selected" : ""}`}
                        onClick={() => selectCommit(commit)}
                        title={commit.subject}
                      >
                        <span className="git-commit-short">{commit.shortHash}</span>
                        <span className="git-commit-main">
                          <span className="git-commit-subject">{commit.subject}</span>
                          <span className="git-commit-meta">{commit.author} · {formatRelativeTime(commit.timestamp)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {commitDetailLoading && <div className="git-empty">加载提交详情…</div>}
                  {commitDetail && !commitDetailLoading && (
                    <div className="git-commit-detail">
                      <div className="git-commit-detail-header">
                        <span className="git-commit-short">{commitDetail.hash.slice(0, 7)}</span>
                        <span className="git-commit-subject">{commitDetail.subject}</span>
                        <button type="button" className="git-diff-close" aria-label="关闭提交详情" onClick={() => setCommitDetail(null)}>×</button>
                      </div>
                      <div className="git-commit-detail-meta">
                        <span>{commitDetail.author}</span>
                        <span>{formatRelativeTime(commitDetail.timestamp)}</span>
                        <span>{commitDetail.files.length} 个文件</span>
                      </div>
                      {commitDetail.body && <pre className="git-commit-detail-body">{commitDetail.body}</pre>}
                      <div className="git-commit-detail-files">
                        {commitDetail.files.map((file) => (
                          <div key={file.path} className="git-commit-file-row">
                            <span className="git-commit-file-path" title={file.path}>{file.path}</span>
                            <span className="git-commit-file-stats">
                              {file.additions > 0 && <span className="git-stat-add">+{file.additions}</span>}
                              {file.deletions > 0 && <span className="git-stat-del">−{file.deletions}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="git-commit-detail-actions">
                        <button type="button" disabled={copyingHash === commitDetail.hash} onClick={() => void handleCopyHash(commitDetail.hash)}>
                          {copyingHash === commitDetail.hash ? "已复制" : "复制哈希"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "branches" && (
            <div className="git-branches">
              <div className="git-branches-toolbar">
                <button type="button" disabled={!isRepo || busy} onClick={() => setBranchDialog({ mode: "create", value: "" })}>＋ 新建分支</button>
              </div>
              {branchesLoading && branches === null ? (
                <div className="git-empty">加载分支…</div>
              ) : !branches || branches.length === 0 ? (
                <div className="git-empty">暂无分支</div>
              ) : (
                <div className="git-branches-scroll">
                  <section className="git-group git-group-local">
                    <h4>本地分支</h4>
                    {branchGroups.local.map((branch) => (
                      <div key={branch.name} className={`git-branch-row ${branch.isCurrent ? "current" : ""}`}>
                        <span className="git-branch-name" title={branch.name}>
                          {branch.isCurrent && <span className="git-branch-current-mark">✓</span>}
                          <span className={branch.isCurrent ? "git-branch-current" : ""}>{branch.name}</span>
                          {branch.upstream && <span className="git-branch-upstream">→ {branch.upstream}</span>}
                        </span>
                        <div className="git-branch-actions">
                          {!branch.isCurrent && (
                            <button type="button" disabled={busy} title="切换到该分支" aria-label={`切换到 ${branch.name}`} onClick={() => void handleCheckout(branch)}>切换</button>
                          )}
                          {!branch.isCurrent && (
                            <button type="button" className="danger" disabled={busy} title="删除分支" aria-label={`删除 ${branch.name}`} onClick={() => setBranchDialog({ mode: "delete", branch })}>删除</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </section>
                  {branchGroups.remote.length > 0 && (
                    <section className="git-group git-group-remote">
                      <h4>远程分支</h4>
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
          title="提交更改"
          eyebrow="GIT / 提交"
          description={`提交 ${status?.staged ?? 0} 个已暂存更改到 ${status?.branch ?? "当前分支"}。`}
          className="popup-git-commit"
          onClose={() => setCommitOpen(false)}
          footer={<>
            <button type="button" onClick={() => setCommitOpen(false)}>取消</button>
            <button type="button" className="confirm" disabled={!commitMessage.trim() || busy} onClick={() => void submitCommit()}>提交</button>
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
            placeholder="提交信息"
            rows={4}
            autoFocus
            aria-label="提交信息"
          />
          <label className="git-commit-stage-all">
            <input type="checkbox" checked={commitStageAll} onChange={(event) => setCommitStageAll(event.target.checked)} />
            <span>提交前暂存所有更改</span>
          </label>
        </PopupDialog>
      )}

      {discardTarget && (
        <PopupDialog
          title="放弃改动"
          eyebrow="GIT / 放弃"
          description={discardTarget.status === "untracked"
            ? `未跟踪文件“${discardTarget.path}”将被删除，无法恢复。`
            : `“${discardTarget.path}”的暂存与工作区改动将被还原，无法恢复。`}
          className="popup-git-discard"
          role="alertdialog"
          onClose={() => setDiscardTarget(null)}
          footer={<>
            <button type="button" onClick={() => setDiscardTarget(null)}>取消</button>
            <button type="button" className="confirm danger-button" disabled={busy} onClick={() => void confirmDiscard()}>放弃</button>
          </>}
        >
          <p className="popup-warning-copy">此操作不可撤销，请确认。</p>
        </PopupDialog>
      )}

      {branchDialog?.mode === "create" && (
        <PopupDialog
          title="新建分支"
          eyebrow="GIT / 分支"
          description="基于当前分支创建并切换到新分支。"
          className="popup-git-branch-create"
          onClose={() => setBranchDialog(null)}
          footer={<>
            <button type="button" onClick={() => setBranchDialog(null)}>取消</button>
            <button type="button" className="confirm" disabled={!branchDialog.value.trim() || busy} onClick={() => void submitBranchCreate()}>创建并切换</button>
          </>}
        >
          {dialogChildren}
        </PopupDialog>
      )}

      {branchDialog?.mode === "delete" && (
        <PopupDialog
          title="删除分支"
          eyebrow="GIT / 分支"
          description={`本地分支“${branchDialog.branch.name}”将被强制删除，无法恢复。`}
          className="popup-git-branch-delete"
          role="alertdialog"
          onClose={() => setBranchDialog(null)}
          footer={<>
            <button type="button" onClick={() => setBranchDialog(null)}>取消</button>
            <button type="button" className="confirm danger-button" disabled={busy} onClick={() => void submitBranchDelete()}>删除</button>
          </>}
        >
          <p className="popup-warning-copy">该分支未合并的提交也会一并删除，请确认。</p>
        </PopupDialog>
      )}
    </DockFrame>
  );
}
