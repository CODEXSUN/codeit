import assert from "node:assert/strict";
import test from "node:test";
import { latestCompletedResponse, type SupervisorEvent } from "../web/src/supervisor-response.js";

const event = (id: string, type: SupervisorEvent["type"], text: string): SupervisorEvent => ({ id, type, text });
const completed = (events: SupervisorEvent[]) => ({ events, busy: false, status: "idle" as const });

test("only the latest completed user turn offers a response", () => {
  const old = event("1", "assistant", "old");
  const history = [event("0", "user", "first"), old, event("2", "status", "Turn completed."), event("3", "user", "new")];
  assert.equal(latestCompletedResponse(completed([...history, event("4", "status", "Turn completed.")])), undefined);
  const answer = event("5", "assistant", "new answer");
  assert.equal(latestCompletedResponse(completed([...history, answer, event("6", "status", "Turn completed.")])), answer);
  assert.equal(latestCompletedResponse({ ...completed([...history, answer]), busy: true }), undefined);
  assert.equal(latestCompletedResponse({ ...completed([...history, answer]), status: "failed" }), undefined);
  assert.equal(latestCompletedResponse(completed([event("7", "user", "new"), event("8", "assistant", "  ")])), undefined);
});
