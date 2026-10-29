import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { Supervisor } from "../api/src/supervisor.js";
import { SupervisorStore } from "../api/src/supervisor-store.js";

test("supervisor preserves input, resumes its thread, records approvals and recovers", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-supervisor-test-"));
  const settings = { folder: dir, sandbox: "read-only" as const, approvalPolicy: "untrusted" as const };
  let rpc: CodexRpc; const inputs: string[] = []; const methods: string[] = [];
  t.mock.method(CodexRpc.prototype, "connect", async function () { rpc = this; });
  t.mock.method(CodexRpc.prototype, "close", function () {});
  t.mock.method(CodexRpc.prototype, "respond", function () {});
  t.mock.method(CodexRpc.prototype, "request", async function (method, params: any) {
    methods.push(method);
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "supervisor-thread" }, cwd: dir, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "untrusted" };
    inputs.push(params.input[0].text); return {};
  });
  try {
    const store = new SupervisorStore(dir); const supervisor = new Supervisor(store);
    supervisor.send("project", "  original idea\n", settings);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(inputs[0], "  original idea\n");
    rpc!.onEvent({ id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "supervisor-thread", command: "example" } });
    const approval = supervisor.get("project").approval!;
    supervisor.decide("project", approval.id, "decline");
    rpc!.onEvent({ method: "item/agentMessage/delta", params: { threadId: "supervisor-thread", delta: "First " } });
    rpc!.onEvent({ method: "item/agentMessage/delta", params: { threadId: "supervisor-thread", delta: "conclusion" } });
    rpc!.onEvent({ method: "turn/completed", params: { threadId: "supervisor-thread", turn: { status: "completed" } } });
    assert.equal(supervisor.get("project").events.find((event) => event.type === "assistant")?.text, "First conclusion");
    const reopened = new Supervisor(new SupervisorStore(dir));
    reopened.send("project", "follow up", settings);
    await new Promise((resolve) => setImmediate(resolve));
    assert(methods.includes("thread/resume"));
    assert.equal(inputs[1], "follow up");
    reopened.close();
    const recovered = new SupervisorStore(dir).get("project");
    assert.equal(recovered.status, "interrupted");
    assert(recovered.events.some((event) => event.type === "approval_decision" && event.text.includes("decline")));
    assert.throws(() => reopened.send("project", "change", { ...settings, approvalPolicy: "on-request" }), /original settings/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
