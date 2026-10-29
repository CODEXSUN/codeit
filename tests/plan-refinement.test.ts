import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import Fastify from "fastify";
import { Store } from "../api/src/store.js";
import { registerPlanRefinement } from "../api/src/plan-refinement.js";
import { PromptManager } from "../api/src/prompt-manager.js";
import { randomUUID } from "node:crypto";

test("plan refinement is explicit, validates provider and does not persist output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-plan-refine-"));
  const store = new Store(dir);
  const project = store.createProject("test", { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" });
  let called = 0;
  const app = Fastify();
  const prompts = new PromptManager(dir);
  registerPlanRefinement(app, store, prompts, {
    codexStatus: async () => ({ available: true, models: [{ model: "test", displayName: "Test", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }], inputModalities: ["text"] }] }),
    refinePrompt: async () => { called++; return "Proposed plan"; },
  });
  try {
    const url = `/api/projects/${project.id}/loop/refine-plan`;
    const selection = { provider: "codex", model: "test", effort: "low" };
    const requestId = randomUUID();
    assert.equal((await app.inject({ method: "POST", url, payload: { text: "Original", requestId, selection: { ...selection, model: "missing" } } })).statusCode, 502);
    assert.equal(called, 0);
    const result = await app.inject({ method: "POST", url, payload: { text: "Original", selection, requestId } });
    assert.equal(result.json().text, "Proposed plan");
    assert.equal(called, 1);
    assert.equal((await app.inject({ method: "POST", url, payload: { text: "Original", selection, requestId } })).statusCode, 409);
    assert.equal((await app.inject({ method: "POST", url, payload: { text: "Different", selection, requestId } })).statusCode, 409);
    assert.equal(called, 1);
    const records = prompts.list(project.id);
    assert.equal(records.length, 1);
    assert.match(String(prompts.show(project.id, Number(records[0].reference))?.revisions[0].text), /Original/);
    assert.equal((await app.inject({ method: "POST", url: "/api/projects/missing/loop/refine-plan", payload: { text: "Original", selection, requestId } })).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("provider failure returns a safe error and no generated result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-plan-failure-"));
  const store = new Store(dir);
  const project = store.createProject("test", { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" });
  const app = Fastify();
  registerPlanRefinement(app, store, new PromptManager(dir), {
    codexStatus: async () => ({ available: true, models: [{ model: "test", displayName: "Test", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }], inputModalities: ["text"] }] }),
    refinePrompt: async () => { throw new Error("private provider details"); },
  });
  try {
    const result = await app.inject({ method: "POST", url: `/api/projects/${project.id}/loop/refine-plan`, payload: { text: "Original", requestId: randomUUID(), selection: { provider: "codex", model: "test" } } });
    assert.equal(result.statusCode, 502);
    assert.doesNotMatch(result.body, /private provider details|Original/);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
