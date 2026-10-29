import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  attach: <path d="M12 5v14M5 12h14" />,
  wand: <><path d="m4 20 11-11 3 3L7 23zM15 3v3M20 6h3M19 1l1 2M4 6l1 2M2 11h3" /></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  send: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
  remove: <path d="M6 6l12 12M18 6 6 18" />,
  ocr: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 16l4-8 4 8M9 14h6" /></>,
};
export function ComposerIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
