import assert from "node:assert/strict";
import test from "node:test";
import { activityFromItem } from "../web/src/chat-activity.js";

test("activity labels reflect provider items and keep their details", () => {
  assert.deepEqual(activityFromItem({ type: "commandExecution", command: "rg needle src", aggregatedOutput: "src/a:needle" }), { label: "Ran rg", detail: "rg needle src\nsrc/a:needle" });
  assert.equal(activityFromItem({ type: "commandExecution", command: "pwsh.exe -Command 'rg alpha sample.txt'" })?.label, "Ran rg");
  assert.equal(activityFromItem({ type: "commandExecution", command: "echo rg alpha" })?.label, "Ran command");
  assert.equal(activityFromItem({ type: "commandExecution", command: "npm test" })?.label, "Ran command");
  assert.match(activityFromItem({ type: "fileChange", changes: [{ path: "a.ts", kind: "update" }] })!.detail, /a\.ts/);
  assert.equal(activityFromItem({ type: "contextCompaction" })?.label, "Context compacted");
  assert.equal(activityFromItem({ type: "mcpToolCall", server: "browser", tool: "open" })?.label, "Used browser / open");
  assert.equal(activityFromItem({ type: "agentMessage", text: "answer" }), undefined);
});
