import { randomUUID } from "node:crypto";
import { DocumentRepository } from "./storage.js";
import { z } from "zod";

const eventSchema = z.object({ id: z.string(), type: z.enum(["user", "assistant", "command", "status", "approval_request", "approval_decision"]), text: z.string() });
export const supervisorStateSchema = z.object({ events: z.array(eventSchema), threadId: z.string().optional(), folder: z.string().optional(), approvalPolicy: z.enum(["untrusted", "on-request"]).optional(), busy: z.boolean(), status: z.enum(["idle", "running", "failed", "interrupted"]), approval: z.object({ id: z.string(), method: z.string(), params: z.unknown() }).optional() });
export type SupervisorState = z.infer<typeof supervisorStateSchema>;

export class SupervisorStore {
  private readonly repository: DocumentRepository;
  private states: Record<string, SupervisorState>;
  private timer?: NodeJS.Timeout;
  constructor(directory?: string) {
    this.repository = new DocumentRepository("supervisors", directory);
    const data = this.repository.read();
    if (data !== undefined) z.record(z.string(), supervisorStateSchema).parse(data);
    this.states = (data ?? {}) as Record<string, SupervisorState>;
    for (const state of Object.values(this.states)) if (state.busy) {
      if (state.approval) state.events.push({ id: randomUUID(), type: "approval_decision", text: `Interrupted: ${state.approval.id}` });
      state.busy = false; state.status = "interrupted"; delete state.approval;
      state.events.push({ id: randomUUID(), type: "status", text: "Codeit stopped before the supervisor turn completed." });
    }
    this.save();
  }
  get(projectId: string): SupervisorState { this.repository.assertHealthy(); return this.states[projectId] ??= { events: [], busy: false, status: "idle" }; }
  append(projectId: string, type: SupervisorState["events"][number]["type"], text: string, immediate = true) {
    this.get(projectId).events.push({ id: randomUUID(), type, text });
    if (immediate) this.save(); else this.timer ??= setTimeout(() => { try { this.save(); } catch {} }, 500);
  }
  chunk(projectId: string, type: "assistant" | "command", text: string) {
    const state = this.get(projectId);
    const last = state.events.at(-1);
    if (last?.type === type) last.text += text;
    else state.events.push({ id: randomUUID(), type, text });
    this.timer ??= setTimeout(() => { try { this.save(); } catch {} }, 500);
  }
  save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.repository.write(this.states);
  }
}
