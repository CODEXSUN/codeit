import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { codexStatus } from "./provider-status.js";
import { refinePrompt } from "./refine.js";
import { selectionSchema, validateSelection } from "./providers.js";
import type { Store } from "./store.js";
import type { PromptManager } from "./prompt-manager.js";
import { StorageError } from "./storage.js";

export function registerPlanRefinement(app: FastifyInstance, projects: Store, prompts: PromptManager, dependencies = { codexStatus, refinePrompt }) {
  app.post<{ Params: { id: string } }>("/api/projects/:id/loop/refine-plan", async (request, reply) => {
    if (!projects.project(request.params.id)) return reply.code(404).send({ error: "Project not found." });
    const parsed = z.object({ text: z.string().trim().min(1).max(20_000), selection: selectionSchema, requestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a plan and choose a model." });
    try {
      const status = await dependencies.codexStatus();
      if (!status.available) return reply.code(503).send({ error: status.reason });
      validateSelection(parsed.data.selection, status.models);
      const prompt = `Improve this project plan while preserving its intent and constraints. Include concrete task suggestions. Return a proposal for the user to review; do not perform the work.\n\n${parsed.data.text}`;
      const claim = prompts.claim({ projectId: request.params.id, requestId: parsed.data.requestId, source: "plan-refine", text: prompt });
      if (!claim.created) return reply.code(409).send({ error: "This refinement attempt was already submitted. Start a new attempt to send it again." });
      const text = await dependencies.refinePrompt(prompt, parsed.data.selection);
      if (text.length > 20_000) return reply.code(502).send({ error: "The provider response exceeds the plan size limit." });
      return { text };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (error instanceof Error && error.message.startsWith("Request ID already")) return reply.code(409).send({ error: "This refinement attempt ID belongs to different input. Start a new attempt." });
      return reply.code(502).send({ error: "Plan refinement failed. Check the selected Codex model and connection, then start a new attempt." });
    }
  });
}
