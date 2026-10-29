import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codexExecutable } from "../api/src/codex-executable.js";

test("Windows uses PATH first and only falls back to an unambiguous app executable", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-codex-path-"));
  try {
    const bin = join(dir, "OpenAI", "Codex", "bin");
    const first = join(bin, "version-a", "codex.exe");
    mkdirSync(join(bin, "version-a"), { recursive: true });
    mkdirSync(join(bin, "empty"));
    writeFileSync(first, "fixture");
    const env = { LOCALAPPDATA: dir, Path: "" };
    assert.equal(codexExecutable(env, "win32"), first);
    const preferredDir = join(dir, "path-bin"); mkdirSync(preferredDir);
    const preferred = join(preferredDir, "codex.exe"); writeFileSync(preferred, "fixture");
    assert.equal(codexExecutable({ ...env, Path: preferredDir }, "win32"), preferred);
    mkdirSync(join(bin, "version-b")); writeFileSync(join(bin, "version-b", "codex.exe"), "fixture");
    assert.equal(codexExecutable(env, "win32"), "codex");
    assert.equal(codexExecutable(env, "linux"), "codex");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
