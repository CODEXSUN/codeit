import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DocumentRepository } from "./storage.js";
import { migrateIdeasDocument } from "./ideas-migrations.js";

const stageSchema = z.enum(["draft", "exploring", "ready", "archived"]);
const ideaSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(200),
  content: z.string().max(100_000), stage: stageSchema,
  revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string(),
});
const documentSchema = z.object({ version: z.literal(1), projects: z.record(z.string(), z.array(ideaSchema)) });
export type Idea = z.infer<typeof ideaSchema>;
export type IdeaStage = z.infer<typeof stageSchema>;

export class IdeasStore {
  private readonly repository: DocumentRepository;
  private document: z.infer<typeof documentSchema>;

  constructor(directory?: string) {
    this.repository = new DocumentRepository("ideas", directory);
    const stored = this.repository.read();
    const migrated = migrateIdeasDocument(stored ?? { version: 1, projects: {} });
    this.document = documentSchema.parse(migrated.document);
    if (migrated.changed) this.repository.write(this.document);
  }

  list(projectId: string) {
    this.repository.assertHealthy();
    return structuredClone(this.document.projects[projectId] ?? []);
  }

  get(projectId: string, id: string) {
    return this.list(projectId).find((idea) => idea.id === id);
  }

  create(projectId: string, title: string, content: string) {
    const now = new Date().toISOString();
    const idea = ideaSchema.parse({ id: randomUUID(), title, content, stage: "draft", revision: 1, createdAt: now, updatedAt: now });
    const next = structuredClone(this.document);
    (next.projects[projectId] ??= []).push(idea);
    this.save(next);
    return idea;
  }

  update(projectId: string, id: string, revision: number, changes: { title?: string; content?: string; stage?: IdeaStage }) {
    const next = structuredClone(this.document);
    const ideas = next.projects[projectId] ?? [];
    const index = ideas.findIndex((idea) => idea.id === id);
    if (index < 0) throw new Error("Idea not found.");
    if (ideas[index].revision !== revision) throw new Error("Idea changed since it was loaded. Reload before saving.");
    const idea = ideaSchema.parse({ ...ideas[index], ...changes, revision: revision + 1, updatedAt: new Date().toISOString() });
    ideas[index] = idea;
    this.save(next);
    return idea;
  }

  private save(next: z.infer<typeof documentSchema>) {
    this.repository.write(next);
    this.document = next;
  }
}
