import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./storage.js";

export function acquireStorageLock(directory?: string) {
  const dir = dataDirectory(directory);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "codeit-storage.lock");
  let fd: number;
  try { fd = openSync(path, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Codeit storage is locked. Stop the other process, or inspect and remove the stale lock after a crash.");
    throw error;
  }
  try { writeFileSync(fd, `${process.pid}\n`); }
  catch (error) { closeSync(fd); unlinkSync(path); throw error; }
  let closed = false;
  return () => { if (!closed) { closed = true; closeSync(fd); unlinkSync(path); } };
}
