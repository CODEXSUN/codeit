#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const output = globalThis.console;

const options = parseOptions(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const repositoryRoot = resolve(import.meta.dirname, "..");
const repositoryTemp = join(repositoryRoot, "dist", ".tmp");
mkdirSync(repositoryTemp, { mode: 0o700, recursive: true });
chmodSync(repositoryTemp, 0o700);

const directory = mkdtempSync(join(repositoryTemp, "github-ssh-key-"));
const privateKeyPath = join(directory, "github_codexsun");
const publicKeyPath = `${privateKeyPath}.pub`;
const comment = options.comment ?? `codexsun-server@${hostname()}`;

try {
  chmodSync(directory, 0o700);
  execFileSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-C", comment, "-f", privateKeyPath, "-N", ""],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  output.error(`Unable to generate the GitHub SSH key: ${detail}`);
  output.error("Install OpenSSH/ssh-keygen and run the command again.");
  process.exit(1);
}

if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
  output.error("ssh-keygen completed without creating the expected keypair.");
  process.exit(1);
}

chmodSync(privateKeyPath, 0o600);
chmodSync(publicKeyPath, 0o644);

const publicKey = readFileSync(publicKeyPath, "utf8").trim();
if (!publicKey.startsWith("ssh-ed25519 ")) {
  output.error("The generated public key is not an ED25519 SSH key.");
  process.exit(1);
}

if (options.json) {
  output.log(JSON.stringify({ comment, directory, privateKeyPath, publicKey, publicKeyPath }));
} else {
  output.log("GitHub SSH keypair generated in the repository's ignored dist/.tmp directory.");
  output.log(`Private key: ${privateKeyPath}`);
  output.log(`Public key:  ${publicKeyPath}`);
  output.log("");
  output.log("Add this public key to GitHub:");
  output.log(publicKey);
  output.log("");
  output.log("Keep the private key secret and move it to ~/.ssh on the target server.");
}

function parseOptions(args) {
  const parsed = { comment: undefined, help: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (argument === "--json") {
      parsed.json = true;
      continue;
    }
    if (argument === "--comment") {
      const value = args[index + 1]?.trim();
      if (!value) fail("--comment requires a non-empty value.");
      parsed.comment = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function fail(message) {
  output.error(message);
  output.error("Run npm run github:ssh-key -- --help for usage.");
  process.exit(1);
}

function printHelp() {
  output.log(`Generate a temporary ED25519 keypair for CODEXSUN server access to GitHub.

Usage:
  npm run github:ssh-key
  npm run github:ssh-key -- --comment "codexsun-server"
  npm run github:ssh-key -- --json

The keypair is created under this repository's ignored dist/.tmp directory. It is never
tracked by Git. The command prints the public key for GitHub setup.`);
}
