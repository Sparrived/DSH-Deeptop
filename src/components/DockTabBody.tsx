import { useCallback, type ReactNode } from "react";
import { DockedFileView } from "./DockedFileView";
import { DockedGitCommitFile } from "./DockedGitCommitFile";
import { DockedGitDiff } from "./DockedGitDiff";
import { DockedGitRange } from "./DockedGitRange";
import { GitCommitDetailView } from "./GitCommitDetailView";
import { GitMergeConflictView } from "./GitMergeConflictView";
import { t, type UiLocale } from "../app/i18n";
import { useDockSettings } from "../app/dock-settings";
import { pathBasename, fileTabDetail } from "../app/ui-model";
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

type DockTabRendererProps = DockTabBodyProps & {
  /** 在标签内改指到另一个文件（图片预览翻页）；由标签所在的右栏负责落库。 */
  onNavigatePath: (path: string) => void;
};

type DockTabRenderer = (props: DockTabRendererProps) => ReactNode;

const DOCK_TAB_RENDERERS: Record<string, DockTabRenderer> = {
  file: ({ tab, workspace, locale, onError, onNavigatePath }) => (tab.path ? (
    <DockedFileView
      key={tab.id}
      path={tab.path}
      line={tab.line}
      cwd={workspace}
      locale={locale}
      onError={onError}
      onNavigatePath={onNavigatePath}
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
  const { retargetFileTab } = useDockSettings();
  // 标签身份是路径：面板里换了文件，标签的路径、标题与副标题必须一起改。
  const onNavigatePath = useCallback((path: string) => {
    retargetFileTab(tab.id, { path, title: pathBasename(path) || path, detail: fileTabDetail(path) });
  }, [retargetFileTab, tab.id]);
  const state = dockTabBodyState(tab, workspace, isKnownDockTabKind);
  // 面板类标签由 DockFrame 自己把正文搬进宿主：这里返回 null，避免多出一块说明
  if (state === "panel") return null;
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
  return <>{DOCK_TAB_RENDERERS[tab.kind]({ tab, workspace, locale, onError, onNavigatePath })}</>;
}
