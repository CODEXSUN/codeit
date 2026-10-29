import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("loads safe configuration and preserves environment overrides without exposing secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "codeit-config-test-"));
  mkdirSync(join(dir, "tools"));
  writeFileSync(join(dir, "tools", "config.mjs"), readFileSync(new URL("./config.mjs", import.meta.url)));
  const moduleUrl = pathToFileURL(join(dir, "tools", "config.mjs")).href;
  const env = { ...process.env };
  for (const name of ["CODEIT_WEB_PORT", "CODEIT_API_PORT", "CODEIT_DATA_DIR", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete env[name];
  const command = `import {loadConfig} from ${JSON.stringify(moduleUrl)}; loadConfig(); process.stdout.write(process.env.CODEIT_DATA_DIR ?? "default");`;
  try {
    writeFileSync(join(dir, ".env"), "CODEIT_WEB_PORT=9020\nCODEIT_API_PORT=9030\nCODEIT_DATA_DIR=from-file\nGEMINI_API_KEY=secret-sentinel\n");
    assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", command], { env, encoding: "utf8" }), "from-file");
    assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", command], { env: { ...env, CODEIT_DATA_DIR: "from-environment" }, encoding: "utf8" }), "from-environment");
    const invalid = spawnSync(process.execPath, ["--input-type=module", "-e", command], { env: { ...env, CODEIT_API_PORT: "secret-sentinel" }, encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /CODEIT_API_PORT must be 9030/);
    assert(!`${invalid.stdout}${invalid.stderr}`.includes("secret-sentinel"));
    const empty = spawnSync(process.execPath, ["--input-type=module", "-e", command], { env: { ...env, CODEIT_DATA_DIR: "" }, encoding: "utf8" });
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /CODEIT_DATA_DIR must be a valid directory path/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
