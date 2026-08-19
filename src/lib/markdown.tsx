import ReactMarkdown, { type Components } from "react-markdown";
import { isValidElement, memo, useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { SKIP, visit } from "unist-util-visit";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { decodeFileLink, entityHost, FILE_LINK_PREFIX, pathLabel, splitMessageEntities } from "./message-entities";

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

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return "";
}

function MarkdownCodeBlock({ children, ...props }: HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const code = textFromNode(children).replace(/\n$/, "");

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
    <div className="markdown-code-block">
      <pre {...props}>{children}</pre>
      <button className="markdown-code-copy" type="button" onClick={() => void copyCode()} title="复制代码" aria-label="复制代码">
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

type MarkdownEntityActions = {
  onOpenPath?: (path: string) => void | Promise<void>;
  onCheckPath?: (path: string) => Promise<boolean>;
  onOpenUrl?: (url: string) => void | Promise<void>;
};

function MessageEntityLink({ href, children, onOpenPath, onCheckPath, onOpenUrl }: { href?: string; children?: ReactNode } & MarkdownEntityActions) {
  const path = href ? decodeFileLink(href) : null;
  const url = href && /^(?:https?):/i.test(href) ? href : null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isFile, setIsFile] = useState(false);
  const [checkedPath, setCheckedPath] = useState<string | null>(null);
  const label = path ? pathLabel(path) : url ? { name: entityHost(url), directory: "连接" } : null;

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
      <span className="message-entity-icon" aria-hidden="true">{path ? "▧" : "↗"}</span>
      <span className="message-entity-copy"><strong>{label.name}</strong><small>{error || label.directory}</small></span>
      <button type="button" className="message-entity-open" disabled={busy || !(path ? onOpenPath : onOpenUrl)} onClick={() => void open()}>
        {busy ? "打开中" : error ? "重试" : "打开"}
      </button>
    </span>
  );
}

function createMarkdownComponents(actions: MarkdownEntityActions): Components {
  return {
  a: ({ children, href, node, ...props }) => {
    if (!href) return <span className="markdown-link-disabled">{children}</span>;
    if (decodeFileLink(href) || /^(?:https?):/i.test(href)) {
      return <MessageEntityLink href={href} onOpenPath={actions.onOpenPath} onCheckPath={actions.onCheckPath} onOpenUrl={actions.onOpenUrl}>{children}</MessageEntityLink>;
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
  pre: ({ children, node, ...props }) => <MarkdownCodeBlock {...props}>{children}</MarkdownCodeBlock>,
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
export const MarkdownContent = memo(function MarkdownContent({ text, className = "message-text", reveal = false, onOpenPath, onCheckPath, onOpenUrl }: { text: string; className?: string; reveal?: boolean } & MarkdownEntityActions) {
  const contentClassName = reveal ? `${className} model-text-reveal` : className;
  const components = createMarkdownComponents({ onOpenPath, onCheckPath, onOpenUrl });
  return (
    <div className={contentClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMessageEntities]}
        components={components}
        urlTransform={(url) => url}
        skipHtml
      >
        {text.replace(/\r\n?/g, "\n")}
      </ReactMarkdown>
    </div>
  );
});
