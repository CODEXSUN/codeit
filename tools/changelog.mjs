import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHANGELOG_PATH = join('agent', 'documentation', 'changelog.md');
export function validLine(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/u.test(value)) throw new Error(`${name} must be a non-empty single line.`);
  return value.trim();
}
export function formatLocalTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours() % 12 || 12)}:${pad(date.getMinutes())} ${date.getHours() >= 12 ? 'pm' : 'am'}`;
}
export function parseLatestVersionedChangelogEntry(content) {
  const match = /^### \[v (\d+\.\d+\.\d+)\] \d{4}-\d{2}-\d{2}(?: \d{1,2}:\d{2} (?:am|pm))? - ([^\r\n]+)\r?$/mu.exec(content);
  if (!match) throw new Error('No valid versioned changelog entry.');
  const [, version, rawTitle] = match;
  const [, minor, patch] = version.split('.');
  return { version, title: validLine(rawTitle, 'Title'), commitReference: `${Number(minor)}.${Number(patch)}` };
}
export function readLatestVersionedChangelogEntry(root) {
  const content = readFileSync(join(root, CHANGELOG_PATH), 'utf8');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const lines = content.split(/\r?\n/u);
  const firstHeading = lines.find(line => /^## v-/u.test(line));
  const entry = parseLatestVersionedChangelogEntry(content);
  if (entry.version !== version || firstHeading !== `## v-${version}` || !lines.includes(`Current version: ${version}`) || !lines.includes(`Release tag: v-${version}`) || !lines.includes(`Changelog label: v ${version}`)) throw new Error('Changelog does not match the current version.');
  return entry;
}
export function formatChangelogCommitSubject(entry) { return `#${entry.commitReference} - ${validLine(entry.title, 'Title')}`; }
export function appendEntry(content, version, title, note, databaseUpdate) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('Invalid version.');
  title = validLine(title, 'Title'); note = validLine(note, 'Note');
  if (!['Yes', 'No'].includes(databaseUpdate)) throw new Error('Database update must be Yes or No.');
  const entry = `### [v ${version}] ${formatLocalTimestamp(new Date())} - ${title}\n\n#### Database Changes\n\n- Database update: ${databaseUpdate}.\n\n#### App Codebase Changes\n\n- ${note}\n\n`;
  const header = `## v-${version}`;
  const lines = content.split(/(?<=\n)/u);
  const index = lines.findIndex(line => line.replace(/\r?\n$/u, '') === header);
  if (index >= 0) { lines.splice(index + 1, 0, `\n${entry}`); return lines.join(''); }
  const first = lines.findIndex(line => /^## v-\d+\.\d+\.\d+\r?\n?$/u.test(line));
  if (first >= 0) { lines.splice(first, 0, `${header}\n\n${entry}`); return lines.join(''); }
  return `${content}${content.endsWith('\n') ? '\n' : '\n\n'}${header}\n\n${entry}`;
}
function main(args) {
  const values = { '--title': 'Foundation progress', '--note': 'Updated foundation work.', '--database-update': 'No' };
  for (let i = 0; i < args.length; i += 2) {
    if (!(args[i] in values) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: changelog:append [--title text] [--note text] [--database-update Yes|No]');
    values[args[i]] = args[i + 1];
  }
  const root = process.cwd();
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const file = join(root, CHANGELOG_PATH);
  const updated = appendEntry(readFileSync(file, 'utf8'), version, values['--title'], values['--note'], values['--database-update']);
  writeFileSync(file, updated);
  console.log(`Appended changelog entry for v-${version}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
