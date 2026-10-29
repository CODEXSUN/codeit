import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PromptManager } from "./prompt-manager.js";
import type { Store } from "./store.js";
import { StorageError } from "./storage.js";

type Params = { id: string; reference: string };
const referenceSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().safe());
const revisionSchema = z.object({ revision: z.number().int().positive().safe(), text: z.string().max(4_194_304) }).strict();

export function registerPromptRoutes(app: FastifyInstance, projects: Store, prompts: PromptManager) {
  const base = "/api/projects/:id/prompts";
  app.get<{ Params: Params }>(base, async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    return { prompts: prompts.list(req.params.id) };
  });
  app.get<{ Params: Params }>(`${base}/:reference`, async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    const reference = referenceSchema.safeParse(req.params.reference);
    if (!reference.success) return reply.code(400).send({ error: "Invalid prompt reference." });
    const record = prompts.show(req.params.id, reference.data);
    if (!record) return reply.code(404).send({ error: "Prompt not found." });
    return record;
  });
  app.put<{ Params: Params }>(`${base}/:reference`, async (req, reply) => {
    if (!projects.project(req.params.id)) return reply.code(404).send({ error: "Project not found." });
    const reference = referenceSchema.safeParse(req.params.reference);
    const body = revisionSchema.safeParse(req.body);
    if (!reference.success || !body.success) return reply.code(400).send({ error: "Invalid prompt revision." });
    try {
      const revision = prompts.revise(req.params.id, reference.data, body.data.revision, body.data.text);
      if (revision === undefined) return reply.code(404).send({ error: "Prompt not found." });
      return { reference: reference.data, revision };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      return reply.code(409).send({ error: "Prompt changed. Reload before saving." });
    }
  });
}
