import assert from "node:assert/strict";
import { test } from "node:test";
import { codexStatus, geminiStatus } from "../api/src/provider-status.js";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { GeminiClient } from "../api/src/gemini.js";

test("provider tests are independent and sanitize failures", async (t) => {
  let closed = 0;
  const rpc = new CodexRpc();
  t.mock.method(rpc, "connect", async () => {});
  t.mock.method(rpc, "request", async (method) => method === "account/read" ? { account: { type: "chatgpt", email: "fixture@example.test", token: "secret-fixture" }, requiresOpenaiAuth: true } : { data: [{ model: "fixture" }], nextCursor: null });
  t.mock.method(rpc, "close", () => { closed++; });
  const codex = await codexStatus(rpc);
  assert.equal(codex.available, true);
  assert.equal(codex.account?.email, "fixture@example.test");
  assert(!JSON.stringify(codex).includes("secret-fixture"));
  assert.equal(closed, 1);
  const gemini = new GeminiClient("secret-fixture", async () => { throw new Error("secret-fixture"); });
  const result = await geminiStatus(gemini);
  assert.equal(result.available, false);
  assert(!JSON.stringify(result).includes("secret-fixture"));
});

test("account status distinguishes signed out from unavailable identity", async (t) => {
  const rpc = new CodexRpc();
  let account: unknown = { account: null, requiresOpenaiAuth: true };
  t.mock.method(rpc, "connect", async () => {});
  t.mock.method(rpc, "close", () => {});
  t.mock.method(rpc, "request", async (method) => method === "account/read" ? account : { data: [{ model: "fixture" }], nextCursor: null });
  assert.equal((await codexStatus(rpc)).account?.state, "signed_out");
  account = { account: null, requiresOpenaiAuth: false };
  assert.equal((await codexStatus(rpc)).account?.state, "unknown");
  account = { account: { type: "apiKey", email: "should-not-be-exposed@example.test" } };
  assert.equal((await codexStatus(rpc)).account?.email, undefined);
});

test("account lookup failure does not invent identity or hide discovered models", async (t) => {
  const rpc = new CodexRpc();
  t.mock.method(rpc, "connect", async () => {});
  t.mock.method(rpc, "close", () => {});
  t.mock.method(rpc, "request", async (method) => {
    if (method === "account/read") throw new Error("private-detail");
    return { data: [{ model: "fixture" }], nextCursor: null };
  });
  const result = await codexStatus(rpc);
  assert.equal(result.available, true);
  assert.equal(result.account?.state, "unknown");
  assert(!JSON.stringify(result).includes("private-detail"));
});
