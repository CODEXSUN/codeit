import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { IdeasStore } from "../api/src/ideas-store.js";
import { DocumentRepository } from "../api/src/storage.js";
import Fastify from "fastify";
import { Store } from "../api/src/store.js";
import { registerIdeasRoutes } from "../api/src/ideas-routes.js";
import { registerLoopRoutes } from "../api/src/loop-routes.js";

test("ideas remain project-scoped, reject stale writes, and survive restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "codeit-ideas-"));
  try {
    const store = new IdeasStore(directory);
    const idea = store.create("first", "An idea", "**Markdown**");
    assert.equal(store.list("second").length, 0);
    const changed = store.update("first", idea.id, idea.revision, { stage: "exploring" });
    assert.throws(() => store.update("first", idea.id, idea.revision, { content: "stale" }), /changed/);
    assert.equal(new IdeasStore(directory).get("first", idea.id)?.content, "**Markdown**");
    assert.equal(new IdeasStore(directory).get("first", idea.id)?.stage, changed.stage);
    assert.equal(store.get("second", idea.id), undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("versioned Ideas migration validates before writing and rejects future versions", () => {
  const directory = mkdtempSync(join(tmpdir(), "codeit-ideas-migration-"));
  try {
    const repository = new DocumentRepository("ideas", directory);
    repository.read();
    repository.write({ version: 0, projects: {} });
    assert.deepEqual(new IdeasStore(directory).list("project"), []);
    assert.equal((new DocumentRepository("ideas", directory).read() as { version: number }).version, 1);
    const unsupported = new DocumentRepository("ideas", directory);
    unsupported.read(); unsupported.write({ version: 2, projects: {} });
    assert.throws(() => new IdeasStore(directory), /Unsupported Ideas document version/);
    assert.equal((new DocumentRepository("ideas", directory).read() as { version: number }).version, 2);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("idea API scopes records and hands off only into empty project work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codeit-ideas-api-"));
  const previous = process.env.CODEIT_DATA_DIR;
  process.env.CODEIT_DATA_DIR = directory;
  const store = new Store(directory);
  const settings = { folder: directory, sandbox: "read-only" as const, approvalPolicy: "untrusted" as const };
  const project = store.createProject("first", settings);
  const other = store.createProject("second", settings);
  const app = Fastify();
  registerIdeasRoutes(app, store);
  registerLoopRoutes(app, store);
  const base = `/api/projects/${project.id}`;
  try {
    const created = await app.inject({ method: "POST", url: `${base}/ideas`, payload: { title: "Title", content: "Body" } });
    assert.equal(created.statusCode, 200);
    const idea = created.json();
    const foreign = await app.inject({ method: "GET", url: `/api/projects/${other.id}/ideas/${idea.id}` });
    assert.equal(foreign.statusCode, 409);
    const handoff = await app.inject({ method: "POST", url: `${base}/loop/idea/from-saved`, payload: { ideaId: idea.id } });
    assert.equal(handoff.statusCode, 200);
    assert.equal(handoff.json().idea.ideaId, idea.id);
    assert.equal(handoff.json().idea.original, "Body");
    const edited = await app.inject({ method: "PUT", url: `${base}/loop/idea`, payload: { original: "Edited copy", refined: "" } });
    assert.equal(edited.json().idea.ideaId, idea.id);
    assert.equal((await app.inject({ method: "POST", url: `${base}/loop/idea/from-saved`, payload: { ideaId: idea.id } })).statusCode, 409);
    const stale = await app.inject({ method: "POST", url: `${base}/ideas/${idea.id}/stage`, payload: { revision: 2, stage: "ready" } });
    assert.equal(stale.statusCode, 409);
    assert.equal((await app.inject({ method: "GET", url: `${base}/ideas/${idea.id}` })).json().content, "Body");
    const longIdea = (await app.inject({ method: "POST", url: `/api/projects/${other.id}/ideas`, payload: { title: "Long", content: "x".repeat(20_001) } })).json();
    const tooLong = await app.inject({ method: "POST", url: `/api/projects/${other.id}/loop/idea/from-saved`, payload: { ideaId: longIdea.id } });
    assert.equal(tooLong.statusCode, 409);
    assert.match(tooLong.json().error, /20,000/);
    const blank = (await app.inject({ method: "POST", url: `/api/projects/${other.id}/ideas`, payload: { title: "Fallback title", content: "  \n " } })).json();
    const fallback = await app.inject({ method: "POST", url: `/api/projects/${other.id}/loop/idea/from-saved`, payload: { ideaId: blank.id } });
    assert.equal(fallback.json().idea.original, "Fallback title");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.CODEIT_DATA_DIR; else process.env.CODEIT_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
