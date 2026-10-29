import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { registerLoopRoutes } from "../api/src/loop-routes.js";
import { PromptManager } from "../api/src/prompt-manager.js";
import { Store } from "../api/src/store.js";
import { LoopStore } from "../api/src/loop-store.js";

test("manual review follows a failed model review and preserves evidence across restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-manual-review-"));
  const previous = process.env.CODEIT_DATA_DIR;
  process.env.CODEIT_DATA_DIR = dir;
  const projects = new Store(dir);
  const settings = { folder: dir, sandbox: "read-only" as const, approvalPolicy: "untrusted" as const };
  const project = projects.createProject("fixture", settings);
  let rpc: CodexRpc; let turn = 0;
  t.mock.method(CodexRpc.prototype, "connect", async function () { rpc = this; });
  t.mock.method(CodexRpc.prototype, "close", function () {});
  t.mock.method(CodexRpc.prototype, "request", async function (method) {
    if (method === "thread/start") return { thread: { id: "thread" }, cwd: dir, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "untrusted" };
    if (method === "turn/start" && ++turn === 2) throw new Error("Context limit exceeded");
    return {};
  });
  const base = `/api/projects/${project.id}/loop`;
  let app = Fastify(); registerLoopRoutes(app, projects).setPromptManager(new PromptManager(dir));
  const call = (method: "GET" | "PUT" | "POST", path: string, payload?: unknown) => app.inject({ method, url: base + path, payload });
  try {
    await call("PUT", "/idea", { original: "idea", refined: "" });
    const plan = await call("PUT", "/plan", { summary: "plan", criteria: ["criterion"], tasks: [{ title: "task", description: "work", dependencies: [] }] });
    const taskId = plan.json().tasks[0].id;
    const path = `/tasks/${taskId}`;
    await call("POST", "/approve", {});
    await call("POST", `${path}/start`, {});
    await new Promise((resolve) => setImmediate(resolve));
    const evidence = "worker evidence ".repeat(6000);
    rpc!.onEvent({ method: "item/agentMessage/delta", params: { threadId: "thread", delta: evidence } });
    rpc!.onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { status: "completed" } } });
    let state = (await call("GET", "")).json();
    const workerId = state.tasks[0].runs[0].id;
    assert.equal((await call("POST", `${path}/review`, {})).statusCode, 200);
    await new Promise((resolve) => setImmediate(resolve));
    state = (await call("GET", "")).json();
    assert.equal(state.tasks[0].status, "needs_review");
    assert.equal(state.tasks[0].runs[1].status, "failed");
    const input = { workerRunId: workerId, reviewer: "Reviewer", scope: "Full worker output", omissions: "None", findings: "No issues", confirmed: true };
    assert.equal((await call("POST", `${path}/manual-review`, { ...input, workerRunId: "other" })).statusCode, 409);
    assert.equal((await call("POST", `${path}/manual-review`, { ...input, omissions: "" })).statusCode, 409);
    assert.equal((await call("POST", `${path}/manual-review`, { ...input, confirmed: false })).statusCode, 409);
    projects.updateProjectSettings(project.id, { ...settings, approvalPolicy: "on-request" });
    assert.equal((await call("POST", `${path}/manual-review`, input)).statusCode, 409);
    projects.updateProjectSettings(project.id, settings);
    state = (await call("POST", `${path}/manual-review`, input)).json();
    assert.equal(state.tasks[0].status, "reviewing");
    assert.equal(state.tasks[0].runs.at(-1).kind, "manual_review");
    assert.equal(state.tasks[0].runs[0].events.find((event: any) => event.type === "response").text, evidence);
    await app.close();
    app = Fastify(); const restartedProjects = new Store(dir); registerLoopRoutes(app, restartedProjects);
    state = (await call("GET", "")).json();
    const review = state.tasks[0].runs.at(-1).manualReview;
    assert.equal(review.workerRunId, workerId); assert.equal(review.reviewer, "Reviewer");
    assert.equal(review.omissions, "None"); assert.equal(review.scope, "Full worker output");
    assert.equal(review.findings, "No issues"); assert.equal(review.approvedSettings.folder, dir);
    assert(!Number.isNaN(Date.parse(review.reviewedAt)));
    restartedProjects.updateProjectSettings(project.id, { ...settings, approvalPolicy: "on-request" });
    assert.equal((await call("POST", `${path}/resolve`, { decision: "accept", findings: "" })).statusCode, 409);
    restartedProjects.updateProjectSettings(project.id, settings);
    assert.equal((await call("POST", `${path}/resolve`, { decision: "changes_requested", findings: "" })).statusCode, 409);
    state = (await call("POST", `${path}/resolve`, { decision: "accept", findings: "accepted by user" })).json();
    assert.equal(state.tasks[0].status, "accepted");
    assert.equal(state.tasks[0].runs.at(-1).manualReview.resolution.decision, "accept");
    assert(!Number.isNaN(Date.parse(state.tasks[0].runs.at(-1).manualReview.resolution.decidedAt)));
    assert.equal((await call("POST", `${path}/resolve`, { decision: "accept", findings: "" })).statusCode, 409);
    assert.equal(state.tasks[0].runs[0].events.find((event: any) => event.type === "response").text, evidence);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.CODEIT_DATA_DIR; else process.env.CODEIT_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manual review can request changes and keeps its recorded decision", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-manual-changes-"));
  const previous = process.env.CODEIT_DATA_DIR;
  process.env.CODEIT_DATA_DIR = dir;
  const settings = { folder: dir, sandbox: "read-only" as const, approvalPolicy: "untrusted" as const };
  const projects = new Store(dir); const project = projects.createProject("fixture", settings);
  const setup = new LoopStore(dir); const state = setup.get(project.id);
  state.idea = { original: "idea", refined: "" };
  state.plan = { summary: "plan", criteria: ["ok"], approved: true, approvedSettings: settings };
  state.tasks = [{ id: "task", title: "task", description: "work", dependencies: [], status: "needs_review", runs: [{ id: "worker", kind: "worker", status: "completed", events: [{ type: "response", text: "evidence" }] }] }];
  setup.save();
  const app = Fastify(); registerLoopRoutes(app, projects).setPromptManager(new PromptManager(dir));
  const base = `/api/projects/${project.id}/loop/tasks/task`;
  try {
    const input = { workerRunId: "worker", reviewer: "Reviewer", scope: "all", omissions: "none", findings: "fix issue", confirmed: true };
    assert.equal((await app.inject({ method: "POST", url: `${base}/manual-review`, payload: input })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `${base}/manual-review`, payload: input })).statusCode, 409);
    const response = await app.inject({ method: "POST", url: `${base}/resolve`, payload: { decision: "changes_requested", findings: "fix issue" } });
    assert.equal(response.statusCode, 200);
    const task = response.json().tasks[0];
    assert.equal(task.status, "changes_requested");
    assert.equal(task.runs[0].events[0].text, "evidence");
    assert.equal(task.runs.at(-1).manualReview.resolution.decision, "changes_requested");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.CODEIT_DATA_DIR; else process.env.CODEIT_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
