// Git 变更的跨面板通知：右栏的 git 内容标签和左侧 Dock 面板是两个独立组件，
// 但都会改动同一个仓库（例如在差异标签里暂存一个 hunk）。这里用一个窗口事件
// 把"仓库变了"广播出去，宿主收到后刷新自己的投影，而不是各刷各的。
//
// 事件只传语义（谁改的），不带任何数据：所有状态仍然由各自的 Bridge 调用重取。

export const GIT_CHANGED_EVENT = "deeptop:git-changed";

export type GitChangedSource = "changes" | "commit" | "diff" | "branches" | "stash";

/** 广播一次"仓库已变更"；非桌面/无 window 环境下静默跳过。 */
export function notifyGitChanged(source: GitChangedSource): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ source: GitChangedSource }>(GIT_CHANGED_EVENT, { detail: { source } }));
}

/** 订阅"仓库已变更"，返回取消订阅函数。 */
export function onGitChanged(listener: (source: GitChangedSource) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ source?: GitChangedSource }>).detail;
    listener(detail?.source ?? "changes");
  };
  window.addEventListener(GIT_CHANGED_EVENT, handler);
  return () => window.removeEventListener(GIT_CHANGED_EVENT, handler);
}
