import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Chat } from "../api/src/chat.js";
import { CodexRpc } from "../api/src/codex-rpc.js";
import { Store } from "../api/src/store.js";

function setup(t: import("node:test").TestContext, dir: string, start?: (rpc: CodexRpc) => unknown) {
  let rpc: CodexRpc | undefined;
  let closes = 0;
  const responses: unknown[] = [];
  t.mock.method(CodexRpc.prototype, "connect", async function () { rpc = this; });
  t.mock.method(CodexRpc.prototype, "close", function () { closes++; });
  t.mock.method(CodexRpc.prototype, "respond", function (id, result) { responses.push({ id, result }); });
  t.mock.method(CodexRpc.prototype, "request", async function (method) {
    if (method === "model/list") return { data: [{ model: "mock", inputModalities: ["text"], supportedReasoningEfforts: [] }], nextCursor: null };
    if (method === "thread/start") return { thread: { id: "thread" }, cwd: dir, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "untrusted" };
    if (method === "turn/start") return start ? start(this) : { turn: { id: "turn-new" } };
    if (method === "thread/resume") {
      this.onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "thread", tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20, totalTokens: 120 } } } });
      return { thread: { id: "thread" }, cwd: dir, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "untrusted" };
    }
    return {};
  });
  const store = new Store(dir);
  const project = store.createProject("fixture", { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" });
  const id = store.createChat(project.id, "approval")!.id;
  const chat = new Chat(store, store.chat(id)!);
  const live: any[] = [];
  chat.subscribe((event) => live.push(event));
  return { store, chat, id, live, responses, getRpc: () => rpc!, closes: () => closes };
}

test("approval evidence links requests and decisions without persisting request secrets", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-chat-approval-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ id: 11, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn-new", command: "SECRET_FIXTURE" } });
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

test("early usage is matched after start and discarded on missing ID or failure", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-early-usage-"));
  let mode: "success" | "missing" | "failure" | "disconnect" = "success";
  const usage = { last: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, totalTokens: 13 } };
  try {
    const f = setup(t, dir, (rpc) => {
      for (const turnId of ["old", "new"]) rpc.onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "thread", turnId, tokenUsage: usage } });
      if (mode === "failure") rpc.onEvent({ id: 42, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "new" } });
      if (mode === "failure") throw new Error("start failed");
      if (mode === "disconnect") { rpc.onDisconnect("disconnected"); throw new Error("disconnected"); }
      return mode === "missing" ? {} : { turn: { id: "new" } };
    });
    const input = { text: "work", selection: { provider: "codex" as const, model: "mock" }, attachments: [] };
    await f.chat.send(input);
    const count = () => f.live.filter((event) => event.type === "notice" && event.text.startsWith("Codex reported latest usage:")).length;
    assert.equal(count(), 1);
    f.getRpc().onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { id: "new", status: "completed" } } });
    mode = "missing"; await assert.rejects(f.chat.send(input), /outcome is unknown/); assert.equal(count(), 1);
    mode = "failure"; const before = f.closes(); await assert.rejects(f.chat.send(input), /start failed/); assert.equal(count(), 1); assert.equal(f.closes(), before + 1);
    mode = "disconnect"; await assert.rejects(f.chat.send(input), /disconnected/); assert.equal(count(), 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("completion only closes the matching turn, including early completion", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-turn-identity-"));
  let sequence = 0;
  try {
    const f = setup(t, dir, (rpc) => {
      const id = `turn-${++sequence}`;
      if (sequence === 3) rpc.onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { id, status: "completed" } } });
      return { turn: { id } };
    });
    const input = { text: "work", selection: { provider: "codex" as const, model: "mock" }, attachments: [] };
    await f.chat.send(input);
    f.getRpc().onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn-1", status: "completed" } } });
    await f.chat.send(input);
    f.getRpc().onEvent({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn-1", itemId: "old", delta: "stale" } });
    f.getRpc().onEvent({ method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn-2", itemId: "new", delta: "current" } });
    assert(!f.live.some((event) => event.delta === "stale"));
    assert(f.live.some((event) => event.delta === "current"));
    f.getRpc().onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn-1", status: "completed" } } });
    f.getRpc().onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { status: "completed" } } });
    assert.equal(f.chat.isBusy(), true);
    f.getRpc().onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn-2", status: "completed" } } });
    assert.equal(f.chat.isBusy(), false);
    const timedUser = f.live.filter((event) => event.type === "user").at(-1);
    const timedEnd = f.live.filter((event) => event.type === "finished").at(-1);
    assert.equal(timedUser.turnKey, timedEnd.turnKey);
    assert.equal(typeof timedUser.startedAt, "string");
    assert.equal(typeof timedEnd.finishedAt, "string");
    assert.equal(f.live.find((event) => event.delta === "current").turnKey, timedUser.turnKey);
    await f.chat.send(input);
    assert.equal(f.chat.isBusy(), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("failure before a user event does not invent turn timing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-untimed-failure-"));
  try {
    const store = new Store(dir);
    const record = store.chat(store.projects()[0].chats[0].id)!;
    const chat = new Chat(store, record);
    await assert.rejects(chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] }), /folder and permissions/);
    const end = record.events.find((event) => event.type === "finished")!;
    assert.equal(end.turnKey, undefined);
    assert.equal(end.finishedAt, undefined);
    assert.equal(record.events.some((event) => event.type === "user"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("failed user-event persistence does not attach timing to a later failure", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-untimed-write-"));
  try {
    const f = setup(t, dir);
    const append = f.store.append.bind(f.store);
    t.mock.method(f.store, "append", (record, event) => {
      if (event.type === "user") throw new Error("write failed");
      append(record, event);
    });
    await assert.rejects(f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] }), /write failed/);
    const end = f.store.chat(f.id)!.events.find((event) => event.type === "finished")!;
    assert.equal(end.turnKey, undefined);
    assert.equal(end.finishedAt, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("only valid provider-reported usage is exposed for the active chat", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-usage-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    const usage = { last: { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20, totalTokens: 120 } };
    f.getRpc().onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "other", turnId: "turn-new", tokenUsage: usage } });
    f.getRpc().onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "thread", turnId: "turn-new", tokenUsage: { last: { inputTokens: -1 } } } });
    assert.equal(f.live.filter((event) => event.type === "notice" && event.text.startsWith("Codex reported latest usage:")).length, 0);
    f.getRpc().onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "thread", turnId: "turn-new", tokenUsage: usage } });
    assert.match(f.live.find((event) => event.type === "notice" && event.text.startsWith("Codex reported latest usage:")).text, /100 input tokens \(30 cached\), 20 output tokens, 120 total tokens/);
    f.getRpc().onEvent({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn-new", status: "completed" } } });
    await f.chat.send({ text: "follow-up", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ method: "thread/tokenUsage/updated", params: { threadId: "thread", turnId: "turn-old", tokenUsage: usage } });
    assert.equal(f.live.filter((event) => event.type === "notice" && event.text.startsWith("Codex reported latest usage:")).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("restart records pending approvals as interrupted without replaying controls", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-chat-interrupted-"));
  try {
    const f = setup(t, dir);
    await f.chat.send({ text: "work", selection: { provider: "codex", model: "mock" }, attachments: [] });
    f.getRpc().onEvent({ id: 12, method: "item/fileChange/requestApproval", params: { threadId: "thread", turnId: "turn-new", secret: "hidden" } });
    const id = f.live.find((event) => event.type === "approval").id;
    const reloaded = new Store(dir); const recovered = new Chat(reloaded, reloaded.chat(f.id)!);
    const interrupted = reloaded.chat(f.id)!.events.find((event) => event.type === "finished" && event.status === "interrupted");
    assert.equal(typeof interrupted?.interruptionObservedAt, "string");
    assert.equal(interrupted?.finishedAt, undefined);
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
    f.getRpc().onEvent({ id: 14, method: "item/fileChange/requestApproval", params: { threadId: "thread", turnId: "turn-new" } });
    const first = f.live.filter((event) => event.type === "approval").at(-1).id;
    f.getRpc().respond = () => { throw new Error("connection failed"); };
    assert.throws(() => f.chat.decide(first, "accept"), /connection failed/);
    f.getRpc().onEvent({ id: 15, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn-new" } });
    const second = f.live.filter((event) => event.type === "approval").at(-1).id;
    f.getRpc().onDisconnect("connection closed");
    const interruptedTurn = f.live.filter((event) => event.type === "finished").at(-1);
    assert.equal(interruptedTurn.finishedAt, undefined);
    assert.equal(typeof interruptedTurn.interruptionObservedAt, "string");
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
    f.getRpc().onEvent({ id: 16, method: "item/fileChange/requestApproval", params: { threadId: "thread", turnId: "turn-new" } });
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
    f.getRpc().onEvent({ id: 13, method: "item/commandExecution/requestApproval", params: { threadId: "thread", turnId: "turn-new" } });
    const id = f.live.find((event) => event.type === "approval").id;
    const other = new Store(dir); other.renameChat(f.id, "concurrent");
    assert.throws(() => f.chat.decide(id, "accept"), /Storage write failed/);
    assert.deepEqual(f.responses, []);
    const events = new Store(dir).chat(f.id)!.events.filter((event) => event.type === "approvalEvidence");
    assert.deepEqual(events.map((event) => event.stage), ["requested"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
