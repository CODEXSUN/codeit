import { z } from "zod";

export const selectionSchema = z.object({
  provider: z.enum(["codex", "gemini"]),
  model: z.string().min(1).max(200).optional(),
  effort: z.string().min(1).max(100).optional(),
});
export type ProviderSelection = z.infer<typeof selectionSchema>;
export type CodexModel = { model: string; displayName: string; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: { reasoningEffort: string; description: string }[]; inputModalities: string[] };

export function codexDiscoveryReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Codex CLI could not start. Install Codex and sign in.") return "Codex CLI could not start. Install Codex, sign in, and restart Codeit with Codex on its PATH.";
  if (message === "Codex disconnected." || message === "The Codex connection closed.") return "Codex disconnected during model discovery. Check the CLI and sign-in, then retry.";
  if (message.startsWith("Codex did not answer ")) return "Codex did not answer model discovery. Check the CLI and retry.";
  return "Codex model discovery failed. Check the Codex connection and sign-in, then retry.";
}

export function validateSelection(selection: ProviderSelection, models: CodexModel[], hasImage = false) {
  if (selection.provider !== "codex") throw new Error("Gemini is unavailable: no Gemini integration is configured in Codeit.");
  if (!selection.model) throw new Error("Select a Codex model before sending.");
  const model = models.find((item) => item.model === selection.model);
  if (!model) throw new Error("The selected Codex model is no longer available. Choose another model.");
  if (selection.effort && !model.supportedReasoningEfforts.some((item) => item.reasoningEffort === selection.effort)) throw new Error("The selected reasoning level is not supported by this model.");
  if (hasImage && !model.inputModalities.includes("image")) throw new Error("The selected model does not support image inputs. Remove the image or select another model.");
}
