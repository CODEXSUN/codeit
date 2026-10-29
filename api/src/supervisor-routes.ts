import { StorageError } from "./storage.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Store } from "./store.js";
import { Supervisor } from "./supervisor.js";
import type { PromptManager } from "./prompt-manager.js";

type Params = { id: string; approvalId: string };
export function registerSupervisorRoutes(app: FastifyInstance, projects: Store, prompts: PromptManager) {
  const supervisor = new Supervisor();
  const base = "/api/projects/:id/supervisor";
  app.addHook("onClose", async () => supervisor.close());
  app.get<{ Params: Params }>(base, async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    return supervisor.get(req.params.id);
  });
  app.post<{ Params: Params }>(`${base}/messages`, async (req, reply) => {
    const project = projects.project(req.params.id);
    if (!project) return reply.code(404).send({ error: "Project not found." });
    const body = z.object({ text: z.string().max(20_000).refine((text) => Boolean(text.trim())), requestId: z.string().uuid() }).strict().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Enter a message up to 20,000 characters." });
    if (!project.settings) return reply.code(409).send({ error: "Set the project folder and permissions first." });
    try {
      if (supervisor.isActive(project.id)) return reply.code(409).send({ error: "The supervisor is already responding." });
      const claim = prompts.claim({ projectId: project.id, requestId: body.data.requestId, source: "supervisor", text: body.data.text });
      if (!claim.created) return reply.code(409).send({ error: "This submission was already recorded. Check supervisor history before trying again." });
      return supervisor.send(project.id, body.data.text, project.settings);
    }
    catch (error) { if (error instanceof StorageError) throw error; return reply.code(409).send({ error: error instanceof Error ? error.message : "Supervisor could not start." }); }
  });
  app.post<{ Params: Params }>(`${base}/approvals/:approvalId`, async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    const body = z.object({ decision: z.enum(["accept", "decline"]) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Choose accept or decline." });
    try { return supervisor.decide(req.params.id, req.params.approvalId, body.data.decision); }
    catch (error) { if (error instanceof StorageError) throw error; return reply.code(409).send({ error: error instanceof Error ? error.message : "Approval failed." }); }
  });
  return supervisor;
}
