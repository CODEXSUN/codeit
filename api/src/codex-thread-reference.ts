import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CodexRpc } from "./codex-rpc.js";
import type { Store } from "./store.js";
import { nameSyncState } from "./codex-name-sync.js";

export function registerCodexThreadReference(app: FastifyInstance, store: Store, createRpc = () => new CodexRpc()) {
  app.get<{ Params: { id: string } }>("/api/chats/:id/codex-thread", async (request, reply) => {
    const chat = store.chat(request.params.id);
    if (!chat || !store.projectForChat(request.params.id)) return reply.code(404).send({ error: "Chat not found." });
    if (!chat.threadId) return { threadId: null };
    const id = z.uuid().safeParse(chat.threadId);
    if (!id.success) return reply.code(409).send({ error: "The saved Codex thread ID is invalid." });
    const rpc = createRpc();
    try {
      await rpc.connect();
      const result = await rpc.request("thread/read", { threadId: id.data, includeTurns: false });
      if (result?.thread?.id !== id.data) return reply.code(409).send({ error: "Codex did not confirm this thread." });
      const current = store.chat(request.params.id);
      if (current?.threadId !== id.data || !store.projectForChat(request.params.id)) return reply.code(409).send({ error: "The chat changed during verification. Retry." });
      const codexName = typeof result.thread.name === "string" ? result.thread.name : null;
      const baseline = store.chatNameBaseline(request.params.id) ?? null;
      return { threadId: id.data, codeitName: current.name, codexName, baseline, syncState: nameSyncState(current.name, codexName, baseline?.threadId === id.data ? baseline : null) };
    } catch {
      return reply.code(503).send({ error: "Could not verify this Codex thread. Check the Codex connection and retry." });
    } finally { rpc.close(); }
  });
}
