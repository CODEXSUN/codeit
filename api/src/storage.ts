import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { DummyDriver, Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type CompiledQuery } from "kysely";

type Domain = "projects" | "loops" | "supervisors" | "preferences";
type Database = { documents: { domain: string; body: string; revision: number } };
const query = new Kysely<Database>({ dialect: {
  createAdapter: () => new SqliteAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new SqliteIntrospector(db),
  createQueryCompiler: () => new SqliteQueryCompiler(),
} });
const legacyFiles = ["data.json", "loops.json", "supervisors.json"];
let failureHandler: (() => void) | undefined;
export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "StorageError"; }
}
export function setStorageFailureHandler(handler?: () => void) { failureHandler = handler; }
function reportFailure() {
  console.error("Codeit storage write failed. Stop and investigate before restarting.");
  if (failureHandler) queueMicrotask(failureHandler);
}

export function dataDirectory(directory?: string) { return resolve(directory ?? process.env.CODEIT_DATA_DIR ?? ".codeit"); }
export function databasePath(directory: string) { return join(directory, "codeit.sqlite"); }

export function openDatabase(directory: string, allowLegacy = false) {
  mkdirSync(directory, { recursive: true });
  const path = databasePath(directory);
  if (!allowLegacy && !existsSync(path) && legacyFiles.some((name) => existsSync(join(directory, name)))) {
    throw new Error("Legacy JSON data found. Stop Codeit and run the explicit SQLite import before starting.");
  }
  const db = new DatabaseSync(path, { timeout: 5000 });
  try {
    chmodSync(path, 0o600);
    db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; BEGIN IMMEDIATE");
    const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
    if (version > 1) throw new Error(`Unsupported SQLite schema version ${version}.`);
    if (version === 0) {
      db.exec("CREATE TABLE documents (domain TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE imports (id TEXT PRIMARY KEY, manifest TEXT NOT NULL); PRAGMA user_version = 1");
    }
    if (!allowLegacy && legacyFiles.some((name) => existsSync(join(directory, name))) && !db.prepare("SELECT id FROM imports WHERE id = ?").get("legacy-json-v1")) {
      throw new Error("Legacy JSON data found without a completed import. Stop Codeit and run the explicit SQLite import.");
    }
    db.exec("COMMIT");
    return db;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.close();
    throw error;
  }
}

function verifyLegacySources(db: DatabaseSync, directory: string) {
  const row = db.prepare("SELECT manifest FROM imports WHERE id = ?").get("legacy-json-v1");
  if (!row) return;
  const current = legacyFiles.filter((name) => existsSync(join(directory, name))).map((file) => ({
    file, digest: createHash("sha256").update(readFileSync(join(directory, file))).digest("hex"),
  }));
  if (JSON.stringify(current) !== row.manifest) {
    throw new Error("Legacy JSON files changed after import. Stop Codeit and investigate both copies; no data was merged.");
  }
}

function statement(db: DatabaseSync, compiled: CompiledQuery) {
  return { sql: db.prepare(compiled.sql), values: compiled.parameters as SQLInputValue[] };
}

export class DocumentRepository {
  private revision: number | undefined;
  private failed = false;
  private readonly directory: string;
  constructor(private readonly domain: Domain, directory?: string) { this.directory = dataDirectory(directory); }
  version() { this.assertHealthy(); return this.revision ?? 0; }
  assertHealthy() { if (this.failed) throw new StorageError("Storage is unavailable after a failed write; restart Codeit."); }
  read(): unknown | undefined {
    const db = openDatabase(this.directory);
    try {
      verifyLegacySources(db, this.directory);
      const { sql, values } = statement(db, query.selectFrom("documents").select(["body", "revision"]).where("domain", "=", this.domain).compile());
      const row = sql.get(...values);
      if (!row) return undefined;
      this.revision = Number(row.revision);
      return JSON.parse(String(row.body));
    } finally { db.close(); }
  }
  write(value: unknown) {
    this.assertHealthy();
    let db: DatabaseSync | undefined;
    try {
      db = openDatabase(this.directory);
      const body = JSON.stringify(value);
      const compiled = this.revision === undefined
        ? query.insertInto("documents").values({ domain: this.domain, body, revision: 1 }).compile()
        : query.updateTable("documents").set({ body, revision: this.revision + 1 }).where("domain", "=", this.domain).where("revision", "=", this.revision).compile();
      const { sql, values } = statement(db, compiled);
      if (Number(sql.run(...values).changes) !== 1) throw new Error("Storage changed concurrently; restart Codeit to avoid overwriting data.");
      this.revision = (this.revision ?? 0) + 1;
    } catch (error) {
      this.failed = true;
      reportFailure();
      throw new StorageError("Storage write failed or changed concurrently; restart Codeit after investigating.", { cause: error });
    }
    finally { db?.close(); }
  }
}

export function insertDocument(db: DatabaseSync, domain: Domain, body: string) {
  const { sql, values } = statement(db, query.insertInto("documents").values({ domain, body, revision: 1 }).compile());
  sql.run(...values);
}
