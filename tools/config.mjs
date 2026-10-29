import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));

export function loadConfig() {
  try { if (existsSync(envFile)) process.loadEnvFile(envFile); }
  catch { throw new Error("Could not read the Codeit .env file."); }
  validatePort("CODEIT_WEB_PORT", "9020");
  validatePort("CODEIT_API_PORT", "9030");
  const dataDir = process.env.CODEIT_DATA_DIR;
  if (dataDir !== undefined && (!dataDir.trim() || dataDir.includes("\0"))) throw new Error("CODEIT_DATA_DIR must be a valid directory path.");
  try { if (dataDir && existsSync(dataDir) && !statSync(dataDir).isDirectory()) throw new Error(); }
  catch { throw new Error("CODEIT_DATA_DIR must be a valid directory path."); }
}

function validatePort(name, expected) {
  const value = process.env[name] ?? expected;
  if (value !== expected) throw new Error(`${name} must be ${expected}; Codeit uses reserved local ports.`);
}
