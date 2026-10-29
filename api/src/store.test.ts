import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { DocumentRepository } from "./storage.js";

test("batches deltas, preserves order, and flushes on completion and shutdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-store-test-"));
  try {
    const store = new Store(dir);
    const chat = store.chat(store.projects()[0].chats[0].id)!;
    store.append(chat, { type: "user", text: "  unchanged  ", attachments: [{ content: "x".repeat(1024 * 1024) }] });
    const before = JSON.stringify(new DocumentRepository("projects", dir).read());
    for (let i = 0; i < 100; i++) store.append(chat, { type: "delta", delta: String(i) });
    assert.equal(JSON.stringify(new DocumentRepository("projects", dir).read()), before);
    store.append(chat, { type: "finished", status: "completed" });
    const loaded = new Store(dir).chat(chat.id)!;
    assert.equal(loaded.events.length, 102);
    assert.equal(loaded.events[0].text, "  unchanged  ");
    assert.equal(loaded.events[100].delta, "99");
    store.append(chat, { type: "delta", delta: "pending" });
    store.flush();
    assert.equal(new Store(dir).chat(chat.id)!.events.at(-1)?.delta, "pending");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("saves a pending delta after the batching interval", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-store-timer-"));
  try {
    const store = new Store(dir);
    const chat = store.chat(store.projects()[0].chats[0].id)!;
    store.append(chat, { type: "delta", delta: "streamed" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(new Store(dir).chat(chat.id)!.events[0].delta, "streamed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("archives, restores, and permanently deletes chats across reloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-store-archive-"));
  try {
    const store = new Store(dir);
    const chat = store.chat(store.projects()[0].chats[0].id)!;
    store.append(chat, { type: "user", text: "saved conversation" });
    assert.equal(store.archiveChat(chat.id, true), true);
    const reloaded = new Store(dir);
    assert.equal(reloaded.projects()[0].chats[0].archived, true);
    assert.equal(reloaded.chat(chat.id)?.events[0].text, "saved conversation");
    assert.equal(reloaded.archiveChat(chat.id, false), true);
    assert.equal(new Store(dir).projects()[0].chats[0].archived, false);
    assert.equal(reloaded.deleteChat(chat.id), true);
    assert.equal(new Store(dir).chat(chat.id), undefined);
    assert.equal(reloaded.deleteChat(chat.id), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
