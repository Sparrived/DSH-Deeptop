import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { codeBlockLines } from "./code-block";
import { codeLineDelays, streamInkHead, type StreamInk } from "./stream-ink";
import { t, type UiLocale } from "../app/i18n";

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return "";
}

/**
 * One fenced code block: a copy button, and a scrollport that survives
 * streaming.
 *
 * The line-number gutter is produced by a CSS counter on a pseudo-element (see
 * `.md-code-line::before`), so the digits never enter the DOM text and never
 * reach the clipboard. The `<pre>` is the scrollport; a streamed message
 * re-renders this block as tokens arrive, and without restoring the offset it
 * would snap back to the left edge mid-read.
 *
 * 正在写出来的代码块逐行渐显：代码行的结构由这里重建，正文那套逐字渐显落不到
 * 代码上，于是按每行的源码位置取同一套年龄（见 stream-ink.ts 的 codeLineDelays）。
 */
export function MarkdownCodeBlock({ children, locale, streamInk, sourceEnd, ...props }: HTMLAttributes<HTMLPreElement> & { locale: UiLocale; streamInk?: StreamInk | null; sourceEnd?: number }) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const scrollLeft = useRef(0);
  const lines = codeBlockLines(textFromNode(children));
  const code = lines.join("\n");
  const codeElement = isValidElement<{ children?: ReactNode }>(children)
    ? children as ReactElement<{ children?: ReactNode }>
    : null;
  // 只有正压在书写前沿上的代码块才渐显：更早写完的块早就淡完了，不该被后来的
  // 文字带着重新淡一遍。
  const end = typeof sourceEnd === "number" ? sourceEnd : null;
  const inkDelays = end !== null && streamInk != null && streamInkHead(streamInk, end)
    ? codeLineDelays(lines, end, streamInk)
    : null;

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (node !== null) node.scrollLeft = scrollLeft.current;
  });

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={`markdown-code-block${lines.length > 1 ? " numbered" : ""}`}>
      <pre
        {...props}
        ref={scrollRef}
        data-code-block-content=""
        onScroll={(event) => { scrollLeft.current = event.currentTarget.scrollLeft; }}
      >
        {codeElement === null ? children : cloneElement(codeElement, {}, lines.map((line, index) => {
          const delay = inkDelays?.[index] ?? null;
          return (
            <span
              className={`md-code-line${delay === null ? "" : " stream-ink"}`}
              key={index}
              style={delay === null ? undefined : { animationDelay: `-${Math.round(delay)}ms` }}
            >
              {index < lines.length - 1 ? `${line}\n` : line}
            </span>
          );
        }))}
      </pre>
      <button className="markdown-code-copy" type="button" onClick={() => void copyCode()} title={t("markdown.copyCode", locale)} aria-label={t("markdown.copyCode", locale)}>
        {copied ? t("markdown.copied", locale) : t("markdown.copy", locale)}
      </button>
    </div>
  );
}
