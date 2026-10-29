#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) {
  console.error(".env file not found at", envPath);
  process.exit(1);
}

const secret = randomBytes(32).toString("hex");

const content = readFileSync(envPath, "utf8");
const hasJwtSecret = /^JWT_SECRET=/m.test(content);

let updated;
if (hasJwtSecret) {
  updated = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret}`);
} else {
  updated = content.endsWith("\n")
    ? `${content}JWT_SECRET=${secret}\n`
    : `${content}\nJWT_SECRET=${secret}\n`;
}

writeFileSync(envPath, updated);
console.log(`JWT_SECRET generated and written to .env`);
