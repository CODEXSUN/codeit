import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";

export const projectSettingsSchema = z.object({
  folder: z.string().trim().min(1),
  sandbox: z.enum(["read-only", "workspace-write"]),
  approvalPolicy: z.enum(["untrusted", "on-request"]),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export function resolveFolder(folder: string) {
  if (!isAbsolute(folder)) throw new Error("Enter an absolute folder path on this computer.");
  try {
    const resolved = realpathSync(folder);
    if (!statSync(resolved).isDirectory()) throw new Error();
    return resolved;
  } catch { throw new Error("The folder does not exist or is not accessible on the Codeit server."); }
}

export function threadOptions(settings: ProjectSettings) {
  return {
    cwd: resolveFolder(settings.folder), sandbox: settings.sandbox, approvalPolicy: settings.approvalPolicy,
    ...(settings.sandbox === "workspace-write" ? { config: { sandbox_workspace_write: { exclude_tmpdir_env_var: true, exclude_slash_tmp: true, network_access: false } } } : {}),
  };
}

export function verifyThreadOptions(actual: { cwd?: string; sandbox?: { type?: string; networkAccess?: boolean; writableRoots?: string[]; excludeTmpdirEnvVar?: boolean; excludeSlashTmp?: boolean }; approvalPolicy?: unknown }, requested: ProjectSettings) {
  const expectedType = requested.sandbox === "read-only" ? "readOnly" : "workspaceWrite";
  if (!actual.cwd || resolveFolder(actual.cwd) !== resolveFolder(requested.folder) || actual.sandbox?.type !== expectedType || actual.sandbox?.networkAccess !== false || actual.approvalPolicy !== requested.approvalPolicy ||
    (requested.sandbox === "workspace-write" && (!Array.isArray(actual.sandbox?.writableRoots) || actual.sandbox.writableRoots.length > 0 || actual.sandbox.excludeTmpdirEnvVar !== true || actual.sandbox.excludeSlashTmp !== true))) {
    throw new Error("Codex did not apply the requested folder and permissions. No turn was started; check Codex policy and project settings.");
  }
}
