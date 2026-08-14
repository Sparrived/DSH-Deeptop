import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

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
  table: ({ children, node, ...props }) => (
    <div className="markdown-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
};

export function MarkdownContent({ text, className = "message-text" }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
        skipHtml
      >
        {text.replace(/\r\n?/g, "\n")}
      </ReactMarkdown>
    </div>
  );
}
