import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Chat } from "../api/src/chat.js";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { Store } from "../api/src/store.js";

function setup(t: import("node:test").TestContext, dir: string) {
  let rpc: CodexRpc | undefined;
  const responses: unknown[] = [];
  t.mock.method(CodexRpc.prototype, "connect", async function () { rpc = this; });
  t.mock.method(CodexRpc.prototype, "close", function () {});
  t.mock.method(CodexRpc.prototype, "respond", function (id, result) { responses.push({ id, result }); });
  t.mock.method(CodexRpc.prototype, "request", async function (method) {
    if (method === "model/list") return { data: [{ model: "mock", inputModalities: ["text"], supportedReasoningEfforts: [] }], nextCursor: null };
    if (method === "thread/start") return { thread: { id: "thread" }, cwd: dir, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "untrusted" };
    return {};
  });
  const store = new Store(dir);
  const project = store.createProject("fixture", { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" });
  const id = store.createChat(project.id, "approval")!.id;
  const chat = new Chat(store, store.chat(id)!);
  const live: any[] = [];
  chat.subscribe((event) => live.push(event));
  return { store, chat, id, live, responses, getRpc: () => rpc! };
}

test("approval evidence links requests and decisions without persisting request secrets", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-chat-approval-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ id: 11, method: "item/commandExecution/requestApproval", params: { threadId: "thread", command: "SECRET_FIXTURE" } });
    const approval = f.live.find((event) => event.type === "approval");
    assert.equal(approval.params.command, "SECRET_FIXTURE");
    f.chat.decide(approval.id, "decline");
    assert.deepEqual(f.responses, [{ id: 11, result: { decision: "decline" } }]);
    const events = new Store(dir).chat(f.id)!.events.filter((event) => event.type === "approvalEvidence");
    assert.deepEqual(events.map((event) => event.stage), ["requested", "decision", "response_queued"]);
    assert(events.every((event) => event.id === approval.id));
    assert.equal(events[0].method, "item/commandExecution/requestApproval");
    assert.equal(events[1].decision, "decline");
    assert(!JSON.stringify(events).includes("SECRET_FIXTURE"));
    assert.throws(() => f.chat.decide(approval.id, "accept"), /no longer pending/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("only valid provider-reported usage is exposed for the active chat", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-usage-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    const usage = { last: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20, totalTokens: 120 } };
    f.getRpc().onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "other", tokenUsage: usage } });
    f.getRpc().onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "thread", tokenUsage: { last: { inputTokens: -1 } } } });
    assert.equal(f.live.filter((event) => event.type === "notice" && event.text.startsWith("Codex reported latest usage:")).length, 0);
    f.getRpc().onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "thread", tokenUsage: usage } });
    assert.match(f.live.find((event) => event.type === "notice" && event.text.startsWith("Codex reported latest usage:")).text, /100 input tokens \(30 cached\), 20 output tokens, 120 total tokens/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("restart records pending approvals as interrupted without replaying controls", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-chat-interrupted-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ id: 12, method: "item/fileChange/requestApproval", params: { threadId: "thread", secret: "hidden" } });
    const id = f.live.find((event) => event.type === "approval").id;
    const reloaded = new Store(dir); const recovered = new Chat(reloaded, reloaded.chat(f.id)!);
    assert(reloaded.chat(f.id)!.events.some((event) => event.type === "approvalEvidence" && event.id === id && event.stage === "interrupted" && event.reason === "restart"));
    assert.throws(() => recovered.decide(id, "accept"), /no longer pending/);
    assert.equal(new Store(dir).chat(f.id)!.events.filter((event) => event.type === "approvalEvidence" && event.id === id && event.stage === "interrupted").length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("disconnect and response failure record interruption without claiming delivery", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-chat-disconnect-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ id: 14, method: "item/fileChange/requestApproval", params: { threadId: "thread" } });
    const first = f.live.filter((event) => event.type === "approval").at(-1).id;
    f.getRpc().respond = () => { throw new Error("connection failed"); };
    assert.throws(() => f.chat.decide(first, "accept"), /connection failed/);
    f.getRpc().onEvent({ id: 15, method: "item/commandExecution/requestApproval", params: { threadId: "thread" } });
    const second = f.live.filter((event) => event.type === "approval").at(-1).id;
    f.getRpc().onDisconnect("connection closed");
    const events = new Store(dir).chat(f.id)!.events.filter((event) => event.type === "approvalEvidence");
    assert.deepEqual(events.filter((event) => event.id === first).map((event) => event.stage), ["requested", "decision", "interrupted"]);
    assert.equal(events.find((event) => event.id === first && event.stage === "interrupted")?.reason, "response_failed");
    assert.equal(events.find((event) => event.id === second && event.stage === "interrupted")?.reason, "disconnected");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("restart marks a recorded decision with unknown delivery", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-chat-decision-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ id: 16, method: "item/fileChange/requestApproval", params: { threadId: "thread" } });
    const id = f.live.find((event) => event.type === "approval").id;
    f.store.append(f.store.chat(f.id)!, { type: "approvalEvidence", id, stage: "decision", decision: "accept" });
    const reloaded = new Store(dir); new Chat(reloaded, reloaded.chat(f.id)!);
    assert(reloaded.chat(f.id)!.events.some((event) => event.type === "approvalEvidence" && event.id === id && event.stage === "interrupted" && event.reason === "delivery_unknown"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a failed durable decision never sends the approval response", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-chat-failed-"));
  t.mock.method(console, "error", () => {});
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ id: 13, method: "item/commandExecution/requestApproval", params: { threadId: "thread" } });
    const id = f.live.find((event) => event.type === "approval").id;
    const other = new Store(dir); other.renameChat(f.id, "concurrent");
    assert.throws(() => f.chat.decide(id, "accept"), /Storage write failed/);
    assert.deepEqual(f.responses, []);
    const events = new Store(dir).chat(f.id)!.events.filter((event) => event.type === "approvalEvidence");
    assert.deepEqual(events.map((event) => event.stage), ["requested"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
