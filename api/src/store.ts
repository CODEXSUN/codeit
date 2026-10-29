import { randomUUID } from "node:crypto";
import { DocumentRepository } from "./storage.js";
import { z } from "zod";
import { projectSettingsSchema, type ProjectSettings } from "./project-settings.js";

const eventSchema = z.object({ type: z.string() }).passthrough();
const geminiPartSchema = z.object({ text: z.string().optional(), inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(), thought: z.boolean().optional(), thoughtSignature: z.string().optional() }).passthrough();
const geminiContentSchema = z.object({ role: z.enum(["user", "model"]), parts: z.array(geminiPartSchema) });
const chatSchema = z.object({ id: z.string(), name: z.string(), archived: z.boolean().optional(), threadId: z.string().optional(), geminiHistory: z.array(geminiContentSchema).optional(), events: z.array(eventSchema) });
const projectSchema = z.object({ id: z.string(), name: z.string(), settings: projectSettingsSchema.optional(), chats: z.array(chatSchema) });
export const dataSchema = z.object({ projects: z.array(projectSchema) });
export type StoredChat = z.infer<typeof chatSchema>;
export type Event = z.infer<typeof eventSchema>;

export class Store {
  private readonly repository: DocumentRepository;
  private data: z.infer<typeof dataSchema>;
  private saveTimer?: NodeJS.Timeout;

  constructor(directory?: string) {
    this.repository = new DocumentRepository("projects", directory);
    const data = this.repository.read();
    if (data !== undefined) { dataSchema.parse(data); this.data = data as z.infer<typeof dataSchema>; }
    else {
      this.data = { projects: [{ id: randomUUID(), name: "codeit-test", chats: [{ id: randomUUID(), name: "testing", events: [] }] }] };
      this.save();
    }
  }

  projects() {
    this.repository.assertHealthy();
    return this.data.projects.map((project) => ({ id: project.id, name: project.name, settings: project.settings, chats: project.chats.map(({ id, name, archived }) => ({ id, name, archived: archived ?? false })) }));
  }

  project(id: string) { this.repository.assertHealthy(); return this.data.projects.find((project) => project.id === id); }
  projectForChat(id: string) { this.repository.assertHealthy(); return this.data.projects.find((project) => project.chats.some((chat) => chat.id === id)); }
  chat(id: string) { this.repository.assertHealthy(); return this.data.projects.flatMap((project) => project.chats).find((chat) => chat.id === id); }

  createProject(name: string, settings: ProjectSettings) {
    this.repository.assertHealthy();
    const project = { id: randomUUID(), name, settings, chats: [] as StoredChat[] };
    this.data.projects.push(project);
    this.save();
    return project;
  }

  createChat(projectId: string, name: string) {
    const project = this.project(projectId);
    if (!project) return undefined;
    const chat: StoredChat = { id: randomUUID(), name, events: [] };
    project.chats.push(chat);
    this.save();
    return { id: chat.id, name: chat.name };
  }

  renameProject(id: string, name: string) {
    const project = this.project(id);
    if (!project) return false;
    project.name = name;
    this.save();
    return true;
  }

  updateProjectSettings(id: string, settings: ProjectSettings) {
    const project = this.project(id);
    if (!project) return false;
    project.settings = settings;
    this.save();
    return true;
  }

  renameChat(id: string, name: string) {
    const chat = this.chat(id);
    if (!chat) return false;
    chat.name = name;
    this.save();
    return true;
  }

  archiveChat(id: string, archived: boolean) {
    const chat = this.chat(id);
    if (!chat) return false;
    chat.archived = archived;
    this.save();
    return true;
  }

  deleteChat(id: string) {
    this.repository.assertHealthy();
    const project = this.data.projects.find((item) => item.chats.some((chat) => chat.id === id));
    if (!project) return false;
    project.chats = project.chats.filter((chat) => chat.id !== id);
    this.save();
    return true;
  }

  setThread(chat: StoredChat, threadId: string) { this.repository.assertHealthy(); chat.threadId = threadId; this.save(); }
  setGeminiHistory(chat: StoredChat, history: NonNullable<StoredChat["geminiHistory"]>) { this.repository.assertHealthy(); chat.geminiHistory = history; this.save(); }
  append(chat: StoredChat, event: Event) {
    this.repository.assertHealthy();
    chat.events.push(event);
    if (event.type === "delta" || event.type === "commandDelta") {
      this.saveTimer ??= setTimeout(() => { try { this.save(); } catch {} }, 500);
    } else {
      this.save();
    }
  }

  flush() {
    if (this.saveTimer) this.save();
  }

  private save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.repository.write(this.data);
  }
}
