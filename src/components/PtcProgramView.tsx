import { useCallback, useRef, useState, type CSSProperties } from "react";
import type { PtcCall, PtcProgram } from "../app/ptc-program";
import { displayToolName } from "../app/tool-call-display";
import { ToolArgsView } from "../app/tool-args-render";
import { ToolResultView } from "../app/tool-result-render";
import { durationLabel } from "../app/trajectory";
import { t, type UiLocale } from "../app/i18n";

/** 一行源码上直接放几个调用标记，其余折成 `+N`。 */
const MAX_LINE_MARKERS = 3;

function stateLabel(call: PtcCall, locale: UiLocale): string {
  if (call.state === "running") return t("conversation.tool.running", locale);
  if (call.state === "error") return t("conversation.tool.error", locale);
  return t("conversation.tool.returned", locale);
}

/**
 * PTC 执行视图：左栏是程序源码与调用位点标记，右栏是程序内部真实发生的调用。
 *
 * 两侧共用同一个序号：源码 gutter 上第 n 号标记就是执行栏里第 n 行，悬停或聚焦任一侧
 * 会同时点亮另一侧，点击标记会展开对应调用的参数与结果。定位不到源码位点的调用留在
 * 执行栏、并由脚注如实计数——视图不会为它们编造行号。
 *
 * 正文只在卡片展开时渲染：折叠条本身已经给出调用数与耗时，程序可能有上千行，收起时
 * 没有必要把它们挂进 DOM。
 */
export function PtcProgramView({
  program,
  locale,
  open,
  timeLabel,
  onOpenPath,
  onOpenUrl,
}: {
  program: PtcProgram;
  locale: UiLocale;
  /** 所属工具卡片是否展开；收起时不渲染正文。 */
  open: boolean;
  /** 这次调用的发起时刻，已格式化；随程序栏头部显示。 */
  timeLabel?: string;
  onOpenPath?: (path: string, location?: { line?: number }) => void | Promise<void>;
  onOpenUrl?: (url: string) => void | Promise<void>;
}) {
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());

  const reveal = useCallback((call: PtcCall) => {
    setActiveCallId(call.callId);
    setOpenCallId(call.callId);
    rows.current.get(call.callId)?.scrollIntoView({ block: "nearest" });
  }, []);

  if (!open) return null;

  const { stats, lines } = program;
  const hasProgram = lines.length > 0;

  return (
    <div className="ptc-program" data-has-program={hasProgram ? "true" : "false"}>
      {hasProgram && (
        <section className="ptc-pane ptc-pane-program" aria-label={t("conversation.ptc.program", locale)}>
          <div className="ptc-pane-head">
            <span>{t("conversation.ptc.program", locale)}</span>
            <span className="ptc-pane-meta">{t("conversation.ptc.lineCount", locale, { count: lines.length })}{timeLabel ? ` · ${timeLabel}` : ""}</span>
          </div>
          <div className="ptc-code">
            {lines.map((line) => {
              const isActive = line.calls.some((call) => call.callId === activeCallId);
              const extra = line.calls.length - MAX_LINE_MARKERS;
              return (
                <div
                  className="ptc-line"
                  key={line.no}
                  data-line={line.no}
                  data-anchored={line.calls.length > 0 ? "true" : undefined}
                  data-active={isActive ? "true" : undefined}
                >
                  <span className="ptc-gutter">
                    <span className="ptc-line-no" aria-hidden="true">{line.no}</span>
                    {line.calls.length > 0 && (
                      <span className="ptc-line-marks">
                        {line.calls.slice(0, MAX_LINE_MARKERS).map((call) => (
                          <button
                            type="button"
                            className="ptc-mark"
                            key={call.callId}
                            data-state={call.state}
                            data-active={call.callId === activeCallId ? "true" : undefined}
                            aria-label={t("conversation.ptc.markerAria", locale, { index: call.index, name: displayToolName(call.name) })}
                            title={`${call.index} ${displayToolName(call.name)}${call.summary ? ` · ${call.summary}` : ""}`}
                            onClick={() => reveal(call)}
                            onMouseEnter={() => setActiveCallId(call.callId)}
                            onFocus={() => setActiveCallId(call.callId)}
                          >
                            {call.index}
                          </button>
                        ))}
                        {extra > 0 && (
                          <span className="ptc-mark-more" aria-label={t("conversation.ptc.moreCalls", locale, { count: extra })}>+{extra}</span>
                        )}
                      </span>
                    )}
                  </span>
                  <code className="ptc-line-text">{line.text === "" ? " " : line.text}</code>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="ptc-pane ptc-pane-trace" aria-label={t("conversation.ptc.trace", locale)}>
        <div className="ptc-pane-head">
          <span>{t("conversation.ptc.trace", locale)}</span>
          <span className="ptc-pane-meta">{t("conversation.ptc.calls", locale, { count: stats.calls })}</span>
        </div>
        <ol className="ptc-trace">
          {program.calls.map((call) => {
            const expanded = call.callId === openCallId;
            const share = call.durationMs === undefined || stats.maxDurationMs <= 0
              ? undefined
              : Math.max(2, Math.round((call.durationMs / stats.maxDurationMs) * 100));
            return (
              <li
                className="ptc-call"
                key={call.callId}
                data-state={call.state}
                data-active={call.callId === activeCallId ? "true" : undefined}
                ref={(node) => {
                  if (node === null) rows.current.delete(call.callId);
                  else rows.current.set(call.callId, node);
                }}
              >
                <button
                  type="button"
                  className="ptc-call-row"
                  aria-expanded={expanded}
                  aria-label={t("conversation.ptc.callAria", locale, { index: call.index, name: displayToolName(call.name) })}
                  onClick={() => setOpenCallId(expanded ? null : call.callId)}
                  onMouseEnter={() => setActiveCallId(call.callId)}
                  onMouseLeave={() => setActiveCallId((current) => (current === call.callId ? null : current))}
                  onFocus={() => setActiveCallId(call.callId)}
                >
                  <span className="ptc-call-index" aria-hidden="true">{call.index}</span>
                  <span className="ptc-call-main">
                    <strong>{displayToolName(call.name)}</strong>
                    {call.summary && <span className="ptc-call-summary">{call.summary}</span>}
                  </span>
                  {call.concurrent >= 2 && (
                    <span className="ptc-call-parallel" title={t("conversation.ptc.parallel", locale, { count: call.concurrent })}>⇉{call.concurrent}</span>
                  )}
                  <span className="ptc-call-meta">
                    <span className="ptc-call-state" data-state={call.state} aria-hidden="true" />
                    <span className="ptc-call-time">{call.state === "running" ? stateLabel(call, locale) : durationLabel(call.durationMs, locale)}</span>
                  </span>
                  {share !== undefined && (
                    <span className="ptc-call-bar" style={{ "--ptc-bar": `${share}%` } as CSSProperties} aria-hidden="true" />
                  )}
                </button>
                {expanded && (
                  <div className="ptc-call-detail">
                    {call.argsText !== "" && (
                      <div className="ptc-call-block">
                        <span>{t("conversation.tool.callArgs", locale)}</span>
                        <ToolArgsView text={call.argsText} toolName={call.name} args={call.argsObject} locale={locale} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} />
                      </div>
                    )}
                    {call.resultText !== "" ? (
                      <div className={`ptc-call-block${call.error ? " error" : ""}`}>
                        <span>{t("conversation.tool.result", locale)}</span>
                        <ToolResultView text={call.resultText} locale={locale} />
                      </div>
                    ) : call.state !== "running" ? (
                      <p className="ptc-note">{t("conversation.ptc.callEmpty", locale)}</p>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {program.unplaced.length > 0 && (
          <p className="ptc-note">{t("conversation.ptc.unplaced", locale, { count: program.unplaced.length })}</p>
        )}
        {program.caughtFailures > 0 && (
          <p className="ptc-note caught">{t("conversation.ptc.caught", locale, { count: program.caughtFailures })}</p>
        )}
      </section>
    </div>
  );
}
