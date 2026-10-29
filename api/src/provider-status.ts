import type { FastifyInstance } from "fastify";
import { CodexRpc } from "./codex-rpc.js";
import { GeminiClient } from "./gemini.js";
import { codexDiscoveryReason, type CodexModel } from "./providers.js";

export function registerProviderStatusRoutes(app: FastifyInstance) {
  app.get<{ Params: { provider: string } }>("/api/providers/:provider/status", async (request, reply) => {
    if (request.params.provider === "codex") return codexStatus();
    if (request.params.provider === "gemini") return geminiStatus();
    return reply.code(404).send({ error: "Provider not found." });
  });
}

export async function codexStatus(rpc = new CodexRpc()) {
  try {
    await rpc.connect();
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: CodexModel[]; nextCursor: string | null } = await rpc.request("model/list", { cursor, limit: 100 });
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return models.length ? { available: true, models } : { available: false, models: [], reason: "Codex returned no available models. Check your sign-in and model access." };
  } catch (error) {
    return { available: false, models: [], reason: codexDiscoveryReason(error) };
  } finally { rpc.close(); }
}

export async function geminiStatus(client = GeminiClient.fromEnvironment()) {
  if (!client) return { available: false, models: [], reason: "Set GEMINI_API_KEY or GOOGLE_API_KEY on the Codeit server, then restart Codeit." };
  try {
    const models = await client.models();
    return models.length ? { available: true, models } : { available: false, models: [], reason: "Gemini returned no available models. Check model access." };
  } catch {
    return { available: false, models: [], reason: "Gemini model discovery failed. Check the API key, model access, and network." };
  }
}
