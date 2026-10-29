import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Fastify from "fastify";
import { importLegacy } from "../api/src/import-json.js";
import { registerPreferencesRoutes } from "../api/src/preferences-routes.js";
import { PreferencesStore } from "../api/src/preferences.js";
import { Store } from "../api/src/store.js";

test("scoped preferences inherit, reject stale and secret inputs, and survive restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-preferences-"));
  const projects = new Store(dir);
  const settings = { folder: dir, sandbox: "read-only" as const, approvalPolicy: "untrusted" as const };
  const a = projects.createProject("A", settings); const b = projects.createProject("B", settings);
  const chat = projects.createChat(a.id, "chat")!;
  let app = Fastify(); registerPreferencesRoutes(app, projects, new PreferencesStore(dir));
  const get = (query = "") => app.inject({ method: "GET", url: `/api/preferences${query}` });
  const put = (scope: string, id: string, body: unknown) => app.inject({ method: "PUT", url: `/api/preferences/${scope}/${id}`, payload: body });
  try {
    let current = (await get(`?chatId=${chat.id}`)).json();
    assert.deepEqual(current.effective, { selection: { provider: "codex" }, theme: "light" });
    assert.equal(current.source.selection, "builtin");
    current = (await put("workspace", "default", { revision: current.revision, selection: { provider: "codex", model: "workspace-model", effort: "high" } })).json();
    assert.equal(current.source.selection, "workspace");
    current = (await put("project", a.id, { revision: current.revision, selection: { provider: "gemini", model: "models/fixture" } })).json();
    assert.deepEqual(current.effective.selection, { provider: "gemini", model: "models/fixture" });
    assert.equal(current.source.selection, "project");
    const stale = current.revision;
    current = (await put("chat", chat.id, { revision: current.revision, selection: { provider: "codex", model: "chat-model" }, theme: "light" })).json();
    assert.equal(current.source.selection, "chat"); assert.equal(current.source.theme, "chat");
    assert.equal((await put("workspace", "default", { revision: stale, selection: null })).statusCode, 409);
    assert.equal((await get(`?projectId=${b.id}&chatId=${chat.id}`)).statusCode, 404);
    assert.equal((await put("chat", "missing", { revision: current.revision, selection: null })).statusCode, 404);
    assert.equal((await put("workspace", "default", { revision: current.revision, selection: { provider: "gemini", model: "m", effort: "high" } })).statusCode, 400);
    assert.equal((await put("workspace", "default", { revision: current.revision, theme: "dark" })).statusCode, 400);
    const secret = "SECRET_FIXTURE";
    const rejected = await put("workspace", "default", { revision: current.revision, selection: { provider: "codex", apiKey: secret } });
    assert.equal(rejected.statusCode, 400); assert(!rejected.body.includes(secret));
    current = (await put("chat", chat.id, { revision: current.revision, selection: null, theme: null })).json();
    assert.equal(current.source.selection, "project"); assert.equal(current.source.theme, "builtin");
    await app.close(); app = Fastify(); registerPreferencesRoutes(app, new Store(dir), new PreferencesStore(dir));
    current = (await get(`?chatId=${chat.id}`)).json();
    assert.deepEqual(current.effective.selection, { provider: "gemini", model: "models/fixture" });
    assert.equal(current.source.selection, "project");
    const other = (await get(`?projectId=${b.id}`)).json();
    assert.equal(other.effective.selection.model, "workspace-model");
    assert(!JSON.stringify(current).includes(secret));
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("settings coexist with legacy import and reject a concurrent stale writer", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-preferences-import-"));
  t.mock.method(console, "error", () => {});
  try {
    writeFileSync(join(dir, "data.json"), JSON.stringify({ projects: [] }));
    importLegacy(dir);
    const first = new PreferencesStore(dir); const stale = new PreferencesStore(dir);
    first.update("workspace", "default", { revision: 0, selection: { provider: "codex", model: "one" } });
    assert.throws(() => stale.update("workspace", "default", { revision: 0, selection: { provider: "gemini", model: "two" } }), /Storage write failed/);
    assert.equal(new PreferencesStore(dir).get().effective.selection.model, "one");
    assert.deepEqual(new Store(dir).projects(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("special scope IDs do not alter prototypes or disappear on reload", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-preferences-key-"));
  try {
    const preferences = new PreferencesStore(dir);
    preferences.update("project", "__proto__", { revision: 0, selection: { provider: "gemini" } });
    const reloaded = new PreferencesStore(dir);
    assert.equal(reloaded.get("__proto__").source.selection, "project");
    assert.equal(reloaded.get("other").source.selection, "builtin");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
