import { randomUUID } from "node:crypto";
import { CodexRpc, type RpcMessage } from "./codex-rpc.js";
import { threadOptions, verifyThreadOptions, type ProjectSettings } from "./project-settings.js";
import { SupervisorStore } from "./supervisor-store.js";

const instructions = "You are Codeit's project supervisor. Discuss the user's ideas, ask concise clarifying questions, and help reach a clear conclusion. Propose plans, acceptance criteria, tasks and review findings for the user to inspect. You cannot approve a plan or dispatch tasks from this conversation. Direct the user to the project work controls for explicit approval, worker dispatch, review and acceptance. Never claim a review is independently verified. Do not modify files.";
type Active = { rpc: CodexRpc; threadId?: string; approval?: { id: string; rpcId: string | number }; timer: NodeJS.Timeout; settings: ProjectSettings; outputSize: number };

export class Supervisor {
  private active = new Map<string, Active>();
  constructor(private readonly store = new SupervisorStore()) {}
  get(projectId: string) { const { threadId: _thread, folder: _folder, approvalPolicy: _policy, ...state } = this.store.get(projectId); return state; }
  isActive(projectId: string) { return this.active.has(projectId); }

  send(projectId: string, text: string, settings: ProjectSettings) {
    if (this.active.has(projectId)) throw new Error("The supervisor is already responding.");
    const effective = { ...settings, sandbox: "read-only" as const };
    const options = threadOptions(effective);
    const state = this.store.get(projectId);
    if (state.threadId && (state.folder !== options.cwd || state.approvalPolicy !== effective.approvalPolicy)) throw new Error("Project folder or approval policy changed. Restore the supervisor's original settings to continue this conversation.");
    const rpc = new CodexRpc();
    const active: Active = { rpc, settings: effective, outputSize: 0, timer: setTimeout(() => this.finish(projectId, "failed", "Supervisor turn exceeded the 10 minute limit."), 600_000) };
    this.active.set(projectId, active);
    state.busy = true; state.status = "running";
    this.store.append(projectId, "user", text);
    rpc.onEvent = (message) => this.receive(projectId, message);
    rpc.onDisconnect = (message) => this.finish(projectId, "failed", message);
    void this.execute(projectId, text, active).catch((error) => this.finish(projectId, "failed", error instanceof Error ? error.message : String(error)));
    return this.get(projectId);
  }

  decide(projectId: string, id: string, decision: "accept" | "decline") {
    const active = this.active.get(projectId);
    if (!active?.approval || active.approval.id !== id) throw new Error("This approval is no longer pending.");
    const rpcId = active.approval.rpcId;
    delete active.approval; delete this.store.get(projectId).approval;
    this.store.append(projectId, "approval_decision", `${id}: ${decision}`);
    active.rpc.respond(rpcId, { decision });
    return this.get(projectId);
  }
  close() { for (const id of [...this.active.keys()]) this.finish(id, "interrupted", "Codeit stopped before the supervisor turn completed."); }

  private async execute(id: string, text: string, active: Active) {
    await active.rpc.connect();
    const state = this.store.get(id);
    const options = threadOptions(active.settings);
    const result = await active.rpc.request(state.threadId ? "thread/resume" : "thread/start", { ...options, developerInstructions: instructions, ...(state.threadId ? { threadId: state.threadId } : {}) });
    if (this.active.get(id) !== active) return;
    verifyThreadOptions(result, active.settings);
    active.threadId = result.thread.id;
    state.threadId = result.thread.id; state.folder = options.cwd; state.approvalPolicy = active.settings.approvalPolicy; this.store.save();
    await active.rpc.request("turn/start", { threadId: active.threadId, cwd: options.cwd, input: [{ type: "text", text, text_elements: [] }] });
  }

  private receive(id: string, message: RpcMessage) {
    const active = this.active.get(id); if (!active) return;
    const params = message.params ?? {};
    if (message.id !== undefined) {
      if (params.threadId !== active.threadId || active.approval || !["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method ?? "")) {
        active.rpc.reject(message.id, "Unsupported supervisor request.");
        this.store.append(id, "status", `Unsupported Codex request: ${message.method}`); return;
      }
      const approval = { id: randomUUID(), method: message.method!, params };
      active.approval = { id: approval.id, rpcId: message.id }; this.store.get(id).approval = approval;
      this.store.append(id, "approval_request", JSON.stringify(approval)); return;
    }
    if (params.threadId !== active.threadId) return;
    if (message.method === "item/agentMessage/delta" || message.method === "item/commandExecution/outputDelta") {
      const delta = String(params.delta ?? ""); active.outputSize += delta.length;
      if (active.outputSize > 2_000_000) { this.finish(id, "failed", "Supervisor output exceeded the 2 MB limit."); return; }
      this.store.chunk(id, message.method === "item/agentMessage/delta" ? "assistant" : "command", delta);
    }
    if (message.method === "item/started" && params.item?.type === "commandExecution") this.store.append(id, "command", String(params.item.command ?? ""));
    if (message.method === "turn/completed") this.finish(id, params.turn?.status === "completed" ? "idle" : "failed", params.turn?.error?.message ?? (params.turn?.status === "completed" ? "Turn completed." : `Turn ${params.turn?.status ?? "failed"}.`));
  }

  private finish(id: string, status: "idle" | "failed" | "interrupted", message: string) {
    const active = this.active.get(id); if (!active) return;
    this.active.delete(id); clearTimeout(active.timer);
    if (active.approval) this.store.append(id, "approval_decision", `Interrupted: ${active.approval.id}`);
    const state = this.store.get(id); state.busy = false; state.status = status; delete state.approval;
    this.store.append(id, "status", message); active.rpc.close();
  }
}
