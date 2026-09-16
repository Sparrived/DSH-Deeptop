import { ExternalLink, FileText } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { memo, useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";
import { SKIP, visit } from "unist-util-visit";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { decodeFileLink, entityHost, FILE_LINK_PREFIX, pathLabel, splitMessageEntities } from "./message-entities";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { rehypeStreamInk, type StreamInk } from "./stream-ink";
import { t, type UiLocale } from "../app/i18n";

function remarkMessageEntities() {
  return (tree: { children?: unknown[] }) => {
    visit(tree as never, "text", (node: { value?: unknown }, _index: number | undefined, parent: { type?: string; children?: unknown[] } | undefined) => {
      if (parent?.type === "link" || parent?.type === "inlineCode" || parent?.type === "code" || typeof node.value !== "string") return;
      const segments = splitMessageEntities(node.value);
      if (segments.length === 1 && segments[0].kind === "text") return;
      if (!parent?.children || _index === undefined) return;
      const replacement = segments.map((segment) => segment.kind === "text"
        ? { type: "text", value: segment.value }
        : { type: "link", url: segment.kind === "file" ? `${FILE_LINK_PREFIX}${encodeURIComponent(segment.value)}` : segment.value, children: [{ type: "text", value: segment.value }] });
      parent.children.splice(_index, 1, ...replacement);
      return [SKIP, replacement.length] as const;
    });
  };
}

/**
 * One markdown image.
 *
 * A destination that cannot load — an unreachable URL, or a local path the
 * webview is not allowed to read — falls back to the authored text instead of a
 * broken image. The failed destination is remembered rather than a boolean, so
 * a corrected source is retried instead of staying replaced forever.
 */
function MarkdownImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (typeof src !== "string" || src.length === 0 || failedSource === src) {
    return <span className="markdown-image-fallback">{alt || src || ""}</span>;
  }
  return <img {...props} src={src} alt={alt ?? ""} onError={() => setFailedSource(src)} />;
}

type MarkdownEntityActions = {
  onOpenPath?: (path: string, location?: { line?: number }) => void | Promise<void>;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenUrl?: (url: string) => void | Promise<void>;
};

function MessageEntityLink({ href, children, locale, onOpenPath, onCheckPath, onOpenUrl }: { href?: string; children?: ReactNode; locale: UiLocale } & MarkdownEntityActions) {
  const path = href ? decodeFileLink(href) : null;
  const url = href && /^(?:https?):/i.test(href) ? href : null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isFile, setIsFile] = useState(false);
  const [checkedPath, setCheckedPath] = useState<string | null>(null);
  const label = path ? pathLabel(path, locale) : url ? { name: entityHost(url), directory: t("markdown.linkDirectory", locale) } : null;

  useEffect(() => {
    if (!path || !onCheckPath) return;
    let active = true;
    void onCheckPath(path).then((value) => {
      if (active) {
        setCheckedPath(path);
        setIsFile(value);
      }
    }).catch(() => {
      if (active) {
        setCheckedPath(path);
        setIsFile(false);
      }
    });
    return () => {
      active = false;
    };
  }, [onCheckPath, path]);

  if (!label || (!path && !url) || (path && (checkedPath !== path || !isFile))) return <span className="markdown-link-disabled">{children}</span>;

  async function open() {
    const action = path ? onOpenPath : onOpenUrl;
    const value = path ?? url;
    if (!action || !value) return;
    setBusy(true);
    setError("");
    try {
      await action(value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`message-entity-card ${path ? "file-entity-card" : "connection-entity-card"}`} title={error || (path ?? url ?? "") }>
      <span className="message-entity-icon" aria-hidden="true">{path ? <FileText /> : <ExternalLink />}</span>
      <span className="message-entity-copy"><strong>{label.name}</strong><small>{error || label.directory}</small></span>
      <button type="button" className="message-entity-open" disabled={busy || !(path ? onOpenPath : onOpenUrl)} onClick={() => void open()}>
        {busy ? t("markdown.opening", locale) : error ? t("markdown.retry", locale) : t("markdown.open", locale)}
      </button>
    </span>
  );
}

function createMarkdownComponents(actions: MarkdownEntityActions, locale: UiLocale, streamInk?: StreamInk | null): Components {
  return {
  a: ({ children, href, node, ...props }) => {
    if (!href) return <span className="markdown-link-disabled">{children}</span>;
    if (decodeFileLink(href) || /^(?:https?):/i.test(href)) {
      return <MessageEntityLink href={href} locale={locale} onOpenPath={actions.onOpenPath} onCheckPath={actions.onCheckPath} onOpenUrl={actions.onOpenUrl}>{children}</MessageEntityLink>;
    }
    return <span className="markdown-link-disabled">{children}</span>;
  },
  code: ({ children, className, node, ...props }) => {
    const language = className?.match(/language-([\w-]+)/)?.[1];
    return (
      <code {...props} className={className} data-language={language || undefined}>
        {children}
      </code>
    );
  },
  // `node.position.end` 就是这段代码在正文里的结束位置，用它判断代码块是不是
  // 正写在书写前沿上（见 MarkdownCodeBlock）。
  pre: ({ children, node, ...props }) => <MarkdownCodeBlock {...props} locale={locale} streamInk={streamInk} sourceEnd={node?.position?.end?.offset}>{children}</MarkdownCodeBlock>,
  img: ({ src, alt, node, ...props }) => (
    <MarkdownImage {...props} src={typeof src === "string" ? src : undefined} alt={typeof alt === "string" ? alt : undefined} />
  ),
  table: ({ children, node, ...props }) => (
    <div className="markdown-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
  };
}

// Memoized: while a stream advances, the transcript re-renders on every frame
// but only the actively streaming message's `text` changes. Skipping the
// others avoids re-parsing every previous message's markdown on each token.
export const MarkdownContent = memo(function MarkdownContent({ text, className = "message-text", reveal = false, locale = "zh", streamInk, onOpenPath, onCheckPath, onOpenUrl }: { text: string; className?: string; reveal?: boolean; locale?: UiLocale; /** 流式正文的逐段渐显：刚写下的字按自己的年龄淡入。 */ streamInk?: StreamInk | null } & MarkdownEntityActions) {
  const contentClassName = reveal ? `${className} model-text-reveal` : className;
  const components = createMarkdownComponents({ onOpenPath, onCheckPath, onOpenUrl }, locale, streamInk);
  return (
    <div className={contentClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks, remarkMessageEntities]}
        rehypePlugins={streamInk && streamInk.chunks.length > 0 ? [[rehypeStreamInk, streamInk], rehypeKatex] : [rehypeKatex]}
        components={components}
        urlTransform={(url) => url}
        skipHtml
      >
        {text.replace(/\r\n?/g, "\n")}
      </ReactMarkdown>
    </div>
  );
});
