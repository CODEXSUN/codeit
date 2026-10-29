import Fastify from "fastify";
import { z } from "zod";
import { Chat } from "./chat.js";
import { Store } from "./store.js";
import { messageSchema } from "./message-input.js";
import { refinePrompt } from "./refine.js";
import { codexDiscoveryReason, selectionSchema, validateSelection } from "./providers.js";
import { projectSettingsSchema, resolveFolder } from "./project-settings.js";
import { GeminiClient } from "./gemini.js";
import { registerLoopRoutes } from "./loop-routes.js";
import { registerSupervisorRoutes } from "./supervisor-routes.js";
import { registerDocsRoutes } from "./docs-routes.js";
import { acquireStorageLock } from "./storage-lock.js";
import { setStorageFailureHandler, StorageError } from "./storage.js";
import { loadConfig } from "../../tools/config.mjs";

loadConfig();
const releaseStorage = acquireStorageLock();
process.once("exit", releaseStorage);
const app = Fastify({ logger: false, bodyLimit: 40 * 1024 * 1024 });
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof StorageError) return reply.code(503).send({ error: "Codeit storage failed. Stop and investigate before restarting." });
  return reply.send(error);
});
const store = new Store();
const chats = new Map<string, Chat>();
const streams = new Set<import("node:http").ServerResponse>();

function getChat(id: string) {
  const record = store.chat(id);
  if (!record) return undefined;
  let chat = chats.get(id);
  if (!chat) { chat = new Chat(store, record); chats.set(id, chat); }
  return chat;
}

app.addHook("onRequest", async (request, reply) => {
  const hosts = new Set(["localhost:9030", "127.0.0.1:9030"]);
  const origins = new Set(["http://localhost:9020", "http://127.0.0.1:9020"]);
  if (!hosts.has(request.headers.host ?? "") || (request.headers.origin && !origins.has(request.headers.origin)) || (request.method !== "GET" && request.headers["x-codeit-request"] !== "1")) {
    return reply.code(403).send({ error: "Only the local Codeit window can access this API." });
  }
  reply.header("Cache-Control", "no-store");
});

const loopRunner = registerLoopRoutes(app, store);
const supervisor = registerSupervisorRoutes(app, store);
registerDocsRoutes(app, store);

type IdParams = { id: string };
const nameSchema = z.object({ name: z.string().trim().min(1).max(100) });
const decisionSchema = z.object({ decision: z.enum(["accept", "decline"]) });

app.get("/api/projects", async () => ({ projects: store.projects() }));
app.post("/api/projects", async (request, reply) => {
  const parsed = nameSchema.extend({ settings: projectSettingsSchema }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter a project name, folder, and valid permissions." });
  try { return reply.code(201).send(store.createProject(parsed.data.name, { ...parsed.data.settings, folder: resolveFolder(parsed.data.settings.folder) })); }
  catch (error) { if (error instanceof StorageError) throw error; return reply.code(400).send({ error: error instanceof Error ? error.message : "Folder is unavailable." }); }
});
app.patch<{ Params: IdParams }>("/api/projects/:id", async (request, reply) => {
  const parsed = nameSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter a project name." });
  if (!store.renameProject(request.params.id, parsed.data.name)) return reply.code(404).send({ error: "Project not found." });
  return { ok: true };
});
app.post("/api/projects/resolve-folder", async (request, reply) => {
  const parsed = z.object({ folder: z.string().trim().min(1) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter a folder path." });
  try { return { folder: resolveFolder(parsed.data.folder) }; }
  catch (error) { if (error instanceof StorageError) throw error; return reply.code(400).send({ error: error instanceof Error ? error.message : "Folder is unavailable." }); }
});
app.patch<{ Params: IdParams }>("/api/projects/:id/settings", async (request, reply) => {
  const parsed = projectSettingsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter a valid folder and permissions." });
  const project = store.project(request.params.id);
  if (!project) return reply.code(404).send({ error: "Project not found." });
  if (loopRunner.isActive(project.id)) return reply.code(409).send({ error: "Wait for the project's worker or review to finish." });
  if (supervisor.isActive(project.id)) return reply.code(409).send({ error: "Wait for the supervisor response to finish." });
  if (project.chats.some((record) => chats.get(record.id)?.isBusy())) return reply.code(409).send({ error: "Wait for this project's active responses to finish." });
  try { store.updateProjectSettings(project.id, { ...parsed.data, folder: resolveFolder(parsed.data.folder) }); return { ok: true }; }
  catch (error) { if (error instanceof StorageError) throw error; return reply.code(400).send({ error: error instanceof Error ? error.message : "Folder is unavailable." }); }
});
app.post<{ Params: IdParams }>("/api/projects/:id/chats", async (request, reply) => {
  const parsed = nameSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter a chat name." });
  const chat = store.createChat(request.params.id, parsed.data.name);
  if (!chat) return reply.code(404).send({ error: "Project not found." });
  return reply.code(201).send(chat);
});
app.patch<{ Params: IdParams }>("/api/chats/:id", async (request, reply) => {
  const parsed = nameSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Enter a chat name." });
  if (!store.renameChat(request.params.id, parsed.data.name)) return reply.code(404).send({ error: "Chat not found." });
  return { ok: true };
});
app.patch<{ Params: IdParams }>("/api/chats/:id/archive", async (request, reply) => {
  const parsed = z.object({ archived: z.boolean() }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Choose an archive state." });
  if (chats.get(request.params.id)?.isBusy()) return reply.code(409).send({ error: "Wait for the current response to finish before archiving this chat." });
  if (!store.archiveChat(request.params.id, parsed.data.archived)) return reply.code(404).send({ error: "Chat not found." });
  return { ok: true };
});
app.delete<{ Params: IdParams }>("/api/chats/:id", async (request, reply) => {
  const chat = chats.get(request.params.id);
  if (chat?.isBusy()) return reply.code(409).send({ error: "Wait for the current response to finish before deleting this chat." });
  if (!store.deleteChat(request.params.id)) return reply.code(404).send({ error: "Chat not found." });
  chat?.close();
  chats.delete(request.params.id);
  return { ok: true };
});
app.get<{ Params: IdParams }>("/api/chats/:id", async (request, reply) => {
  const chat = store.chat(request.params.id);
  if (!chat) return reply.code(404).send({ error: "Chat not found." });
  return { id: chat.id, name: chat.name, events: chat.events };
});
app.get<{ Params: IdParams }>("/api/chats/:id/providers", async (request, reply) => {
  const chat = getChat(request.params.id);
  if (!chat) return reply.code(404).send({ error: "Chat not found." });
  const gemini = GeminiClient.fromEnvironment();
  const [codexResult, geminiResult] = await Promise.allSettled([chat.models(), gemini ? gemini.models() : Promise.reject(new Error("Set GEMINI_API_KEY or GOOGLE_API_KEY on the Codeit server."))]);
  return {
    lockedProvider: chat.provider(),
    codex: codexResult.status === "fulfilled" && codexResult.value.length ? { available: true, models: codexResult.value } : { available: false, models: [], reason: codexResult.status === "rejected" ? codexDiscoveryReason(codexResult.reason) : "Codex returned no available models. Check your sign-in and model access." },
    gemini: geminiResult.status === "fulfilled" ? { available: true, models: geminiResult.value } : { available: false, models: [], reason: geminiResult.reason instanceof Error ? geminiResult.reason.message : "Gemini is unavailable." },
  };
});
app.get<{ Params: IdParams }>("/api/chats/:id/events", async (request, reply) => {
  const chat = getChat(request.params.id);
  if (!chat) return reply.code(404).send({ error: "Chat not found." });
  reply.hijack();
  reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store", Connection: "keep-alive" });
  const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  streams.add(reply.raw);
  const unsubscribe = chat.subscribe(send);
  request.raw.on("close", () => { unsubscribe(); streams.delete(reply.raw); });
});
app.post<{ Params: IdParams }>("/api/chats/:id/refine", async (request, reply) => {
  const chat = getChat(request.params.id);
  if (!chat) return reply.code(404).send({ error: "Chat not found." });
  const parsed = z.object({ text: z.string().min(1).max(100_000), selection: selectionSchema }).safeParse(request.body);
  if (!parsed.success || !parsed.data.text.trim()) return reply.code(400).send({ error: "Enter a prompt to refine." });
  try { validateSelection(parsed.data.selection, await chat.models()); return { text: await refinePrompt(parsed.data.text, parsed.data.selection) }; }
  catch (error) { if (error instanceof StorageError) throw error; return reply.code(500).send({ error: error instanceof Error ? error.message : "Prompt refinement failed." }); }
});
app.post<{ Params: IdParams }>("/api/chats/:id/messages", async (request, reply) => {
  const parsed = messageSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid message." });
  const chat = getChat(request.params.id);
  if (!chat) return reply.code(404).send({ error: "Chat not found." });
  try { await chat.send(parsed.data); return { ok: true }; }
  catch (error) { if (error instanceof StorageError) throw error; return reply.code(500).send({ error: error instanceof Error ? error.message : "Codex could not start the turn." }); }
});
app.post<{ Params: { id: string; approvalId: string } }>("/api/chats/:id/approvals/:approvalId", async (request, reply) => {
  const parsed = decisionSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Choose accept or decline." });
  const chat = getChat(request.params.id);
  if (!chat) return reply.code(404).send({ error: "Chat not found." });
  try { chat.decide(request.params.approvalId, parsed.data.decision); return { ok: true }; }
  catch (error) { if (error instanceof StorageError) throw error; return reply.code(409).send({ error: error instanceof Error ? error.message : "Approval failed." }); }
});

let closing = false;
let storageFailed = false;
setStorageFailureHandler(() => { storageFailed = true; void shutdown(); });
async function shutdown() {
  if (closing) return;
  closing = true;
  for (const chat of chats.values()) {
    try { chat.close(); } catch { storageFailed = true; console.error("Codeit could not finish chat shutdown."); }
  }
  try { store.flush(); } catch { console.error("Codeit could not flush chat data during shutdown."); }
  for (const stream of streams) stream.end();
  try { await app.close(); } catch { console.error("Codeit could not finish all shutdown hooks."); }
  process.exit(storageFailed ? 1 : 0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("disconnect", () => void shutdown());
process.on("message", (message) => {
  if (typeof message === "object" && message !== null && "type" in message && message.type === "codeit:shutdown") void shutdown();
});

await app.listen({ host: "127.0.0.1", port: 9030 });
console.log("Codeit API listening on http://127.0.0.1:9030");
