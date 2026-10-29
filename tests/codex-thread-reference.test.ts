import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { Store } from "../api/src/store.js";
import { registerCodexThreadReference } from "../api/src/codex-thread-reference.js";

test("thread reference returns only a confirmed stored Codex ID", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-thread-reference-"));
  const app = Fastify();
  try {
    const store = new Store(dir);
    const chat = store.chat(store.projects()[0].chats[0].id)!;
    const id = randomUUID();
    let mode: "match" | "wrong" | "error" | "deleted" = "match";
    let closed = 0;
    t.mock.method(CodexRpc.prototype, "connect", async () => {});
    t.mock.method(CodexRpc.prototype, "close", () => { closed++; });
    t.mock.method(CodexRpc.prototype, "request", async (method, params: any) => {
      assert.equal(method, "thread/read"); assert.equal(params.includeTurns, false);
      if (mode === "error") throw new Error("sensitive-fixture");
      if (mode === "deleted") store.deleteChat(chat.id);
      return { thread: { id: mode === "wrong" ? randomUUID() : params.threadId, name: "Codex fixture title", secret: "sensitive-fixture" } };
    });
    registerCodexThreadReference(app, store);
    const url = `/api/chats/${chat.id}/codex-thread`;
    assert.deepEqual((await app.inject({ method: "GET", url })).json(), { threadId: null });
    store.setThread(chat, id);
    const ok = await app.inject({ method: "GET", url });
    assert.deepEqual(ok.json(), { threadId: id, codeitName: chat.name, codexName: "Codex fixture title", baseline: null, syncState: "unbased" });
    store.renameChat(chat.id, "Renamed locally");
    const renamed = await app.inject({ method: "GET", url });
    assert.equal(renamed.json().codeitName, "Renamed locally");
    assert.equal(renamed.json().codexName, "Codex fixture title");
    mode = "wrong"; assert.equal((await app.inject({ method: "GET", url })).statusCode, 409);
    mode = "error"; const failed = await app.inject({ method: "GET", url });
    assert.equal(failed.statusCode, 503); assert(!failed.body.includes("sensitive-fixture"));
    mode = "deleted"; const deleted = await app.inject({ method: "GET", url });
    assert.equal(deleted.statusCode, 409); assert.match(deleted.json().error, /chat changed during verification/i);
    assert.equal(closed, 5);
    assert.equal((await app.inject({ method: "GET", url: "/api/chats/missing/codex-thread" })).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
