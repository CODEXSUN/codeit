import type { Run } from "./loop-store.js";

export function reviewEvidence(run?: Run): string {
  if (!run) return "";
  const response = run.events.filter((event) => event.type === "response").map((event) => event.text).join("");
  const evidence = run.events.filter((event) => event.type === "response" || event.type === "item").map((event) => {
    if (event.type !== "item" || !response) return event.text;
    try {
      const item = JSON.parse(event.text);
      if (item?.type === "agentMessage" && item.text === response) {
        return JSON.stringify({ ...item, text: "[Included in streamed response above or below]" });
      }
    } catch {}
    return event.text;
  }).join("");
  return evidence;
}
