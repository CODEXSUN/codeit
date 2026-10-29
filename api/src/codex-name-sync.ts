import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CodexRpc } from "./codex-rpc.js";
import type { Store } from "./store.js";

const baselineSchema = z.strictObject({ threadId: z.uuid(), name: z.string().min(1).max(100) });
const requestSchema = z.strictObject({
  threadId: z.uuid(), codeitName: z.string().min(1).max(100), codexName: z.string().nullable(),
  baseline: baselineSchema.nullable(), choice: z.enum(["codeit", "codex", "record"]), confirmed: z.literal(true),
});
type Baseline = z.infer<typeof baselineSchema> | null;

export function nameSyncState(codeit: string, codex: string | null, baseline: Baseline) {
  if (codex === null) return "codex_untitled";
  if (codeit === codex) return baseline?.name === codeit ? "matched" : "matched_unrecorded";
  if (!baseline) return "unbased";
  if (codeit === baseline.name) return "codex_changed";
  if (codex === baseline.name) return "codeit_changed";
  return "conflict";
}

export function registerCodexNameSync(app: FastifyInstance, store: Store, isBusy: (id: string) => boolean, createRpc = () => new CodexRpc()) {
  const active = new Set<string>();
  app.post<{ Params: { id: string } }>("/api/chats/:id/codex-name-sync", async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Review and confirm a valid name choice." });
    const expected = parsed.data; const chatId = request.params.id;
    if (active.has(chatId) || isBusy(chatId)) return reply.code(409).send({ error: "Wait for the current chat or name operation to finish." });
    active.add(chatId);
    const rpc = createRpc(); let changed = false;
    try {
      const matchesLocal = () => {
        const chat = store.chat(chatId);
        return Boolean(chat && store.projectForChat(chatId) && chat.threadId === expected.threadId && chat.name === expected.codeitName && sameBaseline(store.chatNameBaseline(chatId) ?? null, expected.baseline));
      };
      if (!matchesLocal()) return reply.code(409).send({ error: "The Codeit chat changed. Recheck both names." });
      await rpc.connect();
      const read = async () => {
        const result = await rpc.request("thread/read", { threadId: expected.threadId, includeTurns: false });
        if (result?.thread?.id !== expected.threadId) throw new Error("Thread identity mismatch");
        return { name: typeof result.thread.name === "string" ? result.thread.name : null, status: result.thread.status?.type };
      };
      const before = await read();
      if (before.name !== expected.codexName || !matchesLocal() || isBusy(chatId)) return reply.code(409).send({ error: "A name or chat state changed. Recheck both names." });
      if (before.status === "active") return reply.code(409).send({ error: "The Codex thread is active. Wait for it to finish and recheck." });
      const last = await read();
      if (last.name !== expected.codexName || last.status === "active" || !matchesLocal() || isBusy(chatId)) return reply.code(409).send({ error: "A name or chat state changed. Recheck both names." });
      const target = expected.choice === "codex" ? expected.codexName : expected.codeitName;
      if (!target || target.trim() !== target || target.length > 100 || (expected.choice === "record" && target !== expected.codexName)) return reply.code(400).send({ error: "The chosen name cannot be applied. Review both names." });
      if (expected.choice === "codeit" && last.name !== target) {
        changed = true;
        await rpc.request("thread/name/set", { threadId: expected.threadId, name: target });
      } else if (expected.choice === "codex" && expected.codeitName !== target) {
        if (!matchesLocal()) return reply.code(409).send({ error: "The Codeit name changed. Recheck both names." });
        changed = true;
        if (!store.renameChat(chatId, target)) return reply.code(409).send({ error: "The chat changed. Recheck both names." });
      }
      const after = await read();
      if (after.name !== target || store.chat(chatId)?.name !== target || isBusy(chatId)) return reply.code(409).send({ error: "A name may have changed, but the result did not match. Recheck both names." });
      if (!store.setChatNameBaseline(chatId, expected.threadId, target, expected.baseline)) return reply.code(409).send({ error: "A name may have changed, but the baseline was not recorded. Recheck both names." });
      return { ok: true };
    } catch {
      return reply.code(503).send({ error: changed ? "A name may have changed, but verification or recording failed. Recheck both names before trying again." : "Could not verify the names. Check the Codex connection and retry." });
    } finally { rpc.close(); active.delete(chatId); }
  });
}

function sameBaseline(a: Baseline, b: Baseline) { return a === null ? b === null : b !== null && a.threadId === b.threadId && a.name === b.name; }
