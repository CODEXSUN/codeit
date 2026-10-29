import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataSchema } from "./store.js";
import { stateSchema } from "./loop-store.js";
import { supervisorStateSchema } from "./supervisor-store.js";
import { acquireStorageLock } from "./storage-lock.js";
import { dataDirectory, insertDocument, openDatabase } from "./storage.js";

const sources = [
  { file: "data.json", domain: "projects", schema: dataSchema },
  { file: "loops.json", domain: "loops", schema: z.record(z.string(), stateSchema) },
  { file: "supervisors.json", domain: "supervisors", schema: z.record(z.string(), supervisorStateSchema) },
] as const;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function importLegacy(directory?: string) {
  const dir = dataDirectory(directory);
  const release = acquireStorageLock(dir);
  try {
    const files = sources.filter((source) => existsSync(join(dir, source.file))).map((source) => {
      const bytes = readFileSync(join(dir, source.file));
      source.schema.parse(JSON.parse(bytes.toString("utf8")));
      return { ...source, bytes, digest: hash(bytes) };
    });
    if (!files.length) throw new Error("No legacy JSON files found.");
    const manifest = JSON.stringify(files.map(({ file, digest }) => ({ file, digest })));
    const backup = join(dir, "json-backup-v1");
    mkdirSync(backup, { recursive: true });
    for (const file of files) {
      const target = join(backup, file.file);
      if (!existsSync(target)) copyFileSync(join(dir, file.file), target, constants.COPYFILE_EXCL);
      if (hash(readFileSync(target)) !== file.digest) throw new Error(`Backup differs for ${file.file}; preserve it and investigate before retrying.`);
      chmodSync(target, 0o600);
    }
    const db = openDatabase(dir, true);
    try {
      db.exec("BEGIN IMMEDIATE");
      const prior = db.prepare("SELECT manifest FROM imports WHERE id = ?").get("legacy-json-v1");
      if (prior) {
        if (prior.manifest !== manifest) throw new Error("Legacy files differ from the completed import; refusing to overwrite SQLite data.");
        db.exec("COMMIT");
        return "already imported";
      }
      if (db.prepare("SELECT domain FROM documents LIMIT 1").get()) throw new Error("SQLite already contains data; refusing to overwrite it.");
      for (const file of files) {
        if (hash(readFileSync(join(dir, file.file))) !== file.digest) throw new Error(`Legacy file changed during import: ${file.file}.`);
        insertDocument(db, file.domain, file.bytes.toString("utf8"));
      }
      db.prepare("INSERT INTO imports (id, manifest) VALUES (?, ?)").run("legacy-json-v1", manifest);
      db.exec("COMMIT");
      return "imported";
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    finally { db.close(); }
  } finally { release(); }
}
