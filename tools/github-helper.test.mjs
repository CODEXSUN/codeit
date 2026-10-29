import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codeit-git-'));
  mkdirSync(join(root, 'agent/documentation'), { recursive: true });
  mkdirSync(join(root, 'tools'));
  for (const file of ['github-helper.mjs', 'changelog.mjs', 'version-bump.mjs']) cpSync(join(import.meta.dirname, file), join(root, 'tools', file));
  writeFileSync(join(root, 'package.json'), '{"version":"1.0.1"}\n');
  writeFileSync(join(root, 'agent/documentation/changelog.md'), 'Current version: 1.0.1\nRelease tag: v-1.0.1\nChangelog label: v 1.0.1\n\n## v-1.0.1\n\n### [v 1.0.1] 2026-10-29 - Fixture\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  git('add', '.'); git('commit', '-m', 'Initial');
  writeFileSync(join(root, 'change.txt'), 'change');
  const { main, reviewFiles } = await import(pathToFileURL(join(root, 'tools/github-helper.mjs')).href);
  return { root, git, main, reviewFiles };
}
function answers(values) { return async callback => callback(async () => values.shift() ?? ''); }
test('dry run and declined local commit do not mutate Git', async () => {
  const f = await fixture();
  try {
    const head = f.git('rev-parse', 'HEAD');
    await f.main(answers([]), ['--dry-run']);
    await assert.rejects(f.main(answers(['no', '', 'yes', 'no']), []), /Cancelled/u);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.match(f.git('status', '--porcelain'), /\?\? change.txt/u);
    assert.equal(f.git('remote'), '');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('no upstream commits only after explicit local choice', async () => {
  const f = await fixture();
  try {
    const trace = join(tmpdir(), `codeit-git-trace-${process.pid}.log`);
    process.env.GIT_TRACE = trace;
    try { await f.main(answers(['no', '', 'yes', 'yes', 'yes']), []); } finally { delete process.env.GIT_TRACE; }
    const commands = readFileSync(trace, 'utf8');
    rmSync(trace, { force: true });
    assert.doesNotMatch(commands, /built-in: git (?:fetch|pull|push)\b/u);
    assert.equal(f.git('log', '-1', '--format=%s'), '#0.1 - Fixture');
    assert.equal(f.git('remote'), '');
    assert.equal(readFileSync(join(f.root, 'change.txt'), 'utf8'), 'change');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('review expands untracked directories and safely represents renames', async () => {
  const f = await fixture();
  try {
    mkdirSync(join(f.root, '.idea'));
    mkdirSync(join(f.root, 'nested'));
    writeFileSync(join(f.root, '.idea', 'workspace.xml'), 'local');
    writeFileSync(join(f.root, 'nested', 'space name.txt'), 'one');
    writeFileSync(join(f.root, 'nested', 'other.txt'), 'two');
    f.git('mv', 'package.json', 'renamed package.json');
    const files = f.reviewFiles(f.root);
    assert.ok(files.some(file => file.path === '.idea/workspace.xml'));
    assert.ok(files.some(file => file.path === 'nested/space name.txt'));
    assert.ok(files.some(file => file.path === 'nested/other.txt'));
    assert.ok(files.some(file => file.path === 'renamed package.json' && file.from === 'package.json'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('declining final staging confirmation leaves the index and commit unchanged', async () => {
  const f = await fixture();
  try {
    const head = f.git('rev-parse', 'HEAD');
    await assert.rejects(f.main(answers(['no', '', 'yes', 'yes', 'no']), []), /Cancelled/u);
    assert.equal(f.git('rev-parse', 'HEAD'), head);
    assert.equal(f.git('diff', '--cached', '--name-only'), '');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('review races abort and preserve the pre-existing index', async () => {
  for (const scenario of ['content', 'new', 'delete', 'rename']) {
    const f = await fixture();
    try {
      writeFileSync(join(f.root, 'staged.txt'), 'already staged');
      f.git('add', 'staged.txt');
      const indexBefore = f.git('write-tree');
      const head = f.git('rev-parse', 'HEAD');
      const values = ['no', '', 'yes', 'yes', 'yes'];
      const prompt = async callback => callback(async question => {
        if (question.includes('Stage these')) {
          if (scenario === 'content') writeFileSync(join(f.root, 'change.txt'), 'changed after review');
          if (scenario === 'new') writeFileSync(join(f.root, 'late.txt'), 'late');
          if (scenario === 'delete') rmSync(join(f.root, 'change.txt'));
          if (scenario === 'rename') renameSync(join(f.root, 'change.txt'), join(f.root, 'renamed.txt'));
        }
        return values.shift() ?? '';
      });
      await assert.rejects(f.main(prompt, []), /Files changed after review/u);
      assert.equal(f.git('write-tree'), indexBefore, scenario);
      assert.equal(f.git('rev-parse', 'HEAD'), head, scenario);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('a hook that changes the index blocks push and leaves the commit for review', async () => {
  const f = await fixture();
  try {
    const hook = join(f.root, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nprintf hook-modified > change.txt\ngit add change.txt\n', { mode: 0o755 });
    const head = f.git('rev-parse', 'HEAD');
    await assert.rejects(f.main(answers(['no', '', 'yes', 'yes', 'yes']), []), /Commit tree differs from the reviewed tree.*No push/u);
    assert.notEqual(f.git('rev-parse', 'HEAD'), head);
    assert.equal(f.git('show', 'HEAD:change.txt'), 'hook-modified');
    assert.equal(f.git('remote'), '');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
