import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PreferencesStore, PreferenceConflict, preferencePatchSchema } from "./preferences.js";
import { Store } from "./store.js";

const querySchema = z.strictObject({ projectId: z.string().min(1).optional(), chatId: z.string().min(1).optional() });
const paramsSchema = z.strictObject({ scope: z.enum(["workspace", "project", "chat"]), id: z.string().min(1) });

export function registerPreferencesRoutes(app: FastifyInstance, projects: Store, preferences = new PreferencesStore()) {
  function context(projectId?: string, chatId?: string) {
    if (projectId && !projects.project(projectId)) return undefined;
    if (!chatId) return { projectId };
    const owner = projects.projectForChat(chatId);
    if (!owner || (projectId && owner.id !== projectId)) return undefined;
    return { projectId: owner.id, chatId };
  }

  app.get("/api/preferences", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid preference scope." });
    const target = context(parsed.data.projectId, parsed.data.chatId);
    if (!target) return reply.code(404).send({ error: "Preference scope not found." });
    return preferences.get(target.projectId, target.chatId);
  });

  app.put("/api/preferences/:scope/:id", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const patch = preferencePatchSchema.safeParse(request.body);
    if (!params.success || !patch.success) return reply.code(400).send({ error: "Invalid preferences. Check the scope and supported values." });
    const { scope, id } = params.data;
    if (scope === "workspace" && id !== "default") return reply.code(404).send({ error: "Preference scope not found." });
    const target = scope === "workspace" ? context() : scope === "project" ? context(id) : context(undefined, id);
    if (!target) return reply.code(404).send({ error: "Preference scope not found." });
    try { preferences.update(scope, id, patch.data); }
    catch (error) {
      if (error instanceof PreferenceConflict) return reply.code(409).send({ error: error.message });
      throw error;
    }
    return preferences.get(target.projectId, target.chatId);
  });
}
