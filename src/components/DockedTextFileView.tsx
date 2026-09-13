import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileWarning, RefreshCw, Rows3 } from "lucide-react";
import { errorText, pathBasename } from "../app/model";
import { sessionPath } from "../app/ui-model";
import { t, type UiLocale } from "../app/i18n";
import { openInVscode, readWorkspaceFile, type WorkspaceFileSlice } from "../lib/desktop";

type DockedTextFileViewProps = {
  /** 停靠标签；`path` 为会话相对或绝对路径，`line` 为 1-based 定位行。 */
  path: string;
  line?: number;
  /** 活动会话的工作目录，用于解析相对路径。 */
  cwd: string;
  locale?: UiLocale;
  onError?: (message: string) => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; slice: WorkspaceFileSlice }
  | { status: "error"; message: string };

/** 定位行上下各取多少行，与原生侧的窗口默认值保持一致。 */
const CONTEXT_LINES = 200;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 停靠标签里的文本文件预览：按行读取一段窗口并定位到请求行。
 *
 * 这是 Agent 说“改了某文件第 42 行”时的应用内落点——路径与行号来自工具调用
 * 或交付卡片，读取走原生桥接并受字节/行数上限约束，不再把文件交给外部程序。
 * 用 VSCode 打开仍然保留为次要动作，作为需要完整编辑器时的出口。
 *
 * 图片分流在 `DockedFileView`：二进制/非文本内容仍然落到这里，由原生侧判定。
 */
export function DockedTextFileView({ path, line, cwd, locale = "zh", onError }: DockedTextFileViewProps) {
  const absolutePath = useMemo(() => sessionPath(cwd, path), [cwd, path]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const linesRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setState({ status: "loading" });
    try {
      const slice = await readWorkspaceFile(absolutePath, line, CONTEXT_LINES);
      // 异步导航竞态：await 之后只接受最新一次请求的结果。
      if (requestRef.current !== request) return;
      setState({ status: "ready", slice });
    } catch (error) {
      if (requestRef.current !== request) return;
      const message = t("dockFile.readFailed", locale, { detail: errorText(error, locale) });
      setState({ status: "error", message });
      onError?.(message);
    }
  }, [absolutePath, line, locale, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // 定位行到达后滚动到视口中央；读取尚未落盘或行越界时不做任何事。
  const readyStart = state.status === "ready" ? state.slice.startLine : 0;
  useEffect(() => {
    if (state.status !== "ready" || typeof line !== "number") return;
    const container = linesRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
  }, [line, readyStart, state.status]);

  const handleOpenExternal = () => {
    void openInVscode(absolutePath).catch((error) => {
      onError?.(t("files.errOpenVscode", locale, { detail: errorText(error, locale) }));
    });
  };

  const slice = state.status === "ready" ? state.slice : null;
  const endLine = slice ? slice.startLine + Math.max(slice.lines.length - 1, 0) : 0;

  return (
    <section className="dock-file-view" aria-label={t("dockFile.aria", locale, { path })}>
      <header className="dock-file-head">
        <div className="dock-file-copy">
          <strong title={absolutePath}>{pathBasename(path)}</strong>
          <small>
            {slice
              ? slice.lines.length === 0
                ? t("dockFile.noLines", locale)
                : t("dockFile.range", locale, { start: slice.startLine, end: endLine, total: slice.totalLines })
              : t("files.reading", locale)}
          </small>
        </div>
        <div className="dock-file-actions">
          <button type="button" onClick={() => void load()} title={t("files.refresh", locale)} aria-label={t("files.refresh", locale)}>
            <RefreshCw aria-hidden="true" />
          </button>
          <button type="button" onClick={handleOpenExternal} title={t("files.openWithVscode", locale)} aria-label={t("files.openWithVscode", locale)}>
            <Rows3 aria-hidden="true" />
          </button>
        </div>
      </header>

      {state.status === "loading" && <p className="dock-file-note">{t("files.reading", locale)}</p>}

      {state.status === "error" && (
        <div className="dock-file-note is-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{state.message}</span>
          <button type="button" onClick={() => void load()}>{t("markdown.retry", locale)}</button>
        </div>
      )}

      {slice?.binary && (
        <div className="dock-file-note">
          <FileWarning aria-hidden="true" />
          <span>{t("dockFile.binary", locale, { size: formatSize(slice.size) })}</span>
          <button type="button" onClick={handleOpenExternal}>{t("files.openWithVscode", locale)}</button>
        </div>
      )}

      {slice && !slice.binary && slice.lines.length === 0 && (
        <div className="dock-file-note">
          <FileWarning aria-hidden="true" />
          <span>{t("dockFile.tooLarge", locale, { size: formatSize(slice.size) })}</span>
          <button type="button" onClick={handleOpenExternal}>{t("files.openWithVscode", locale)}</button>
        </div>
      )}

      {slice && slice.lineOutOfRange && typeof line === "number" && slice.lines.length > 0 && (
        <p className="dock-file-note is-warning" role="status">{t("dockFile.lineOutOfRange", locale, { line })}</p>
      )}

      {slice && slice.lines.length > 0 && (
        <div className="dock-file-lines" ref={linesRef} role="region" aria-label={t("dockFile.linesAria", locale)}>
          {slice.lines.map((text, index) => {
            const number = slice.startLine + index;
            const isTarget = number === line;
            return (
              <div className={`dock-file-line${isTarget ? " is-target" : ""}`} data-line={number} key={number}>
                <span className="dock-file-line-number" aria-hidden="true">{number}</span>
                <code>{text || " "}</code>
              </div>
            );
          })}
        </div>
      )}

      {slice && slice.truncated && slice.lines.length > 0 && (
        <p className="dock-file-note is-muted">{t("dockFile.windowOnly", locale, { total: slice.totalLines })}</p>
      )}
    </section>
  );
}
