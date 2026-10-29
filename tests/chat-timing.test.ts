import assert from "node:assert/strict";
import test from "node:test";
import { timingLabel, updateTiming } from "../web/src/chat-timing.js";

test("timing uses correlated actual events and does not invent crash end times", () => {
  const start = "2026-10-29T10:00:00.000Z";
  let state = updateTiming({ turns: {} }, { type: "user", turnKey: "one", startedAt: start });
  assert.equal(timingLabel(state.turns.one, Date.parse(start) + 148000, true), "Working for 2m 28s");
  state = updateTiming(state, { type: "finished", turnKey: "other", finishedAt: "2026-10-29T10:03:00.000Z", status: "completed" });
  assert.equal(state.active, "one");
  state = updateTiming(state, { type: "finished", turnKey: "one", finishedAt: "2026-10-29T10:03:00.000Z", status: "completed" });
  assert.equal(timingLabel(state.turns.one, 0, false), "Worked for 3m");
  state = updateTiming(state, { type: "user", turnKey: "two", startedAt: start });
  state = updateTiming(state, { type: "finished", turnKey: "two", status: "interrupted", interruptionObservedAt: "2026-10-29T10:05:00.000Z" });
  assert.equal(timingLabel(state.turns.two, 0, false), "Interrupted · duration unavailable");
  assert.equal(timingLabel(undefined, 0, false), undefined);
  assert.equal(timingLabel({ startedAt: start, finishedAt: "2026-10-29T10:00:15.000Z", status: "failed" }, 0, false), "Failed after 15s");
});
