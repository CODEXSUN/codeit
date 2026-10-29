import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bumpNextVersion, bumpPatch } from './version-bump.mjs';
import { appendEntry, parseLatestVersionedChangelogEntry, formatChangelogCommitSubject, formatLocalTimestamp } from './changelog.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codeit-release-'));
  mkdirSync(join(root, 'agent/documentation'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'codeit', version: '1.0.1' }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: '1.0.1', packages: { '': { version: '1.0.1' }, 'node_modules/external': { version: '1.0.1', dependencies: { '@codexsun/test': '^1.0.1' } } } }));
  writeFileSync(join(root, 'agent/documentation/changelog.md'), 'Current version: 1.0.1\nRelease tag: v-1.0.1\nChangelog label: v 1.0.1\n\n## v-1.0.1\n\n### [v 1.0.1] 2026-10-29 - Original\n');
  return root;
}
test('bump preserves history and external lock pins', () => {
  const root = fixture();
  try {
    bumpNextVersion(root, 'New release', { databaseUpdate: false });
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
    assert.equal(lock.version, '1.0.2');
    assert.equal(lock.packages['node_modules/external'].dependencies['@codexsun/test'], '^1.0.1');
    const content = readFileSync(join(root, 'agent/documentation/changelog.md'), 'utf8');
    assert.match(content, /## v-1\.0\.1\n\n### \[v 1\.0\.1\] 2026-10-29 - Original/u);
    assert.match(content, /### \[v 1\.0\.2\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} (?:am|pm) - New release/u);
    assert.equal(parseLatestVersionedChangelogEntry(content).version, '1.0.2');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('malformed inputs do not mutate files', () => {
  for (const issue of ['title', 'lock', 'metadata', 'duplicate']) {
    const root = fixture();
    try {
      const log = join(root, 'agent/documentation/changelog.md');
      if (issue === 'lock') writeFileSync(join(root, 'package-lock.json'), '{');
      if (issue === 'metadata') writeFileSync(log, 'bad');
      if (issue === 'duplicate') writeFileSync(log, readFileSync(log, 'utf8') + '\n## v-1.0.2\n');
      const files = ['package.json', 'package-lock.json', 'agent/documentation/changelog.md'];
      const before = files.map(file => readFileSync(join(root, file), 'utf8'));
      assert.throws(() => bumpNextVersion(root, issue === 'title' ? 'bad\ntitle' : 'valid', { databaseUpdate: false }));
      assert.deepEqual(files.map(file => readFileSync(join(root, file), 'utf8')), before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  assert.throws(() => bumpPatch('1.0.1x'));
  assert.throws(() => bumpPatch('1.0.9007199254740991'));
});
test('append matches the complete version heading', () => {
  const content = '## v-1.0.10\n\nHistorical\n\n## v-1.0.1\n\nOld\n';
  const updated = appendEntry(content, '1.0.1', 'Entry', 'Note', 'No');
  assert.match(updated, /## v-1\.0\.10\n\nHistorical\n\n## v-1\.0\.1\n\n### \[v 1\.0\.1\]/u);
  assert.equal(formatChangelogCommitSubject(parseLatestVersionedChangelogEntry(updated)), '#0.1 - Entry');
});

test('timestamp format uses local time and preserves date-only history', () => {
  assert.equal(formatLocalTimestamp(new Date(2026, 9, 29, 15, 45)), '2026-10-29 03:45 pm');
  assert.equal(formatLocalTimestamp(new Date(2026, 9, 29, 0, 5)), '2026-10-29 12:05 am');
  assert.equal(parseLatestVersionedChangelogEntry('### [v 1.0.1] 2026-10-29 03:45 pm - Current').title, 'Current');
  assert.equal(parseLatestVersionedChangelogEntry('### [v 1.0.10] 2026-10-29 - Historical').version, '1.0.10');
});

test('automatic database detection covers Codeit storage and JSON import', () => {
  for (const file of ['storage.ts', 'import-json.ts']) {
    const root = fixture();
    try {
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      mkdirSync(join(root, 'api/src'), { recursive: true });
      writeFileSync(join(root, 'api/src', file), 'fixture');
      bumpNextVersion(root, 'Database change');
      assert.match(readFileSync(join(root, 'agent/documentation/changelog.md'), 'utf8'), /Database update: Yes\./u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
