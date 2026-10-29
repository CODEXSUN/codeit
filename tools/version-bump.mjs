import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendEntry, CHANGELOG_PATH, validLine } from './changelog.mjs';

export function bumpPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match || !Number.isSafeInteger(Number(match[3]) + 1)) throw new Error(`Unsupported version format: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}
export function bumpNextVersion(root, title = 'version update', options = {}) {
  title = validLine(title, 'Title');
  if (![true, false, undefined].includes(options.databaseUpdate)) throw new Error('Invalid database update value.');
  const packagePath = join(root, 'package.json');
  const lockPath = join(root, 'package-lock.json');
  const logPath = join(root, CHANGELOG_PATH);
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const nextVersion = bumpPatch(pkg.version);
  const currentVersion = pkg.version;
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
  if (lock && (lock.version !== currentVersion || lock.packages?.['']?.version !== currentVersion)) throw new Error('Lockfile version does not match package.json.');
  let log = readFileSync(logPath, 'utf8');
  if (!/^Current version: .+$/mu.test(log) || !/^Release tag: .+$/mu.test(log) || !/^Changelog label: .+$/mu.test(log)) throw new Error('Invalid changelog metadata.');
  if (!log.split(/\r?\n/u).includes(`Current version: ${currentVersion}`) || !log.split(/\r?\n/u).includes(`Release tag: v-${currentVersion}`) || !log.split(/\r?\n/u).includes(`Changelog label: v ${currentVersion}`) || !log.split(/\r?\n/u).includes(`## v-${currentVersion}`) || log.split(/\r?\n/u).includes(`## v-${nextVersion}`)) throw new Error('Changelog does not match the current version.');
  const databaseUpdate = options.databaseUpdate ?? detectDatabaseChanges(root);
  log = log.replace(/^Current version: .*$/mu, `Current version: ${nextVersion}`).replace(/^Release tag: .*$/mu, `Release tag: v-${nextVersion}`).replace(/^Changelog label: .*$/mu, `Changelog label: v ${nextVersion}`);
  log = appendEntry(log, nextVersion, title, `Bumped workspace version to ${nextVersion}.`, databaseUpdate ? 'Yes' : 'No');
  pkg.version = nextVersion;
  if (lock) {
    if (lock.version === currentVersion) lock.version = nextVersion;
    if (lock.packages?.['']?.version === currentVersion) lock.packages[''].version = nextVersion;
  }
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  if (lock) writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  writeFileSync(logPath, log);
  return { currentVersion, nextVersion, title };
}
function detectDatabaseChanges(root) {
  const output = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  return output.split('\0').some(line => {
    const path = line.slice(3).replaceAll('\\', '/');
    return /^api\/src\/(?:storage|import-json)\.ts$/iu.test(path) ||
      /(?:^|\/)(?:migrations|migration-manager|tenant-database|infrastructure\/database|database|src\/db)\/|(?:^|[.\/])(?:schema|migration|database)\.ts$/iu.test(path);
  });
}
function main(args) {
  let title = 'version update'; let databaseUpdate; let seen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--title' || arg === '-t') { if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--title requires a value.'); title = args[++i]; }
    else if (['--database-update', '--db-update', '--db', '--no-database-update', '--no-db-update', '--no-db'].includes(arg)) { if (seen) throw new Error('Specify database update once.'); seen = true; databaseUpdate = !arg.startsWith('--no-'); }
    else if (arg.startsWith('--database-update=')) { if (seen || !/^(yes|no|true|false|1|0)$/u.test(arg.slice(18))) throw new Error('Invalid database update value.'); seen = true; databaseUpdate = ['yes', 'true', '1'].includes(arg.slice(18)); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const result = bumpNextVersion(resolve(import.meta.dirname, '..'), title, { databaseUpdate });
  console.log(`Bumped ${result.currentVersion} -> ${result.nextVersion}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
