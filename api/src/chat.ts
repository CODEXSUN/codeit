import { randomUUID } from "node:crypto";
import { CodexRpc, type RpcMessage } from "./codex-rpc.js";
import { Store, type StoredChat } from "./store.js";
import type { MessageInput } from "./message-input.js";
import { validateSelection, type CodexModel } from "./providers.js";
import { threadOptions, verifyThreadOptions } from "./project-settings.js";
import { GeminiClient } from "./gemini.js";
import { StorageError } from "./storage.js";
import { z } from "zod";

type Event = Record<string, unknown> & { type: string };
type Approval = { rpcId: string | number; event: Event };
type TurnCompletion = { id: string; status?: string; error?: { message?: string } };
const usageSchema = z.object({ last: z.object({ inputTokens: z.number().int().nonnegative(), cachedInputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }) });

export class Chat {
  private readonly rpc = new CodexRpc();
  private threadId?: string;
  private busy = false;
  private activeProvider?: "codex" | "gemini";
  private turnStarted = false;
  private activeTurnId?: string;
  private turnStartResolved = false;
  private pendingUsage: { turnId: string; usage: z.infer<typeof usageSchema>["last"] }[] = [];
  private pendingCompletions = new Map<string, TurnCompletion>();
  private pendingTurnEvents: RpcMessage[] = [];
  private turnKey?: string;
  private needsResume = false;
  private approvals = new Map<string, Approval>();
  private listeners = new Set<(event: Event) => void>();
  private connection: "connecting" | "connected" | "disconnected" = "connecting";

  constructor(private readonly store: Store, private readonly record: StoredChat) {
    this.threadId = record.threadId;
    this.needsResume = Boolean(record.threadId);
    this.recoverApprovals();
    const lastTurn = [...record.events].reverse().find((event) => event.type === "user" || event.type === "finished");
    if (lastTurn?.type === "user") this.store.append(record, { type: "finished", status: "interrupted", error: "Codeit stopped before this turn completed.", ...(typeof lastTurn.turnKey === "string" ? { turnKey: lastTurn.turnKey, interruptionObservedAt: new Date().toISOString() } : {}) });
    this.rpc.onEvent = (message) => { try { this.receive(message); } catch (error) { if (!(error instanceof StorageError)) throw error; } };
    this.rpc.onDisconnect = (message) => {
      try {
      this.setConnection("disconnected");
      this.interruptApprovals("disconnected");
      if (this.busy && this.activeProvider === "codex") { this.emit({ type: "finished", status: "interrupted", error: message }); this.busy = false; this.activeProvider = undefined; }
      this.needsResume = Boolean(this.threadId);
      this.emit({ type: "error", message });
      } catch (error) { if (!(error instanceof StorageError)) throw error; }
    };
  }

  subscribe(listener: (event: Event) => void) {
    this.listeners.add(listener);
    for (const event of this.record.events) listener(event);
    for (const approval of this.approvals.values()) listener(approval.event);
    listener({ type: "ready", busy: this.busy });
    listener({ type: "connection", status: this.connection });
    void this.connect().catch(() => {});
    return () => this.listeners.delete(listener);
  }

  provider(): "codex" | "gemini" | undefined { return this.record.threadId ? "codex" : this.record.geminiHistory?.length ? "gemini" : undefined; }

  async models(): Promise<CodexModel[]> {
    await this.connect();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: CodexModel[]; nextCursor: string | null } = await this.rpc.request("model/list", { cursor, limit: 100 });
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  }

  async send(message: MessageInput) {
    if (this.busy) throw new Error("A response is already in progress.");
    const bound = this.provider();
    if (bound && bound !== message.selection.provider) throw new Error(`This chat uses ${bound}. Create another chat to use ${message.selection.provider}.`);
    this.busy = true;
    this.turnStarted = false;
    this.activeTurnId = undefined;
    this.turnStartResolved = false;
    this.pendingUsage = [];
    this.pendingCompletions.clear();
    this.pendingTurnEvents = [];
    this.activeProvider = message.selection.provider;
    try {
      if (message.selection.provider === "gemini") { await this.sendGemini(message); return; }
      const settings = this.store.projectForChat(this.record.id)?.settings;
      if (!settings) throw new Error("Set a working folder and permissions in project settings before starting a Codex turn.");
      const options = threadOptions(settings);
      validateSelection(message.selection, await this.models(), message.attachments.some((item) => item.kind === "image"));
      const attachments = message.attachments.map((attachment) => attachment.kind === "image"
        ? { name: attachment.name, kind: attachment.kind, ocrText: attachment.ocrText }
        : attachment);
      await this.connect();
      const result = await this.rpc.request(this.threadId ? "thread/resume" : "thread/start", { ...options, ...(this.threadId ? { threadId: this.threadId } : {}) });
      if (!this.threadId) { this.threadId = result.thread.id; this.store.setThread(this.record, result.thread.id); this.emit({ type: "thread", threadId: this.threadId }); }
      verifyThreadOptions(result, settings);
      this.emit({ type: "notice", text: `Codex effective settings: folder ${result.cwd}; sandbox ${JSON.stringify(result.sandbox)}; approvals ${JSON.stringify(result.approvalPolicy)}.` });
      this.startUserEvent(message.text, attachments);
      this.needsResume = false;
      const input: Array<Record<string, unknown>> = [{ type: "text", text: message.text, text_elements: [] }];
      for (const attachment of message.attachments) {
        if (attachment.kind === "text") {
          input.push({ type: "text", text: `Attached text file: ${attachment.name}\n\n${attachment.content}`, text_elements: [] });
        } else {
          input.push({ type: "image", url: attachment.content });
          if (attachment.ocrText) input.push({ type: "text", text: `OCR text from image: ${attachment.name}\n\n${attachment.ocrText}`, text_elements: [] });
        }
      }
      this.turnStarted = true;
      const started = await this.rpc.request("turn/start", { threadId: this.threadId, cwd: options.cwd, input, model: message.selection.model, effort: message.selection.effort });
      this.turnStartResolved = true;
      this.activeTurnId = typeof started?.turn?.id === "string" ? started.turn.id : undefined;
      if (!this.activeTurnId) throw new Error("Codex did not identify the started turn. Its outcome is unknown; inspect the conversation before retrying.");
      for (const event of this.pendingUsage) if (event.turnId === this.activeTurnId) this.emitUsage(event.usage);
      this.pendingUsage = [];
      const pendingEvents = this.pendingTurnEvents;
      this.pendingTurnEvents = [];
      for (const event of pendingEvents) this.receive(event);
      const completion = this.pendingCompletions.get(this.activeTurnId);
      if (completion) this.finishTurn(completion);
      this.pendingCompletions.clear();
    } catch (error) {
      if (this.turnStarted) { this.rpc.close(); this.setConnection("disconnected"); this.needsResume = Boolean(this.threadId); }
      this.pendingUsage = [];
      this.pendingCompletions.clear();
      this.pendingTurnEvents = [];
      this.activeTurnId = undefined;
      this.turnStarted = false;
      if (this.busy) {
        this.interruptApprovals("disconnected");
        this.busy = false;
        this.activeProvider = undefined;
        this.emit({ type: "finished", status: "failed", error: error instanceof Error ? error.message : "Codex could not start the turn." });
      }
      throw error;
    }
  }

  private async sendGemini(message: MessageInput) {
    const client = GeminiClient.fromEnvironment();
    if (!client) throw new Error("Gemini is unavailable. Set GEMINI_API_KEY or GOOGLE_API_KEY on the Codeit server.");
    if (!message.selection.model) throw new Error("Select a Gemini model before sending.");
    const itemId = randomUUID();
    this.startUserEvent(message.text, message.attachments.map((attachment) => attachment.kind === "image" ? { name: attachment.name, kind: attachment.kind, ocrText: attachment.ocrText } : attachment));
    const history = await client.stream(message.selection.model, this.record.geminiHistory ?? [], message, (delta) => this.emit({ type: "delta", itemId, delta }));
    this.store.setGeminiHistory(this.record, history);
    this.busy = false;
    this.activeProvider = undefined;
    this.emit({ type: "finished", status: "completed" });
  }

  decide(id: string, decision: "accept" | "decline") {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error("This approval is no longer pending.");
    this.emit({ type: "approvalEvidence", id, stage: "decision", decision });
    this.approvals.delete(id);
    this.emit({ type: "approvalResolved", id });
    try { this.rpc.respond(approval.rpcId, { decision }); }
    catch (error) {
      this.emit({ type: "approvalEvidence", id, stage: "interrupted", reason: "response_failed" });
      throw error;
    }
    this.emit({ type: "approvalEvidence", id, stage: "response_queued" });
  }

  isBusy() { return this.busy; }

  close() { try { this.interruptApprovals("shutdown"); } finally { this.rpc.close(); } }

  private recoverApprovals() {
    const pending = new Map<string, "request" | "decision">();
    for (const event of this.record.events) {
      if (event.type !== "approvalEvidence" || typeof event.id !== "string") continue;
      if (event.stage === "requested") pending.set(event.id, "request");
      if (event.stage === "decision" && pending.has(event.id)) pending.set(event.id, "decision");
      if (event.stage === "response_queued" || event.stage === "interrupted") pending.delete(event.id);
    }
    for (const [id, stage] of pending) this.store.append(this.record, { type: "approvalEvidence", id, stage: "interrupted", reason: stage === "decision" ? "delivery_unknown" : "restart" });
  }

  private interruptApprovals(reason: "disconnected" | "shutdown" | "turn_completed") {
    for (const id of [...this.approvals.keys()]) {
      this.emit({ type: "approvalEvidence", id, stage: "interrupted", reason });
      this.approvals.delete(id);
      this.emit({ type: "approvalResolved", id });
    }
  }

  private async connect() {
    if (this.connection === "disconnected") this.setConnection("connecting");
    try {
      await this.rpc.connect();
      this.setConnection("connected");
    } catch (error) {
      this.setConnection("disconnected");
      throw error;
    }
  }

  private setConnection(status: "connecting" | "connected" | "disconnected") {
    if (this.connection === status) return;
    this.connection = status;
    this.emit({ type: "connection", status });
  }

  private receive(message: RpcMessage) {
    const params = message.params ?? {};
    const scoped = ["item/agentMessage/delta", "item/commandExecution/outputDelta", "item/started", "item/completed", "item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method ?? "");
    if (scoped) {
      if (params.threadId !== this.threadId || !this.busy || !this.turnStarted || typeof params.turnId !== "string") {
        if (message.id !== undefined) this.rpc.reject(message.id, "This request does not belong to the active turn.");
        return;
      }
      if (!this.turnStartResolved) { this.pendingTurnEvents.push(message); return; }
      if (params.turnId !== this.activeTurnId) {
        if (message.id !== undefined) this.rpc.reject(message.id, "This request does not belong to the active turn.");
        return;
      }
    }
    if (message.id !== undefined) {
      if (this.busy && params.threadId === this.threadId && ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method ?? "")) {
        const id = randomUUID();
        const event = { type: "approval", id, method: message.method, params };
        this.emit({ type: "approvalEvidence", id, stage: "requested", method: message.method });
        this.approvals.set(id, { rpcId: message.id, event });
        this.emit(event);
      } else {
        this.rpc.reject(message.id, "This request requires a client capability that Codeit does not support.");
        this.emit({ type: "error", message: `Unsupported Codex request: ${message.method}` });
      }
      return;
    }
    if (params.threadId !== this.threadId || !this.busy) return;
    if (message.method === "thread/tokenUsage/updated" && this.turnStarted) {
      const usage = usageSchema.safeParse(params.tokenUsage);
      if (usage.success && typeof params.turnId === "string") {
        if (!this.turnStartResolved) this.pendingUsage.push({ turnId: params.turnId, usage: usage.data.last });
        else if (params.turnId === this.activeTurnId) this.emitUsage(usage.data.last);
      }
    }
    if (message.method === "item/agentMessage/delta") this.emit({ type: "delta", itemId: params.itemId, delta: params.delta });
    if (message.method === "item/commandExecution/outputDelta") this.emit({ type: "commandDelta", itemId: params.itemId, delta: params.delta });
    if (message.method === "item/started" || message.method === "item/completed") this.emit({ type: "item", item: params.item, phase: message.method === "item/started" ? "started" : "completed" });
    if (message.method === "turn/completed") {
      if (typeof params.turn?.id !== "string") return;
      if (!this.turnStartResolved) this.pendingCompletions.set(params.turn.id, params.turn);
      else if (params.turn.id === this.activeTurnId) this.finishTurn(params.turn);
    }
  }

  private emit(event: Event) {
    if (this.turnKey && ["user", "delta", "commandDelta", "item", "finished"].includes(event.type)) {
      event = { ...event, turnKey: this.turnKey, ...(event.type === "finished" ? event.status === "completed" ? { finishedAt: new Date().toISOString() } : { interruptionObservedAt: new Date().toISOString() } : {}) };
    }
    if (!["approval", "approvalResolved", "thread", "error", "connection"].includes(event.type)) this.store.append(this.record, event);
    for (const listener of this.listeners) listener(event);
    if (event.type === "finished") this.turnKey = undefined;
  }

  private startUserEvent(text: string, attachments: unknown[]) {
    this.turnKey = randomUUID();
    try { this.emit({ type: "user", id: randomUUID(), text, attachments, startedAt: new Date().toISOString() }); }
    catch (error) { this.turnKey = undefined; throw error; }
  }

  private emitUsage(last: z.infer<typeof usageSchema>["last"]) {
    this.emit({ type: "notice", text: `Codex reported latest usage: ${last.inputTokens} input tokens (${last.cachedInputTokens} cached), ${last.outputTokens} output tokens, ${last.totalTokens} total tokens.` });
  }

  private finishTurn(turn: { status?: string; error?: { message?: string } }) {
    this.busy = false;
    this.activeProvider = undefined;
    this.interruptApprovals("turn_completed");
    this.emit({ type: "finished", status: turn.status ?? "failed", error: turn.error?.message });
  }
}
