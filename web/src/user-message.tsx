import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = { text: string; children?: ReactNode };

export function UserMessage({ text, children }: Props) {
  const textRef = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setOverflowing(element.scrollHeight > lineHeight * 2 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return <div className="user-bubble">
    <pre ref={textRef} className={expanded ? "" : "user-message-clamped"}>{text}</pre>
    {overflowing && <button type="button" className="user-message-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? "Show less" : "Show more"}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
    </button>}
    {children}
  </div>;
}
