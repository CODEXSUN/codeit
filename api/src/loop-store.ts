import { randomUUID } from "node:crypto";
import { DocumentRepository } from "./storage.js";
import { z } from "zod";
import { projectSettingsSchema } from "./project-settings.js";

const eventSchema = z.object({ type: z.string(), text: z.string() });
const manualReviewSchema = z.object({
  workerRunId: z.string(), reviewer: z.string(), scope: z.string(), omissions: z.string(), findings: z.string(),
  reviewedAt: z.string(), approvedSettings: projectSettingsSchema,
  resolution: z.object({ decision: z.enum(["accept", "changes_requested"]), findings: z.string(), decidedAt: z.string() }).optional(),
});
const runSchema = z.object({ id: z.string(), kind: z.enum(["worker", "review", "manual_review"]), status: z.enum(["running", "completed", "failed", "interrupted"]), events: z.array(eventSchema), error: z.string().optional(), manualReview: manualReviewSchema.optional() });
const taskSchema = z.object({ id: z.string(), title: z.string(), description: z.string(), dependencies: z.array(z.string()), status: z.enum(["pending", "running", "needs_review", "reviewing", "changes_requested", "accepted", "failed"]), runs: z.array(runSchema), findings: z.string().optional() });
export const stateSchema = z.object({ idea: z.object({ original: z.string(), refined: z.string(), ideaId: z.string().optional() }).nullable(), plan: z.object({ summary: z.string(), criteria: z.array(z.string()), approved: z.boolean(), approvedSettings: projectSettingsSchema.optional() }).nullable(), tasks: z.array(taskSchema), active: z.object({ taskId: z.string(), runId: z.string(), approval: z.object({ id: z.string(), method: z.string(), params: z.unknown() }).optional() }).optional() });
export type LoopState = z.infer<typeof stateSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Run = z.infer<typeof runSchema>;

export class LoopStore {
  private readonly repository: DocumentRepository;
  private readonly states: Record<string, LoopState>;

  constructor(directory?: string) {
    this.repository = new DocumentRepository("loops", directory);
    const data = this.repository.read();
    if (data !== undefined) z.record(z.string(), stateSchema).parse(data);
    this.states = (data ?? {}) as Record<string, LoopState>;
    for (const state of Object.values(this.states)) {
      if (!state.active) continue;
      const task = state.tasks.find((item) => item.id === state.active!.taskId);
      const run = task?.runs.find((item) => item.id === state.active!.runId);
      if (task && run) { if (state.active.approval) run.events.push({ type: "approval_interrupted", text: state.active.approval.id }); run.status = "interrupted"; run.error = "Codeit stopped before the run completed."; task.status = run.kind === "review" ? "needs_review" : "failed"; }
      delete state.active;
    }
    this.save();
  }

  get(id: string): LoopState { this.repository.assertHealthy(); return this.states[id] ??= { idea: null, plan: null, tasks: [] }; }
  setIdea(id: string, idea: { original: string; refined: string; ideaId?: string }) {
    const state = this.get(id);
    if (state.plan?.approved) throw new Error("The approved plan cannot be changed.");
    state.idea = { ...idea, ideaId: idea.ideaId ?? state.idea?.ideaId }; state.plan = null; state.tasks = []; this.save();
    return state;
  }
  setPlan(id: string, input: { summary: string; criteria: string[]; tasks: { title: string; description: string; dependencies: string[] }[] }) {
    const state = this.get(id);
    if (!state.idea) throw new Error("Save an idea first.");
    if (state.plan?.approved) throw new Error("The approved plan cannot be changed.");
    const tasks: Task[] = input.tasks.map((task) => ({ ...task, id: randomUUID(), status: "pending", runs: [] }));
    for (let i = 0; i < tasks.length; i++) {
      tasks[i].dependencies = tasks[i].dependencies.map((value) => {
        if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) >= i) throw new Error("Dependencies must refer to earlier task indexes.");
        return tasks[Number(value)].id;
      });
    }
    state.plan = { summary: input.summary, criteria: input.criteria, approved: false }; state.tasks = tasks; this.save();
    return state;
  }
  save() {
    this.repository.write(this.states);
  }
}
