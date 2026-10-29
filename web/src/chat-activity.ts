export type Activity = { label: string; detail: string };

export function activityFromItem(item: Record<string, unknown>): Activity | undefined {
  const type = item.type;
  if (type === "commandExecution") {
    const command = typeof item.command === "string" ? item.command : "";
    const isSearch = /^\s*rg(?:\s|$)/i.test(command) || /(?:-command|-c|-lc)\s+['"]?\s*rg(?:\s|['"]|$)/i.test(command);
    const label = isSearch ? "Ran rg" : "Ran command";
    const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
    return { label, detail: command ? `${command}\n${output}` : output };
  }
  if (type === "fileChange") return { label: "Edited files", detail: format(item.changes) };
  if (type === "contextCompaction") return { label: "Context compacted", detail: "The provider reported a context compaction." };
  if (type === "mcpToolCall" || type === "dynamicToolCall") {
    const name = [item.server, item.tool].filter((value) => typeof value === "string" && value).join(" / ");
    return { label: name ? `Used ${name}` : "Used a tool", detail: format({ arguments: item.arguments, result: item.result, error: item.error }) };
  }
  if (type === "webSearch") return { label: "Used web search", detail: format(item.query ?? item.action) };
  return undefined;
}

function format(value: unknown): string {
  if (value === undefined || value === null) return "No details reported.";
  if (typeof value === "string") return value || "No details reported.";
  return JSON.stringify(value, null, 2) || "No details reported.";
}
