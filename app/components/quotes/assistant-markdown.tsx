import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Render assistant text as Markdown, without loading remote images or interpreting HTML. */
export function AssistantMarkdown({ text }: { text: string }) {
  return <div className="qp-message-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ node: _node, href, ...props }) => <a href={href} target="_blank" rel="noopener noreferrer" {...props} />,
    img: ({ alt }) => alt ? <span>{alt}</span> : null,
    table: ({ node: _node, ...props }) => <div className="qp-markdown-table"><table {...props} /></div>,
  }}>{text}</Markdown></div>;
}
