import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./assistant-message.css";

export function AssistantMessage({ text }: { text: string }) {
  return <div className="assistant-message"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    img: ({ alt, src }) => src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt ? `[Image: ${alt}]` : "[Image]"}</a> : <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span>,
    table: ({ children }) => <div className="assistant-table"><table>{children}</table></div>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  }}>{text}</ReactMarkdown></div>;
}
