import { StorageError } from "./storage.js";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LoopStore } from "./loop-store.js";
import { LoopRunner } from "./loop-runner.js";
import { Store } from "./store.js";
import { resolveFolder } from "./project-settings.js";
import { IdeasStore } from "./ideas-store.js";
import { registerPlanRefinement } from "./plan-refinement.js";
import { PromptManager } from "./prompt-manager.js";

const text = z.string().max(20_000).refine((value) => Boolean(value.trim()), "Text is required.");
const ideaSchema = z.object({ original: text, refined: z.string().max(20_000), replaceExistingPlan: z.boolean().optional() });
const planSchema = z.object({ summary: text, criteria: z.array(text).min(1).max(20), tasks: z.array(z.object({ title: z.string().max(200).refine((value) => Boolean(value.trim()), "Title is required."), description: text, dependencies: z.array(z.string()).max(20) })).min(1).max(20), replaceExisting: z.boolean().optional() });
const manualReviewSchema = z.object({ workerRunId: z.string().min(1), reviewer: z.string().trim().min(1).max(200), scope: text, omissions: text, findings: text, confirmed: z.literal(true) });
type Params = { id: string; taskId: string; approvalId: string };

export function registerLoopRoutes(app: FastifyInstance, projects: Store, prompts = new PromptManager()) {
  registerPlanRefinement(app, projects, prompts);
  const loops = new LoopStore();
  const runner = new LoopRunner(loops);
  const base = "/api/projects/:id/loop";
  app.addHook("onClose", async () => runner.close());

  app.get<{ Params: Params }>(base, async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    return loops.get(req.params.id);
  });
  function route(path: string, method: "PUT" | "POST", action: (id: string, params: Params, body: unknown) => unknown) {
    app.route<{ Params: Params }>({ method, url: base + path, handler: async (req, reply) => {
      if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
      try { return action(req.params.id, req.params, req.body); }
      catch (error) { if (error instanceof StorageError) throw error; return reply.code(409).send({ error: error instanceof Error ? error.message : "Action failed." }); }
    } });
  }
  function approvedSettings(id: string) {
    const settings = projects.project(id)?.settings;
    if (!settings) throw new Error("Set the project folder and permissions first.");
    const approved = loops.get(id).plan?.approvedSettings;
    if (!approved || resolveFolder(settings.folder) !== approved.folder || settings.sandbox !== approved.sandbox || settings.approvalPolicy !== approved.approvalPolicy) throw new Error("Project folder or permissions differ from the approved plan. Restore the approved settings before continuing.");
    return settings;
  }
  route("/idea", "PUT", (id, _params, body) => { if (runner.isActive(id)) throw new Error("A run is active."); const input = ideaSchema.parse(body); if (loops.get(id).plan && !input.replaceExistingPlan) throw new Error("Confirm removal of the saved draft plan and tasks."); return loops.setIdea(id, { original: input.original, refined: input.refined }); });
  route("/idea/from-saved", "POST", (id, _params, body) => {
    const input = z.object({ ideaId: z.string().uuid() }).strict().parse(body);
    const idea = new IdeasStore().get(id, input.ideaId);
    if (!idea) throw new Error("Idea not found.");
    const state = loops.get(id);
    if (runner.isActive(id) || state.active || state.idea || state.plan || state.tasks.length) throw new Error("Project work already contains an idea, plan, or tasks. Existing work cannot be replaced here.");
    const original = idea.content.trim() ? idea.content : idea.title;
    if (original.length > 20_000) throw new Error("The idea exceeds the 20,000 character project-work limit. Shorten it before starting a plan.");
    return loops.setIdea(id, { original, refined: "", ideaId: idea.id });
  });
  route("/plan", "PUT", (id, _params, body) => { if (runner.isActive(id)) throw new Error("A run is active."); const input = planSchema.parse(body); if (loops.get(id).plan && !input.replaceExisting) throw new Error("Confirm replacement of the saved draft plan and tasks."); return loops.setPlan(id, input); });
  route("/approve", "POST", (id) => {
    const state = loops.get(id);
    if (!state.plan || state.plan.approved || !state.tasks.length) throw new Error("A draft plan is required.");
    const settings = projects.project(id)?.settings;
    if (!settings) throw new Error("Set the project folder and permissions before approving.");
    state.plan.approvedSettings = { ...settings, folder: resolveFolder(settings.folder) };
    state.plan.approved = true; loops.save(); return state;
  });
  for (const kind of ["worker", "review"] as const) route(`/tasks/:taskId/${kind === "worker" ? "start" : "review"}`, "POST", (id, params) => {
    return runner.start(id, params.taskId, kind, approvedSettings(id));
  });
  route("/tasks/:taskId/manual-review", "POST", (id, params, body) => {
    const input = manualReviewSchema.parse(body);
    const state = loops.get(id); const task = state.tasks.find((item) => item.id === params.taskId);
    if (!task || !state.plan?.approved || task.status !== "needs_review" || state.active || runner.isActive()) throw new Error("An approved plan and completed worker run with no active work are required.");
    const worker = [...task.runs].reverse().find((run) => run.kind === "worker");
    if (!worker || worker.kind !== "worker" || worker.status !== "completed" || worker.id !== input.workerRunId) throw new Error("The latest completed worker run must match the reviewed run.");
    const settings = approvedSettings(id);
    task.runs.push({ id: randomUUID(), kind: "manual_review", status: "completed", events: [], manualReview: {
      workerRunId: worker.id, reviewer: input.reviewer, scope: input.scope, omissions: input.omissions, findings: input.findings,
      reviewedAt: new Date().toISOString(), approvedSettings: { ...settings, folder: resolveFolder(settings.folder) },
    } });
    task.status = "reviewing"; loops.save(); return state;
  });
  route("/tasks/:taskId/resolve", "POST", (id, params, body) => {
    const input = z.object({ decision: z.enum(["accept", "changes_requested"]), findings: z.string().max(20_000) }).parse(body);
    const state = loops.get(id); const task = state.tasks.find((item) => item.id === params.taskId);
    const review = task?.runs.at(-1);
    if (!task || task.status !== "reviewing" || state.active || !review || review.status !== "completed" || !["review", "manual_review"].includes(review.kind)) throw new Error("A completed review is required.");
    approvedSettings(id);
    if (input.decision === "changes_requested" && !input.findings.trim()) throw new Error("Enter actionable findings before requesting changes.");
    if (review.kind === "manual_review") {
      const worker = [...task.runs.slice(0, -1)].reverse().find((run) => run.kind === "worker");
      if (!review.manualReview || worker?.status !== "completed" || worker.id !== review.manualReview.workerRunId) throw new Error("The manual review no longer matches the worker run.");
      review.manualReview.resolution = { decision: input.decision, findings: input.findings, decidedAt: new Date().toISOString() };
    }
    task.findings = input.findings; task.status = input.decision === "accept" ? "accepted" : "changes_requested"; loops.save(); return state;
  });
  route("/approvals/:approvalId", "POST", (id, params, body) => {
    const input = z.object({ decision: z.enum(["accept", "decline"]) }).parse(body);
    runner.decide(id, params.approvalId, input.decision); return loops.get(id);
  });
  return runner;
}
