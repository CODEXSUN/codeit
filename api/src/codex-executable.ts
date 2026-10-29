import { readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export function codexExecutable(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return "codex";
  const path = env.Path ?? env.PATH ?? "";
  for (const folder of path.split(delimiter)) {
    if (!folder) continue;
    const candidate = join(folder.replace(/^"|"$/g, ""), "codex.exe");
    if (isFile(candidate)) return candidate;
  }
  if (!env.LOCALAPPDATA) return "codex";
  const directory = join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
  try {
    const candidates = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name, "codex.exe")).filter(isFile);
    if (candidates.length === 1) return candidates[0];
  } catch {}
  return "codex";
}

function isFile(path: string) { try { return statSync(path).isFile(); } catch { return false; } }
