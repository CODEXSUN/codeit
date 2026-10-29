import { tmpdir } from "node:os";
import { CodexRpc } from "./codex-rpc.js";
import type { ProviderSelection } from "./providers.js";

export async function refinePrompt(text: string, selection: ProviderSelection): Promise<string> {
  const rpc = new CodexRpc();
  let threadId = "";
  let result = "";
  let finish!: (value: string) => void;
  let fail!: (error: Error) => void;
  const completed = new Promise<string>((resolve, reject) => { finish = resolve; fail = reject; });
  void completed.catch(() => {});
  const timeout = setTimeout(() => fail(new Error("Prompt refinement timed out.")), 120_000);
  rpc.onDisconnect = (reason) => fail(new Error(reason));
  rpc.onEvent = (event) => {
    if (event.id !== undefined) { rpc.reject(event.id, "Prompt refinement does not support tool requests."); return; }
    if (event.params?.threadId !== threadId) return;
    if (event.method === "item/completed" && event.params.item?.type === "agentMessage") result = event.params.item.text;
    if (event.method === "turn/completed") {
      if (event.params.turn?.status !== "completed") fail(new Error(event.params.turn?.error?.message ?? "Prompt refinement failed."));
      else if (!result.trim()) fail(new Error("Codex returned an empty refinement."));
      else finish(result);
    }
  };
  try {
    await rpc.connect();
    const thread = await rpc.request("thread/start", { cwd: tmpdir(), ephemeral: true, sandbox: "read-only", approvalPolicy: "never", baseInstructions: "You refine user prompts for coding tasks. Return only the improved prompt, preserving the user's intent and constraints. Do not answer the prompt, call tools, or add invented requirements." });
    threadId = thread.thread.id;
    await rpc.request("turn/start", { threadId, model: selection.model, effort: selection.effort, input: [{ type: "text", text, text_elements: [] }] });
    return await completed;
  } finally { clearTimeout(timeout); rpc.close(); }
}
