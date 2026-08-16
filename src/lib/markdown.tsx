import ReactMarkdown, { type Components } from "react-markdown";
import { isValidElement, memo, useState, type HTMLAttributes, type ReactNode } from "react";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

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

const markdownComponents: Components = {
  a: ({ children, href, node, ...props }) => {
    if (!href) return <span className="markdown-link-disabled">{children}</span>;

    const external = /^(?:https?:|mailto:)/i.test(href);
    return (
      <a
        {...props}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
      >
        {children}
      </a>
    );
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

// Memoized: while a stream advances, the transcript re-renders on every frame
// but only the actively streaming message's `text` changes. Skipping the
// others avoids re-parsing every previous message's markdown on each token.
export const MarkdownContent = memo(function MarkdownContent({ text, className = "message-text", reveal = false }: { text: string; className?: string; reveal?: boolean }) {
  const contentClassName = reveal ? `${className} model-text-reveal` : className;
  return (
    <div className={contentClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
        skipHtml
      >
        {text.replace(/\r\n?/g, "\n")}
      </ReactMarkdown>
    </div>
  );
});
