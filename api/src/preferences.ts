import { z } from "zod";
import { DocumentRepository } from "./storage.js";

const selectionSchema = z.strictObject({
  provider: z.enum(["codex", "gemini"]),
  model: z.string().trim().min(1).max(200).optional(),
  effort: z.string().trim().min(1).max(100).optional(),
}).refine((value) => !value.effort || (value.provider === "codex" && value.model), "Reasoning requires a selected Codex model.");
const preferencesSchema = z.strictObject({ selection: selectionSchema.optional(), theme: z.literal("light").optional() });
const documentSchema = z.strictObject({ workspace: preferencesSchema, projects: z.record(z.string(), preferencesSchema), chats: z.record(z.string(), preferencesSchema) });
export const preferencePatchSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  selection: selectionSchema.nullable().optional(),
  theme: z.literal("light").nullable().optional(),
}).refine((value) => value.selection !== undefined || value.theme !== undefined, "Choose a preference to update.");

type Preferences = z.infer<typeof preferencesSchema>;
type PreferencePatch = z.infer<typeof preferencePatchSchema>;
type Scope = "workspace" | "project" | "chat";
type Source = Scope | "builtin";

export class PreferenceConflict extends Error {}

export class PreferencesStore {
  private readonly repository: DocumentRepository;
  private data: z.infer<typeof documentSchema>;

  constructor(directory?: string) {
    this.repository = new DocumentRepository("preferences", directory);
    const stored = this.repository.read();
    if (stored !== undefined) {
      documentSchema.parse(stored);
      const document = stored as z.infer<typeof documentSchema>;
      for (const value of [...Object.values(document.projects), ...Object.values(document.chats)]) preferencesSchema.parse(value);
    }
    this.data = stored === undefined ? { workspace: {}, projects: {}, chats: {} } : stored as z.infer<typeof documentSchema>;
  }

  get(projectId?: string, chatId?: string) {
    this.repository.assertHealthy();
    const workspace = this.data.workspace;
    const project = projectId ? own(this.data.projects, projectId) ?? {} : null;
    const chat = chatId ? own(this.data.chats, chatId) ?? {} : null;
    const selection = this.resolve("selection", workspace, project, chat);
    const theme = this.resolve("theme", workspace, project, chat);
    return {
      revision: this.repository.version(),
      overrides: { workspace, project, chat },
      effective: { selection: selection.value ?? { provider: "codex" as const }, theme: theme.value ?? "light" },
      source: { selection: selection.source, theme: theme.source },
    };
  }

  update(scope: Scope, id: string, patch: PreferencePatch) {
    this.repository.assertHealthy();
    if (patch.revision !== this.repository.version()) throw new PreferenceConflict("Preferences changed. Reload and try again.");
    const next = structuredClone(this.data);
    const map = scope === "project" ? next.projects : next.chats;
    let target = scope === "workspace" ? next.workspace : own(map, id);
    if (!target) { target = {}; Object.defineProperty(map, id, { value: target, writable: true, enumerable: true, configurable: true }); }
    if (patch.selection === null) delete target.selection;
    else if (patch.selection !== undefined) target.selection = patch.selection;
    if (patch.theme === null) delete target.theme;
    else if (patch.theme !== undefined) target.theme = patch.theme;
    if (scope !== "workspace" && !Object.keys(target).length) delete map[id];
    this.repository.write(next);
    this.data = next;
  }

  private resolve<K extends keyof Preferences>(key: K, workspace: Preferences, project: Preferences | null, chat: Preferences | null): { value: Preferences[K]; source: Source } {
    if (chat?.[key] !== undefined) return { value: chat[key], source: "chat" };
    if (project?.[key] !== undefined) return { value: project[key], source: "project" };
    if (workspace[key] !== undefined) return { value: workspace[key], source: "workspace" };
    return { value: undefined, source: "builtin" };
  }
}

function own(map: Record<string, Preferences>, id: string) { return Object.hasOwn(map, id) ? map[id] : undefined; }
