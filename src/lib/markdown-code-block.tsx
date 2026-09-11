import { cloneElement, isValidElement, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { codeBlockLines } from "./code-block";
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
 */
export function MarkdownCodeBlock({ children, locale, ...props }: HTMLAttributes<HTMLPreElement> & { locale: UiLocale }) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const scrollLeft = useRef(0);
  const lines = codeBlockLines(textFromNode(children));
  const code = lines.join("\n");
  const codeElement = isValidElement<{ children?: ReactNode }>(children)
    ? children as ReactElement<{ children?: ReactNode }>
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
        {codeElement === null ? children : cloneElement(codeElement, {}, lines.map((line, index) => (
          <span className="md-code-line" key={index}>{index < lines.length - 1 ? `${line}\n` : line}</span>
        )))}
      </pre>
      <button className="markdown-code-copy" type="button" onClick={() => void copyCode()} title={t("markdown.copyCode", locale)} aria-label={t("markdown.copyCode", locale)}>
        {copied ? t("markdown.copied", locale) : t("markdown.copy", locale)}
      </button>
    </div>
  );
}
