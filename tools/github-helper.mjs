#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { formatChangelogCommitSubject, readLatestVersionedChangelogEntry } from "./changelog.mjs";
import { bumpNextVersion } from "./version-bump.mjs";

const ROOT = resolve(import.meta.dirname, "..");

function runGit(args, opts = {}) {
  const stdio = opts.silent ? "pipe" : "inherit";
  const result = execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio,
    ...opts
  });

  return result ? result.trim() : "";
}

export function reviewFiles(root = ROOT) {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
  const records = output.split("\0");
  const files = [];
  for (let i = 0; i < records.length && records[i]; i++) {
    const record = records[i];
    const status = record.slice(0, 2);
    const path = record.slice(3);
    const from = /[RC]/u.test(status) ? records[++i] : undefined;
    files.push({ status, path, from });
  }
  return files;
}

function runGitQuiet(args) {
  try {
    return runGit(args, { silent: true });
  } catch {
    return "";
  }
}

async function withPrompt(callback) {
  if (!process.stdin.isTTY && platform() === "win32") {
    return callback(askWindowsModal);
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      "Interactive terminal input is required for github:now. Run it from a terminal that accepts input."
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return await callback((query, defaultValue = "") => {
      return new Promise((resolveAnswer) => {
        rl.question(query, (answer) => resolveAnswer(answer || defaultValue));
      });
    });
  } finally {
    rl.close();
  }
}

function askWindowsModal(query, defaultValue = "") {
  const isConfirmation = /\[y\/N\]:\s*$/i.test(query);

  if (isConfirmation) {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      `$result = [System.Windows.Forms.MessageBox]::Show(${quotePowerShellString(
        query.replace(/\s*\[y\/N\]:\s*$/i, "")
      )}, 'GitHub Commit Review', 'YesNo', 'Question')`,
      "if ($result -eq 'Yes') { 'yes' } else { 'no' }"
    ].join("; ");

    return runPowerShellModal(script);
  }

  const script = [
    "Add-Type -AssemblyName Microsoft.VisualBasic",
    `[Microsoft.VisualBasic.Interaction]::InputBox(${quotePowerShellString(
      query
    )}, 'GitHub Commit Review', ${quotePowerShellString(defaultValue)})`
  ].join("; ");

  return runPowerShellModal(script);
}

function runPowerShellModal(script) {
  return execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    encoding: "utf8",
    windowsHide: false
  }).trim();
}

function quotePowerShellString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function renderReviewBox({ fileCount, subject, version }) {
  const rows = [
    "GitHub Commit Review",
    `Version: ${version}`,
    `Subject: ${subject}`,
    `Files: ${fileCount}`
  ];
  const width = Math.max(...rows.map((row) => row.length)) + 4;
  const border = `+${"-".repeat(width)}+`;
  const lines = rows.map((row) => `| ${row.padEnd(width - 2)} |`);

  return ["", border, ...lines, border, ""].join("\n");
}

function isYes(value) {
  return ["y", "yes"].includes(value.trim().toLowerCase());
}

export async function main(prompt = withPrompt, args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== "--dry-run")) throw new Error("Usage: github:now [--dry-run]");
  const dryRun = args.includes("--dry-run");
  let changelogEntry = readLatestVersionedChangelogEntry(ROOT);
  let defaultMessage = formatChangelogCommitSubject(changelogEntry);
  const files = reviewFiles();

  console.log(`\n  Changelog version: ${changelogEntry.version}`);
  console.log(`  Commit subject:    ${defaultMessage}`);
  console.log(`  Uncommitted:       ${files.length} files\n`);

  if (files.length > 0) {
    files.forEach(({ status, path, from }) => console.log(`    ${status} ${JSON.stringify(path)}${from ? ` <- ${JSON.stringify(from)}` : ""}`));
    if (files.some(({ path, from }) => [path, from].some((name) => name && /(^|\/)\.idea(?:\/|$)/iu.test(name)))) {
      console.log("\n  Warning: local .idea files are included in the staging scope.");
    }
    console.log("");
  }

  if (dryRun) {
    console.log(
      renderReviewBox({
        fileCount: files.length,
        subject: defaultMessage,
        version: changelogEntry.version
      })
    );
    console.log("  Dry run only. No pull, commit, or push was performed.\n");
    return;
  }

  const message = await prompt(async (ask) => {
    console.log(
      renderReviewBox({
        fileCount: files.length,
        subject: defaultMessage,
        version: changelogEntry.version
      })
    );

    const shouldBump = await ask("  Bump next version before commit? [y/N]: ");

    if (isYes(shouldBump)) {
      const titleAnswer = await ask("  Version title [version update]: ", "version update");
      const title = titleAnswer.trim() || "version update";
      const bump = bumpNextVersion(ROOT, title);

      changelogEntry = readLatestVersionedChangelogEntry(ROOT);
      defaultMessage = formatChangelogCommitSubject(changelogEntry);

      console.log(`\n  Bumped ${bump.currentVersion} -> ${bump.nextVersion}`);
      console.log(`  Commit subject: ${defaultMessage}\n`);
    }

    const answer = await ask(`  Commit message [${defaultMessage}]: `, defaultMessage);
    const subject = answer.trim() || defaultMessage;
    if (subject !== defaultMessage) throw new Error("Commit subject must match the latest changelog entry.");
    const confirm = await ask("  Continue with Git actions? [y/N]: ");

    if (!isYes(confirm)) {
      throw new Error("Cancelled.");
    }

    return subject;
  });

  const upstream = runGitQuiet(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (!upstream) {
    const local = await prompt((ask) => ask("  No upstream configured. Commit locally? [y/N]: "));
    if (!isYes(local)) throw new Error("Cancelled.");
  } else {
    const remote = await prompt((ask) => ask("  Pull and push the configured upstream? [y/N]: "));
    if (!isYes(remote)) throw new Error("Cancelled.");
    checkAndPull();
  }

  const approvedTree = await stageReviewedFiles(ROOT, prompt);

  console.log(`  > git commit -m "${message}"`);
  runGit(["commit", "-m", message]);
  const committedTree = runGit(["rev-parse", "HEAD^{tree}"], { silent: true });
  if (committedTree !== approvedTree) throw new Error("Commit tree differs from the reviewed tree. No push was performed. Inspect HEAD, hooks, and the index; preserve the commit and resolve it manually before proceeding.");

  if (upstream) {
    console.log("  > git push");
    runGit(["push"]);
  }

  console.log(`\n  Done - ${message}\n`);
}

export async function stageReviewedFiles(root, prompt) {
  const indexPath = resolve(root, execFileSync("git", ["rev-parse", "--git-path", "index"], { cwd: root, encoding: "utf8" }).trim());
  const original = existsSync(indexPath) ? readFileSync(indexPath) : null;
  const temp = mkdtempSync(join(tmpdir(), "codeit-review-"));
  const tempIndex = join(temp, "index");
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  const git = (args, options = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
  try {
    if (original) writeFileSync(tempIndex, original);
    else git(["read-tree", "HEAD"], { env });
    const before = reviewFiles(root);
    git(["add", "-A"], { env });
    const approvedTree = git(["write-tree"], { env });
    const finalFiles = reviewFiles(root);
    if (JSON.stringify(before) !== JSON.stringify(finalFiles)) throw new Error("Files changed while preparing review. Retry.");
    console.log("\n  Final staging scope:");
    finalFiles.forEach(({ status, path, from }) => console.log(`    ${status} ${JSON.stringify(path)}${from ? ` <- ${JSON.stringify(from)}` : ""}`));
    if (finalFiles.some(({ path, from }) => [path, from].some((name) => name && /(^|\/)\.idea(?:\/|$)/iu.test(name)))) console.log("  Warning: local .idea files are included in the staging scope.");
    const stage = await prompt((ask) => ask(`  Stage these ${finalFiles.length} entries with git add -A? [y/N]: `));
    if (!isYes(stage)) throw new Error("Cancelled.");
    const current = existsSync(indexPath) ? readFileSync(indexPath) : null;
    if (!sameBytes(original, current)) throw new Error("Git index changed during review. Retry.");
    git(["add", "-A"], { env });
    if (git(["write-tree"], { env }) !== approvedTree) throw new Error("Files changed after review. No staging was performed; retry.");
    const lockPath = `${indexPath}.lock`;
    let locked = false;
    try {
      writeFileSync(lockPath, readFileSync(tempIndex), { flag: "wx" });
      locked = true;
      const latest = existsSync(indexPath) ? readFileSync(indexPath) : null;
      if (!sameBytes(original, latest)) throw new Error("Git index changed during review. Retry.");
      renameSync(lockPath, indexPath);
      locked = false;
    } finally { if (locked) rmSync(lockPath, { force: true }); }
    console.log("  Staged the reviewed tree.");
    return approvedTree;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
function sameBytes(a, b) { return a === null ? b === null : b !== null && a.equals(b); }

function checkAndPull() {
  const upstream = runGitQuiet([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}"
  ]);
  if (!upstream) {
    console.log("\n  No upstream branch found. Skipping pull.\n");
    return;
  }

  console.log("\n  > git fetch");
  runGit(["-c", "maintenance.auto=false", "-c", "gc.auto=0", "fetch", "--quiet"]);

  const behind = Number(runGitQuiet(["rev-list", "--count", `HEAD..${upstream}`]) || 0);
  if (!behind) {
    console.log("  Already up to date.\n");
    return;
  }

  console.log(`  Branch is behind ${upstream} by ${behind} commit(s).`);
  console.log("  > git pull --rebase --autostash");
  runGit(["-c", "maintenance.auto=false", "-c", "gc.auto=0", "pull", "--rebase", "--autostash"]);
  console.log("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n  Error: ${error.message}\n`);
    process.exit(1);
  });
}
