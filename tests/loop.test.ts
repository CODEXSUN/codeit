import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { Store } from "../api/src/store.js";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { registerLoopRoutes } from "../api/src/loop-routes.js";
import { PromptManager } from "../api/src/prompt-manager.js";
import { reviewEvidence } from "../api/src/review-evidence.js";

test("review evidence removes only an exact repeated agent message", () => {
  const run = { id: "run", kind: "worker" as const, status: "completed" as const, events: [
    { type: "response", text: "verified " }, { type: "response", text: "result" },
    { type: "item", text: JSON.stringify({ type: "agentMessage", id: "a", text: "verified result" }) },
    { type: "item", text: JSON.stringify({ type: "agentMessage", id: "b", text: "other evidence" }) },
  ] };
  const result = reviewEvidence(run);
  assert.equal(result.split("verified result").length - 1, 1);
  assert.match(result, /other evidence/);
  assert.match(result, /"id":"a"/);
  assert.equal(run.events[2].text.includes("verified result"), true);
  const longRun = { ...run, events: [run.events[0], run.events[1], { type: "item", text: "x".repeat(80_010) }, run.events[2]] };
  assert.match(reviewEvidence(longRun), /verified result/);
  const reverseRun = { ...run, events: [run.events[2], { type: "item", text: "x".repeat(80_010) }, run.events[0], run.events[1]] };
  assert.match(reviewEvidence(reverseRun), /verified result/);
  const boundary = { ...run, events: [{ type: "response", text: "x".repeat(80_000) }] };
  assert.equal(reviewEvidence(boundary).length, 80_000);
  assert.equal(reviewEvidence({ ...boundary, events: [{ type: "response", text: "x".repeat(80_001) }] }).length, 80_001);
});

test("explicit approval, worker, review, iteration and restart use project-scoped data", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-loop-test-"));
  const previous = process.env.CODEIT_DATA_DIR;
  process.env.CODEIT_DATA_DIR = dir;
  const projectStore = new Store(dir);
  const project = projectStore.createProject("fixture", { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" });
  const app = Fastify();
  registerLoopRoutes(app, projectStore).setPromptManager(new PromptManager(dir));
  let rpc: CodexRpc | undefined;
  let prompt = "";
  t.mock.method(CodexRpc.prototype, "connect", async function () { rpc = this; });
  t.mock.method(CodexRpc.prototype, "close", function () {});
  t.mock.method(CodexRpc.prototype, "respond", function () {});
  t.mock.method(CodexRpc.prototype, "request", async function (method, params: any) {
    if (method === "thread/start") return { thread: { id: "thread" }, cwd: dir, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "untrusted" };
    prompt = params.input[0].text;
    return {};
  });
  const base = `/api/projects/${project.id}/loop`;
  async function call(method: "GET" | "PUT" | "POST", path: string, payload?: unknown) {
    return app.inject({ method, url: base + path, payload });
  }
  try {
    assert.equal((await call("PUT", "/idea", { original: "  idea  ", refined: "" })).statusCode, 200);
    let result = await call("PUT", "/plan", { summary: "Plan", criteria: ["Check it"], tasks: [{ title: "First", description: "Do it", dependencies: [] }, { title: "Second", description: "Then do it", dependencies: ["0"] }] });
    const [first, second] = result.json().tasks;
    assert.equal((await call("PUT", "/plan", { summary: "Replacement", criteria: ["Check it"], tasks: [{ title: "New", description: "Do it", dependencies: [] }] })).statusCode, 409);
    assert.equal((await call("PUT", "/idea", { original: "Replacement", refined: "" })).statusCode, 409);
    assert.equal((await call("GET", "")).json().plan.summary, "Plan");
    assert.equal((await call("POST", `/tasks/${first.id}/start`, {})).statusCode, 409);
    assert.equal((await call("POST", "/approve", {})).statusCode, 200);
    assert.equal((await call("POST", `/tasks/${second.id}/start`, {})).statusCode, 409);
    assert.equal((await call("POST", `/tasks/${first.id}/start`, {})).statusCode, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(prompt, /  idea  /);
    assert.equal((await call("POST", `/tasks/${first.id}/start`, {})).statusCode, 409);
    rpc!.onEvent({ method: "item/commandExecution/requestApproval", id: 7, params: { threadId: "thread", command: "example" } });
    result = await call("GET", "");
    const approval = result.json().active.approval.id;
    assert.equal((await call("POST", `/approvals/${approval}`, { decision: "decline" })).statusCode, 200);
    rpc!.onEvent({ method: "item/agentMessage/delta", params: { threadId: "thread", delta: "worker evidence" } });
    rpc!.onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { status: "completed" } } });
    assert.equal((await call("POST", `/tasks/${first.id}/review`, {})).statusCode, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(prompt, /worker evidence/);
    const audited = new PromptManager(dir).list(project.id);
    assert.equal(audited.filter((entry) => entry.source === "worker").length, 1);
    assert.equal(audited.filter((entry) => entry.source === "review").length, 1);
    rpc!.onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { status: "completed" } } });
    assert.equal((await call("POST", `/tasks/${first.id}/resolve`, { decision: "changes_requested", findings: "" })).statusCode, 409);
    assert.equal((await call("POST", `/tasks/${first.id}/resolve`, { decision: "changes_requested", findings: "Fix the issue" })).statusCode, 200);
    assert.equal((await call("POST", `/tasks/${first.id}/start`, {})).statusCode, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(prompt, /Fix the issue/);
    rpc!.onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { status: "completed" } } });
    await app.close();
    const reopened = Fastify(); registerLoopRoutes(reopened, new Store(dir));
    result = await reopened.inject({ method: "GET", url: base });
    assert.equal(result.json().idea.original, "  idea  ");
    assert.equal(result.json().tasks[0].status, "needs_review");
    assert(result.json().tasks[0].runs[0].events.some((event: any) => event.type === "approval_decision"));
    await reopened.close();
  } finally {
    if (previous === undefined) delete process.env.CODEIT_DATA_DIR; else process.env.CODEIT_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
