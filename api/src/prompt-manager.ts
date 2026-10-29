import { openDatabase, dataDirectory, StorageError } from "./storage.js";
import { z } from "zod";

const identifier = z.string().min(1).max(200);
const text = z.string().max(4_194_304);
const attachmentSchema = z.object({ name: z.string().min(1).max(255), kind: z.enum(["text", "image"]), content: z.string().max(1_048_576).optional(), ocrText: z.string().max(102_400).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const captureSchema = z.object({ projectId: identifier, requestId: identifier, source: z.enum(["chat", "supervisor", "worker", "review", "chat-refine", "plan-refine"]), chatId: identifier.optional(), text, attachments: z.array(attachmentSchema).max(5).default([]) }).strict();
type Capture = z.input<typeof captureSchema>;

/** Owns prompt records and their append-only revisions. */
export class PromptManager {
  private readonly directory: string;
  constructor(directory?: string) { this.directory = dataDirectory(directory); this.migrate(); }

  capture(value: Capture) { return this.claim(value).reference; }

  claim(value: Capture) {
    const input = captureSchema.parse(value);
    const attachments = JSON.stringify(input.attachments);
    return this.write((db) => {
      const existing = db.prepare("SELECT reference, source, chat_id, original_text, attachments FROM prompt_records WHERE project_id = ? AND request_id = ?").get(input.projectId, input.requestId);
      if (existing) {
        if (existing.source !== input.source || existing.chat_id !== (input.chatId ?? null) || existing.original_text !== input.text || existing.attachments !== attachments) throw new Error("Request ID already belongs to a different prompt.");
        return { reference: Number(existing.reference), created: false };
      }
      const now = new Date().toISOString();
      const result = db.prepare("INSERT INTO prompt_records (project_id, request_id, source, chat_id, original_text, created_at, attachments) VALUES (?, ?, ?, ?, ?, ?, ?)").run(input.projectId, input.requestId, input.source, input.chatId ?? null, input.text, now, attachments);
      const reference = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO prompt_revisions (reference, revision, text, created_at) VALUES (?, 1, ?, ?)").run(reference, input.text, now);
      return { reference, created: true };
    });
  }

  revise(projectId: string, reference: number, expectedRevision: number, value: string) {
    identifier.parse(projectId); z.number().int().positive().safe().parse(reference); z.number().int().positive().safe().parse(expectedRevision); text.parse(value);
    return this.write((db) => {
      const record = db.prepare("SELECT reference FROM prompt_records WHERE project_id = ? AND reference = ?").get(projectId, reference);
      if (!record) return undefined;
      const last = db.prepare("SELECT revision, text FROM prompt_revisions WHERE reference = ? ORDER BY revision DESC LIMIT 1").get(reference)!;
      if (Number(last.revision) !== expectedRevision) throw new Error("Prompt revision changed; reload before saving.");
      if (last.text === value) return expectedRevision;
      const revision = expectedRevision + 1;
      db.prepare("INSERT INTO prompt_revisions (reference, revision, text, created_at) VALUES (?, ?, ?, ?)").run(reference, revision, value, new Date().toISOString());
      return revision;
    });
  }

  list(projectId: string) {
    identifier.parse(projectId);
    const db = openDatabase(this.directory);
    try { return db.prepare("SELECT reference, source, chat_id AS chatId, created_at AS createdAt FROM prompt_records WHERE project_id = ? ORDER BY reference DESC LIMIT 500").all(projectId); }
    finally { db.close(); }
  }

  show(projectId: string, reference: number) {
    identifier.parse(projectId); z.number().int().positive().safe().parse(reference);
    const db = openDatabase(this.directory);
    try {
      const record = db.prepare("SELECT reference, project_id AS projectId, source, chat_id AS chatId, created_at AS createdAt, attachments FROM prompt_records WHERE project_id = ? AND reference = ?").get(projectId, reference);
      if (!record) return undefined;
      return { ...record, attachments: JSON.parse(String(record.attachments)), revisions: db.prepare("SELECT revision, text, created_at AS createdAt FROM prompt_revisions WHERE reference = ? ORDER BY revision").all(reference) };
    } finally { db.close(); }
  }

  private migrate() {
    const db = openDatabase(this.directory);
    try {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS prompt_schema (version INTEGER NOT NULL);
        INSERT INTO prompt_schema SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM prompt_schema);
        CREATE TABLE IF NOT EXISTS prompt_records (reference INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, request_id TEXT NOT NULL, source TEXT NOT NULL, chat_id TEXT, original_text TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id, request_id));
        CREATE TABLE IF NOT EXISTS prompt_revisions (reference INTEGER NOT NULL REFERENCES prompt_records(reference), revision INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(reference, revision));
        CREATE TRIGGER IF NOT EXISTS prompt_records_no_update BEFORE UPDATE ON prompt_records BEGIN SELECT RAISE(ABORT, 'Prompt records are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS prompt_records_no_delete BEFORE DELETE ON prompt_records BEGIN SELECT RAISE(ABORT, 'Prompt records are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS prompt_revisions_no_update BEFORE UPDATE ON prompt_revisions BEGIN SELECT RAISE(ABORT, 'Prompt revisions are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS prompt_revisions_no_delete BEFORE DELETE ON prompt_revisions BEGIN SELECT RAISE(ABORT, 'Prompt revisions are append-only'); END;`);
      const version = db.prepare("SELECT version FROM prompt_schema").all();
      if (version.length !== 1 || ![1, 2].includes(Number(version[0].version))) throw new Error("Unsupported Prompt Manager schema version.");
      if (version[0].version === 1) {
        db.exec("ALTER TABLE prompt_records ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'; UPDATE prompt_schema SET version = 2");
      }
      db.exec("COMMIT");
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    finally { db.close(); }
  }

  private write<T>(action: (db: ReturnType<typeof openDatabase>) => T): T {
    let db: ReturnType<typeof openDatabase> | undefined;
    try { db = openDatabase(this.directory); db.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE"); const result = action(db); db.exec("COMMIT"); return result; }
    catch (error) { try { db?.exec("ROLLBACK"); } catch {} if (error instanceof Error && /Request ID already|Prompt revision changed/.test(error.message)) throw error; throw new StorageError("Prompt storage failed. The action was not recorded.", { cause: error }); }
    finally { db?.close(); }
  }
}
