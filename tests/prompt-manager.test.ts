import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { PromptManager } from "../api/src/prompt-manager.js";

test("prompt revisions are scoped, append-only, idempotent, and survive restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "codeit-prompts-"));
  try {
    const prompts = new PromptManager(directory);
    const input = { projectId: "one", requestId: "request-1", source: "chat" as const, chatId: "chat-1", text: "first" };
    const reference = prompts.capture(input);
    assert.equal(prompts.capture(input), reference);
    assert.deepEqual(prompts.claim(input), { reference, created: false });
    assert.throws(() => prompts.capture({ ...input, text: "different" }), /Request ID/);
    assert.notEqual(prompts.capture({ ...input, requestId: "request-2" }), reference);
    const attachment = { name: "sample.txt", kind: "text" as const, content: "sensitive sample" };
    const withAttachment = { ...input, requestId: "attachment", attachments: [attachment] };
    const attachedReference = prompts.capture(withAttachment);
    assert.deepEqual(prompts.show("one", attachedReference)?.attachments, [attachment]);
    assert.throws(() => prompts.capture({ ...withAttachment, attachments: [{ ...attachment, content: "changed" }] }), /Request ID/);
    assert.equal(prompts.revise("one", reference, 1, "second"), 2);
    assert.equal(prompts.revise("one", reference, 2, "second"), 2);
    assert.throws(() => prompts.revise("one", reference, 1, "lost"), /revision changed/);
    assert.equal(prompts.show("two", reference), undefined);
    assert.equal(prompts.revise("two", reference, 2, "other"), undefined);
    assert.equal(prompts.list("two").length, 0);
    assert.deepEqual(new PromptManager(directory).show("one", reference)?.revisions.map((item) => item.text), ["first", "second"]);
    assert.throws(() => prompts.capture({ ...input, source: "unknown" as never }));
    const db = new DatabaseSync(join(directory, "codeit.sqlite"));
    try { assert.throws(() => db.prepare("DELETE FROM prompt_revisions WHERE reference = ?").run(reference), /append-only/); }
    finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("populated version 1 prompt database migrates without changing history", () => {
  const directory = mkdtempSync(join(tmpdir(), "codeit-prompt-v1-"));
  try {
    const initial = new PromptManager(directory);
    const reference = initial.capture({ projectId: "old", requestId: "old-request", source: "chat", text: "preserved" });
    const db = new DatabaseSync(join(directory, "codeit.sqlite"));
    try {
      db.exec("DROP TRIGGER prompt_records_no_update; ALTER TABLE prompt_records DROP COLUMN attachments; UPDATE prompt_schema SET version = 1");
    } finally { db.close(); }
    const migrated = new PromptManager(directory);
    assert.equal(migrated.show("old", reference)?.revisions[0].text, "preserved");
    assert.deepEqual(migrated.show("old", reference)?.attachments, []);
    assert.deepEqual(migrated.claim({ projectId: "old", requestId: "old-request", source: "chat", text: "preserved" }), { reference, created: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
