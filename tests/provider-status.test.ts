import assert from "node:assert/strict";
import { test } from "node:test";
import { codexStatus, geminiStatus } from "../api/src/provider-status.js";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { GeminiClient } from "../api/src/gemini.js";

test("provider tests are independent and sanitize failures", async (t) => {
  let closed = 0;
  const rpc = new CodexRpc();
  t.mock.method(rpc, "connect", async () => {});
  t.mock.method(rpc, "request", async () => ({ data: [{ model: "fixture" }], nextCursor: null }));
  t.mock.method(rpc, "close", () => { closed++; });
  assert.equal((await codexStatus(rpc)).available, true);
  assert.equal(closed, 1);
  const gemini = new GeminiClient("secret-fixture", async () => { throw new Error("secret-fixture"); });
  const result = await geminiStatus(gemini);
  assert.equal(result.available, false);
  assert(!JSON.stringify(result).includes("secret-fixture"));
});
