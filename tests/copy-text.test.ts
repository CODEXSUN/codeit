import assert from "node:assert/strict";
import test from "node:test";
import { copyText } from "../web/src/copy-text.js";
test("copy preserves multiline text and reports unavailable or rejected clipboard", async () => {
  let copied = "";
  await copyText("first\n  code", { writeText: async (value) => { copied = value; } });
  assert.equal(copied, "first\n  code");
  await assert.rejects(copyText("x", undefined), /unavailable/);
  await assert.rejects(copyText("x", { writeText: async () => { throw new Error("denied"); } }), /denied/);
});
