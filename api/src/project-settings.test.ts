import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import { resolveFolder, threadOptions, verifyThreadOptions } from "./project-settings.js";

test("project folders and settings remain isolated and persist across restart", () => {
  const root = mkdtempSync(join(tmpdir(), "codeit-projects-"));
  try {
    const data = join(root, "data"); const a = join(root, "a"); const b = join(root, "b");
    mkdirSync(a); mkdirSync(b);
    const store = new Store(data);
    const settingsA = { folder: resolveFolder(a), sandbox: "read-only" as const, approvalPolicy: "on-request" as const };
    const settingsB = { folder: resolveFolder(b), sandbox: "workspace-write" as const, approvalPolicy: "untrusted" as const };
    const projectA = store.createProject("A", settingsA); const projectB = store.createProject("B", settingsB);
    const chatA = store.createChat(projectA.id, "A chat")!; const chatB = store.createChat(projectB.id, "B chat")!;
    const loaded = new Store(data);
    assert.deepEqual(threadOptions(loaded.projectForChat(chatA.id)!.settings!), { cwd: settingsA.folder, sandbox: settingsA.sandbox, approvalPolicy: settingsA.approvalPolicy });
    assert.deepEqual(threadOptions(loaded.projectForChat(chatB.id)!.settings!), { cwd: settingsB.folder, sandbox: settingsB.sandbox, approvalPolicy: settingsB.approvalPolicy, config: { sandbox_workspace_write: { exclude_tmpdir_env_var: true, exclude_slash_tmp: true, network_access: false } } });
    assert.equal(loaded.projects()[0].settings, undefined);
    verifyThreadOptions({ cwd: a, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request" }, settingsA);
    assert.throws(() => verifyThreadOptions({ cwd: b, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request" }, settingsA));
    assert.throws(() => verifyThreadOptions({ cwd: a, sandbox: { type: "dangerFullAccess" }, approvalPolicy: "on-request" }, settingsA));
    assert.throws(() => verifyThreadOptions({ cwd: a, sandbox: { type: "readOnly", networkAccess: false }, approvalPolicy: "never" }, settingsA));
    const strictWrite = { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
    verifyThreadOptions({ cwd: b, sandbox: strictWrite, approvalPolicy: "untrusted" }, settingsB);
    assert.throws(() => verifyThreadOptions({ cwd: b, sandbox: { ...strictWrite, writableRoots: [a] }, approvalPolicy: "untrusted" }, settingsB));
    assert.throws(() => verifyThreadOptions({ cwd: b, sandbox: { ...strictWrite, networkAccess: true }, approvalPolicy: "untrusted" }, settingsB));
    assert.throws(() => verifyThreadOptions({ cwd: b, sandbox: { ...strictWrite, excludeTmpdirEnvVar: false }, approvalPolicy: "untrusted" }, settingsB));
    assert.throws(() => verifyThreadOptions({ cwd: b, sandbox: { ...strictWrite, excludeSlashTmp: false }, approvalPolicy: "untrusted" }, settingsB));
    assert.throws(() => verifyThreadOptions({ cwd: a, sandbox: { type: "readOnly", networkAccess: true }, approvalPolicy: "on-request" }, settingsA));
    assert.throws(() => resolveFolder("relative"));
    const file = join(root, "file"); writeFileSync(file, "x"); assert.throws(() => resolveFolder(file));
    rmSync(b, { recursive: true }); assert.throws(() => threadOptions(settingsB));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
