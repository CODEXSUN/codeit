import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { Store } from "../api/src/store.js";
import { nameSyncState, registerCodexNameSync } from "../api/src/codex-name-sync.js";

test("explicit name resolution records baseline, detects conflicts and survives restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-name-sync-")); const app = Fastify();
  try {
    const store = new Store(dir); const chat = store.chat(store.projects()[0].chats[0].id)!;
    const threadId = randomUUID(); store.setThread(chat, threadId); store.renameChat(chat.id, "Alpha");
    let codexName: string | null = "Alpha"; let reads = 0; let race = false; let raceAfter = false; let fail = false; let busy = false;
    t.mock.method(CodexRpc.prototype, "connect", async () => {});
    t.mock.method(CodexRpc.prototype, "close", () => {});
    t.mock.method(CodexRpc.prototype, "request", async (method, params: any) => {
      if (method === "thread/read") { reads++; if ((race && reads === 2) || (raceAfter && reads === 3)) codexName = "Changed elsewhere"; return { thread: { id: threadId, name: codexName, status: { type: "idle" } } }; }
      assert.equal(method, "thread/name/set"); if (fail) throw new Error("private-detail"); codexName = params.name; return {};
    });
    registerCodexNameSync(app, store, () => busy);
    const url = `/api/chats/${chat.id}/codex-name-sync`;
    const post = (body: unknown) => app.inject({ method: "POST", url, payload: body });
    const payload = (choice: string, baseline: { threadId: string; name: string } | null) => ({ threadId, codeitName: chat.name, codexName, baseline, choice, confirmed: true });
    assert.equal(nameSyncState("Alpha", "Alpha", null), "matched_unrecorded");
    assert.equal((await post(payload("record", null))).statusCode, 200);
    let baseline = { threadId, name: "Alpha" };
    store.renameChat(chat.id, "Beta"); assert.equal(nameSyncState(chat.name, codexName, baseline), "codeit_changed");
    assert.equal((await post(payload("codeit", baseline))).statusCode, 200);
    assert.equal(codexName, "Beta"); baseline = { threadId, name: "Beta" };
    codexName = "Gamma"; assert.equal(nameSyncState(chat.name, codexName, baseline), "codex_changed");
    assert.equal((await post(payload("codex", baseline))).statusCode, 200);
    assert.equal(chat.name, "Gamma"); baseline = { threadId, name: "Gamma" };
    assert.deepEqual(new Store(dir).chatNameBaseline(chat.id), baseline);
    store.renameChat(chat.id, "Local"); codexName = "Remote";
    assert.equal(nameSyncState(chat.name, codexName, baseline), "conflict");
    busy = true; assert.equal((await post(payload("codeit", baseline))).statusCode, 409); busy = false;
    reads = 0; race = true; assert.equal((await post(payload("codeit", baseline))).statusCode, 409); assert.equal(codexName, "Changed elsewhere");
    race = false; codexName = "Remote"; reads = 0; raceAfter = true;
    const afterRace = await post(payload("codeit", baseline)); assert.equal(afterRace.statusCode, 409); assert.match(afterRace.json().error, /may have changed/); assert.deepEqual(store.chatNameBaseline(chat.id), baseline);
    raceAfter = false; codexName = "Remote"; fail = true;
    const result = await post(payload("codeit", baseline)); assert.equal(result.statusCode, 503); assert.match(result.json().error, /may have changed/); assert(!result.body.includes("private-detail"));
    assert.deepEqual(store.chatNameBaseline(chat.id), baseline);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a concurrent Codex rename after the final read cannot be detected without provider CAS", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-name-cas-limit-")); const app = Fastify();
  try {
    const store = new Store(dir); const chat = store.chat(store.projects()[0].chats[0].id)!;
    const threadId = randomUUID(); store.setThread(chat, threadId); store.renameChat(chat.id, "Chosen by user");
    let codexName = "Earlier title"; let lateChangeOccurred = false;
    t.mock.method(CodexRpc.prototype, "connect", async () => {});
    t.mock.method(CodexRpc.prototype, "close", () => {});
    t.mock.method(CodexRpc.prototype, "request", async (method, params: any) => {
      if (method === "thread/read") return { thread: { id: threadId, name: codexName, status: { type: "idle" } } };
      codexName = "Concurrent change"; lateChangeOccurred = true;
      codexName = params.name; return {};
    });
    registerCodexNameSync(app, store, () => false);
    const result = await app.inject({ method: "POST", url: `/api/chats/${chat.id}/codex-name-sync`, payload: { threadId, codeitName: chat.name, codexName: "Earlier title", baseline: null, choice: "codeit", confirmed: true } });
    assert.equal(result.statusCode, 200); assert(lateChangeOccurred); assert.equal(codexName, "Chosen by user");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
