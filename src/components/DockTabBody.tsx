import type { ReactNode } from "react";
import { DockedFileView } from "./DockedFileView";
import { DockedGitCommitFile } from "./DockedGitCommitFile";
import { DockedGitDiff } from "./DockedGitDiff";
import { DockedGitRange } from "./DockedGitRange";
import { GitCommitDetailView } from "./GitCommitDetailView";
import { GitMergeConflictView } from "./GitMergeConflictView";
import { t, type UiLocale } from "../app/i18n";
import { dockTabBodyState, dockTabWorkspace, type DockTab } from "../app/dock-layout";

/**
 * 停靠标签正文的分发点。
 *
 * 内容类型是数据（`DockTab.kind`），这里只负责登记渲染器：新增一种标签
 * 只需要在 `DOCK_TAB_RENDERERS` 里加一项，布局模型与持久化都不用改。
 * `DockFrame` 类面板的正文由面板自己挂进宿主，因此不在这里登记。
 */
export type DockTabBodyProps = {
  tab: DockTab;
  /** 当前会话/工作区根目录：解析相对路径，并判断标签是否属于别的工作区。 */
  workspace: string;
  locale?: UiLocale;
  onError: (message: string) => void;
};

type DockTabRenderer = (props: DockTabBodyProps) => ReactNode;

const DOCK_TAB_RENDERERS: Record<string, DockTabRenderer> = {
  file: ({ tab, workspace, locale, onError }) => (tab.path ? (
    <DockedFileView
      key={tab.id}
      path={tab.path}
      line={tab.line}
      cwd={workspace}
      locale={locale}
      onError={onError}
    />
  ) : null),
  "git-commit": ({ tab, locale, onError }) => {
    const hash = tab.payload?.hash;
    if (!hash) return null;
    return <GitCommitDetailView workspace={tab.payload?.cwd ?? ""} hash={hash} locale={locale} onError={onError} />;
  },
  "git-commit-file": ({ tab, locale, onError }) => {
    const hash = tab.payload?.hash;
    const path = tab.payload?.path;
    const cwd = tab.payload?.cwd;
    if (!hash || !path || !cwd) return null;
    return <DockedGitCommitFile cwd={cwd} hash={hash} path={path} locale={locale} onError={onError} />;
  },
  "git-diff": ({ tab, locale, onError }) => {
    const path = tab.payload?.path;
    const cwd = tab.payload?.cwd;
    if (!path || !cwd) return null;
    return (
      <DockedGitDiff
        cwd={cwd}
        path={path}
        staged={tab.payload?.staged === "1"}
        locale={locale}
        onError={onError}
      />
    );
  },
  "git-merge": ({ tab, locale, onError }) => {
    const path = tab.payload?.path;
    const cwd = tab.payload?.cwd;
    if (!path || !cwd) return null;
    return <GitMergeConflictView cwd={cwd} path={path} locale={locale} onError={onError} />;
  },
  "git-range": ({ tab, locale, onError }) => {
    const cwd = tab.payload?.cwd;
    const base = tab.payload?.base;
    const head = tab.payload?.head;
    if (!cwd || !base || !head) return null;
    return <DockedGitRange cwd={cwd} base={base} head={head} locale={locale} onError={onError} />;
  },
};

/** 该内容类型是否已登记渲染器（供判定与测试使用）。 */
export function isKnownDockTabKind(kind: string): boolean {
  return kind in DOCK_TAB_RENDERERS;
}

export function DockTabBody({ tab, workspace, locale = "zh", onError }: DockTabBodyProps) {
  const state = dockTabBodyState(tab, workspace, isKnownDockTabKind);
  if (state === "foreign") {
    return (
      <div className="dock-tab-notice" role="status">
        <strong>{t("dock.tabForeignTitle", locale)}</strong>
        <p>{t("dock.tabForeignHint", locale, { path: dockTabWorkspace(tab) ?? "" })}</p>
      </div>
    );
  }
  if (state === "unknown") {
    return (
      <div className="dock-tab-notice" role="status">
        <strong>{t("dock.tabUnknownTitle", locale)}</strong>
        <p>{t("dock.tabUnknownHint", locale, { kind: tab.kind })}</p>
      </div>
    );
  }
  return <>{DOCK_TAB_RENDERERS[tab.kind]({ tab, workspace, locale, onError })}</>;
}
