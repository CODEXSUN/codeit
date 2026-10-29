import { z } from "zod";

const versionSchema = z.object({ version: z.number().int().nonnegative(), projects: z.record(z.string(), z.unknown()) }).passthrough();

/** Migrate known document versions before validating the current shape. */
export function migrateIdeasDocument(value: unknown) {
  const document = versionSchema.parse(value);
  if (document.version > 1) throw new Error("Unsupported Ideas document version.");
  if (document.version === 0) return { document: { ...document, version: 1 }, changed: true };
  return { document, changed: false };
}
