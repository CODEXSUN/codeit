import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IdeasStore } from "./ideas-store.js";
import { StorageError } from "./storage.js";
import type { Store } from "./store.js";

const bodySchema = z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(100_000) }).strict();
const editSchema = bodySchema.extend({ revision: z.number().int().positive() }).strict();
const stageSchema = z.object({ revision: z.number().int().positive(), stage: z.enum(["draft", "exploring", "ready", "archived"]) }).strict();
type Params = { id: string; ideaId: string };

export function registerIdeasRoutes(app: FastifyInstance, projects: Store) {
  const ideas = new IdeasStore();
  const base = "/api/projects/:id/ideas";
  function route(method: "GET" | "POST" | "PUT", path: string, action: (params: Params, body: unknown) => unknown) {
    app.route<{ Params: Params }>({ method, url: base + path, handler: async (request, reply) => {
      if (!projects.project(request.params.id)) return reply.code(404).send({ error: "Project not found." });
      try { return action(request.params, request.body); }
      catch (error) {
        if (error instanceof StorageError) throw error;
        if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid idea input." });
        return reply.code(409).send({ error: error instanceof Error ? error.message : "Idea action failed." });
      }
    } });
  }
  route("GET", "", ({ id }) => ({ ideas: ideas.list(id) }));
  route("GET", "/:ideaId", ({ id, ideaId }) => {
    const idea = ideas.get(id, ideaId);
    if (!idea) throw new Error("Idea not found.");
    return idea;
  });
  route("POST", "", ({ id }, body) => { const input = bodySchema.parse(body); return ideas.create(id, input.title, input.content); });
  route("PUT", "/:ideaId", ({ id, ideaId }, body) => { const input = editSchema.parse(body); return ideas.update(id, ideaId, input.revision, { title: input.title, content: input.content }); });
  route("POST", "/:ideaId/stage", ({ id, ideaId }, body) => { const input = stageSchema.parse(body); return ideas.update(id, ideaId, input.revision, { stage: input.stage }); });
}
