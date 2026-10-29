import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
test('JWT generator writes only to the fixture and does not disclose its secret', () => {
  const root = mkdtempSync(join(tmpdir(), 'codeit-jwt-'));
  try {
    mkdirSync(join(root, 'tools'));
    cpSync(join(import.meta.dirname, 'env-jwt-secret.mjs'), join(root, 'tools/env-jwt-secret.mjs'));
    writeFileSync(join(root, '.env'), 'OTHER=value\nJWT_SECRET=old\n');
    const output = execFileSync(process.execPath, [join(root, 'tools/env-jwt-secret.mjs')], { encoding: 'utf8' });
    const env = readFileSync(join(root, '.env'), 'utf8');
    const secret = /^JWT_SECRET=(.+)$/mu.exec(env)[1];
    assert.match(secret, /^[a-f0-9]{64}$/u);
    assert.ok(!output.includes(secret));
    assert.match(env, /^OTHER=value$/mu);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
