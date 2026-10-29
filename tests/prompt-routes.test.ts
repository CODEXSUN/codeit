import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import Fastify from "fastify";
import { PromptManager } from "../api/src/prompt-manager.js";
import { registerPromptRoutes } from "../api/src/prompt-routes.js";
import { Store } from "../api/src/store.js";

test("prompt routes validate revisions and enforce project scope", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codeit-prompt-routes-"));
  const app = Fastify();
  try {
    const store = new Store(directory);
    const project = store.projects()[0];
    const prompts = new PromptManager(directory);
    const ref = prompts.capture({ projectId: project.id, requestId: "one", source: "chat", text: "raw" });
    registerPromptRoutes(app, store, prompts);
    const base = `/api/projects/${project.id}/prompts`;
    assert.equal((await app.inject({ method: "GET", url: `${base}/${ref}` })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: `${base}/0` })).statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url: `/api/projects/missing/prompts/${ref}` })).statusCode, 404);
    assert.equal((await app.inject({ method: "PUT", url: `${base}/${ref}`, payload: { revision: 1, text: "updated", secret: "no" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "PUT", url: `${base}/${ref}`, payload: { revision: 1, text: "updated" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "PUT", url: `${base}/${ref}`, payload: { revision: 1, text: "conflict" } })).statusCode, 409);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
