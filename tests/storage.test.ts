import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { importLegacy } from "../api/src/import-json.js";
import { Store } from "../api/src/store.js";
import { LoopStore } from "../api/src/loop-store.js";
import { SupervisorStore } from "../api/src/supervisor-store.js";
import { acquireStorageLock } from "../api/src/storage-lock.js";
import { databasePath, openDatabase, setStorageFailureHandler } from "../api/src/storage.js";

test("imports all legacy domains without dropping evidence and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-import-"));
  try {
    const project = { projects: [{ id: "p", name: "P", settings: { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" }, chats: [{ id: "c", name: "C", events: [{ type: "user", text: "history", extra: "kept" }], extra: "chat" }], extra: "project" }], extra: "root" };
    const loops = { p: { idea: { original: "idea", refined: "" }, plan: { summary: "plan", criteria: ["ok"], approved: true, approvedSettings: project.projects[0].settings }, tasks: [], extra: "loop" } };
    const supervisors = { p: { events: [{ id: "e", type: "approval_decision", text: "decline" }], busy: false, status: "idle", extra: "supervisor" } };
    for (const [name, value] of Object.entries({ "data.json": project, "loops.json": loops, "supervisors.json": supervisors })) writeFileSync(join(dir, name), JSON.stringify(value));
    assert.throws(() => new Store(dir), /explicit SQLite import/);
    assert.equal(importLegacy(dir), "imported");
    assert.equal(importLegacy(dir), "already imported");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "json-backup-v1", "data.json"), "utf8")), project);
    const store = new Store(dir);
    assert.equal(store.chat("c")?.events[0].text, "history");
    assert.equal(new LoopStore(dir).get("p").plan?.approvedSettings?.folder, dir);
    assert.equal(new SupervisorStore(dir).get("p").events[0].text, "decline");
    store.renameProject("p", "changed");
    const db = new DatabaseSync(databasePath(dir));
    const saved = JSON.parse(String(db.prepare("SELECT body FROM documents WHERE domain = ?").get("projects")!.body));
    db.close();
    assert.equal(saved.extra, "root"); assert.equal(saved.projects[0].extra, "project"); assert.equal(saved.projects[0].chats[0].extra, "chat");
    writeFileSync(join(dir, "data.json"), JSON.stringify({ projects: [] }));
    assert.throws(() => importLegacy(dir), /Backup differs|differ from the completed import/);
    assert.throws(() => new Store(dir), /changed after import/);
    writeFileSync(join(dir, "data.json"), JSON.stringify(project));
    assert.equal(new Store(dir).project("p")?.name, "changed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("startup rejects a legacy domain that appeared after import", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-late-legacy-"));
  try {
    writeFileSync(join(dir, "data.json"), JSON.stringify({ projects: [] }));
    importLegacy(dir);
    const late = JSON.stringify({ p: { idea: { original: "late", refined: "" }, plan: null, tasks: [] } });
    writeFileSync(join(dir, "loops.json"), late);
    assert.throws(() => new LoopStore(dir), /changed after import/);
    assert.equal(readFileSync(join(dir, "loops.json"), "utf8"), late);
    const db = new DatabaseSync(databasePath(dir));
    assert.equal(db.prepare("SELECT domain FROM documents WHERE domain = ?").get("loops"), undefined);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("failed schema migration rolls back and permits a safe retry", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-migration-"));
  try {
    writeFileSync(join(dir, "data.json"), JSON.stringify({ projects: [] }));
    const db = new DatabaseSync(databasePath(dir));
    db.exec("CREATE TABLE imports (bad TEXT)"); db.close();
    assert.throws(() => importLegacy(dir));
    assert.throws(() => new Store(dir), /already exists|completed import/);
    const repair = new DatabaseSync(databasePath(dir));
    assert.equal(Number(repair.prepare("PRAGMA user_version").get()!.user_version), 0);
    assert.equal(repair.prepare("SELECT name FROM sqlite_master WHERE name = 'documents'").get(), undefined);
    repair.exec("DROP TABLE imports"); repair.close();
    assert.equal(importLegacy(dir), "imported");
    assert.deepEqual(new Store(dir).projects(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("invalid JSON leaves source untouched; lock and stale writer fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-conflict-"));
  try {
    const source = join(dir, "data.json"); writeFileSync(source, "invalid");
    assert.throws(() => importLegacy(dir)); assert.equal(readFileSync(source, "utf8"), "invalid");
    writeFileSync(source, JSON.stringify({ projects: [] }));
    const release = acquireStorageLock(dir);
    assert.throws(() => importLegacy(dir), /locked/); release();
    assert.equal(importLegacy(dir), "imported");
    const first = new Store(dir); const second = new Store(dir);
    first.createProject("first", { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" });
    assert.throws(() => second.createProject("second", { folder: dir, sandbox: "read-only", approvalPolicy: "untrusted" }), /concurrently/);
    assert.deepEqual(new Store(dir).projects().map((p) => p.name), ["first"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("import rolls back every domain if a later insert fails, then retries", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-import-rollback-"));
  try {
    writeFileSync(join(dir, "data.json"), JSON.stringify({ projects: [] }));
    writeFileSync(join(dir, "loops.json"), JSON.stringify({}));
    const db = openDatabase(dir, true);
    db.exec("CREATE TRIGGER fail_loops BEFORE INSERT ON documents WHEN NEW.domain = 'loops' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    db.close();
    assert.throws(() => importLegacy(dir), /fixture failure/);
    const verify = new DatabaseSync(databasePath(dir));
    assert.equal(Number(verify.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n), 0);
    assert.equal(Number(verify.prepare("SELECT COUNT(*) AS n FROM imports").get()!.n), 0);
    verify.exec("DROP TRIGGER fail_loops"); verify.close();
    assert.equal(importLegacy(dir), "imported");
    assert.deepEqual(new Store(dir).projects(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("separate processes cannot silently replace a concurrent document update", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-concurrent-"));
  try {
    new Store(dir);
    const module = pathToFileURL(join(process.cwd(), "api/src/storage.ts")).href;
    const script = `import { DocumentRepository } from ${JSON.stringify(module)};
      const repository = new DocumentRepository('projects', process.argv[1]);
      const data = repository.read();
      process.stdout.write('ready\\n');
      process.stdin.once('data', () => {
        data.projects[0].name = process.argv[2];
        try { repository.write(data); process.exit(0); } catch { process.exit(2); }
      });`;
    const children = ["one", "two"].map((name) => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, dir, name], { stdio: ["pipe", "pipe", "pipe"] }));
    await Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
      child.once("error", reject); child.stdout.once("data", () => resolve());
      child.once("exit", (code) => reject(new Error(`Writer exited early: ${code}`)));
    })));
    const results = children.map((child) => new Promise<number | null>((resolve) => child.once("exit", resolve)));
    for (const child of children) child.stdin.end("go");
    assert.deepEqual((await Promise.all(results)).sort(), [0, 2]);
    assert(["one", "two"].includes(new Store(dir).projects()[0].name));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the import command uses the configured disposable directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-import-command-"));
  try {
    writeFileSync(join(dir, "data.json"), JSON.stringify({ projects: [] }));
    const result = spawnSync(process.execPath, ["--import", "tsx", "tools/import-json.ts"], { cwd: process.cwd(), env: { ...process.env, CODEIT_DATA_DIR: dir }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /imported/);
    assert.deepEqual(new Store(dir).projects(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an interrupted SQLite transaction leaves no partial import and can be retried", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-interrupted-"));
  try {
    writeFileSync(join(dir, "data.json"), JSON.stringify({ projects: [] }));
    openDatabase(dir, true).close();
    const script = `const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT INTO documents VALUES (?, ?, ?)').run('projects', JSON.stringify({ projects: [] }), 1);
      process.exit(23);`;
    const interrupted = spawnSync(process.execPath, ["-e", script, databasePath(dir)], { encoding: "utf8" });
    assert.equal(interrupted.status, 23, interrupted.stderr);
    const check = new DatabaseSync(databasePath(dir));
    assert.equal(Number(check.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n), 0);
    check.close();
    assert.equal(importLegacy(dir), "imported");
    assert.deepEqual(new Store(dir).projects(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("delayed flush failures are reported and leave the store unavailable", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-flush-failure-"));
  const log = t.mock.method(console, "error", () => {});
  let failures = 0;
  setStorageFailureHandler(() => { failures++; });
  try {
    const first = new Store(dir); const second = new Store(dir);
    const chat = first.chat(first.projects()[0].chats[0].id)!;
    first.append(chat, { type: "delta", delta: "pending" });
    second.renameProject(second.projects()[0].id, "winner");
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.throws(() => first.projects(), /unavailable after a failed write/);
    assert.equal(new Store(dir).projects()[0].name, "winner");
    assert.equal(log.mock.callCount(), 1);
    assert.equal(failures, 1);

    const third = new Store(dir);
    const thirdChat = third.chat(third.projects()[0].chats[0].id)!;
    const db = new DatabaseSync(databasePath(dir));
    db.exec("CREATE TRIGGER fail_write BEFORE UPDATE ON documents BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END");
    db.close();
    third.append(thirdChat, { type: "delta", delta: "pending" });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.throws(() => third.projects(), /unavailable after a failed write/);
    assert.equal(log.mock.callCount(), 2);
    assert.equal(failures, 2);
  } finally { setStorageFailureHandler(); rmSync(dir, { recursive: true, force: true }); }
});
