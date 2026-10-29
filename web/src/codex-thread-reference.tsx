import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { copyText } from "./copy-text.js";

const baselineSchema = z.object({ threadId: z.uuid(), name: z.string() });
const referenceSchema = z.union([z.object({ threadId: z.null() }), z.object({ threadId: z.uuid(), codeitName: z.string(), codexName: z.string().nullable(), baseline: baselineSchema.nullable(), syncState: z.enum(["matched", "matched_unrecorded", "unbased", "codex_untitled", "codeit_changed", "codex_changed", "conflict"]) })]);
type Choice = "codeit" | "codex" | "record";
const stateLabels: Record<string, string> = { matched: "Names matched at last check", matched_unrecorded: "Names match; baseline not recorded", unbased: "Names differ; no baseline", codex_untitled: "Codex has no title", codeit_changed: "Codeit name changed since last sync", codex_changed: "Codex name changed since last sync", conflict: "Both names changed since last sync" };

export function CodexThreadReference({ chatId, chatName, active, refresh }: { chatId: string; chatName: string; active: boolean; refresh: number }) {
  const [reference, setReference] = useState<z.infer<typeof referenceSchema>>();
  const [feedback, setFeedback] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"success" | "error">("success");
  const [syncError, setSyncError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<Choice>();
  const [saving, setSaving] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setReference(undefined); setChoice(undefined); if (feedbackKind === "success") setFeedback("");
    fetch(`/api/chats/${encodeURIComponent(chatId)}/codex-thread`).then(async (response) => {
      if (!response.ok) throw new Error("Could not verify the Codex thread. Check the connection and retry.");
      const result = referenceSchema.parse(await response.json());
      if (!cancelled) { setReference(result); setFeedback((current) => current === "Could not verify the Codex thread. Check the connection and retry." ? "" : current); }
    }).catch(() => { if (!cancelled) { setFeedbackKind("error"); setFeedback("Could not verify the Codex thread. Check the connection and retry."); } });
    return () => { cancelled = true; };
  }, [chatId, chatName, active, refresh, attempt]);
  async function copy() {
    if (!reference?.threadId) return;
    try { await copyText(reference.threadId, navigator.clipboard); setFeedbackKind("success"); setFeedback("Thread ID copied. To resume in the Codex CLI, run codex resume followed by the ID."); }
    catch { setFeedbackKind("error"); setFeedback("Could not copy the thread ID. Check clipboard permissions."); }
  }
  async function synchronize() {
    if (!reference?.threadId || !choice || saving) return;
    setSaving(true); setFeedback(""); setFeedbackKind("success"); setSyncError("");
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/codex-name-sync`, {
        method: "POST", headers: { "content-type": "application/json", "x-codeit-request": "1" },
        body: JSON.stringify({ threadId: reference.threadId, codeitName: reference.codeitName, codexName: reference.codexName, baseline: reference.baseline, choice, confirmed: true }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not synchronize names. Recheck both names.");
      setFeedbackKind("success"); setFeedback("Names matched when last verified.");
    } catch (error) { setSyncError(error instanceof Error ? error.message : "Could not synchronize names. Recheck both names."); }
    finally {
      setSaving(false); setChoice(undefined);
      window.dispatchEvent(new Event("codeit:projects-changed"));
      setAttempt((value) => value + 1);
    }
  }
  if (!reference?.threadId && !feedback && !syncError) return null;
  return <div className="codex-thread-reference">
    {reference?.threadId && <><span>Codeit: {reference.codeitName} · Codex: {reference.codexName ?? "No title reported"} · {stateLabels[reference.syncState]}</span><span>Thread ID: {reference.threadId}</span><button type="button" disabled={saving} onClick={() => setAttempt((value) => value + 1)}>Recheck names</button><button type="button" className="icon-button" aria-label="Copy Codex thread ID" title="Copy Codex thread ID" onClick={() => void copy()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" /></svg></button>
      {reference.syncState === "matched_unrecorded" ? <button type="button" disabled={saving} onClick={(event) => { trigger.current = event.currentTarget; setChoice("record"); }}>Record matched names</button> : reference.syncState !== "matched" && <><button type="button" disabled={saving} onClick={(event) => { trigger.current = event.currentTarget; setChoice("codeit"); }}>Use Codeit name</button><button type="button" disabled={saving || !reference.codexName || reference.codexName.length > 100 || reference.codexName.trim() !== reference.codexName} onClick={(event) => { trigger.current = event.currentTarget; setChoice("codex"); }}>Use Codex name</button></>}
    </>}
    {choice && reference?.threadId && <div className="dialog-backdrop"><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="name-sync-title" onKeyDown={(event) => {
      if (event.key === "Escape" && !saving) { setChoice(undefined); trigger.current?.focus(); }
      if (event.key === "Tab") { const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"); if (buttons.length && ((event.shiftKey && document.activeElement === buttons[0]) || (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]))) { event.preventDefault(); (event.shiftKey ? buttons[buttons.length - 1] : buttons[0]).focus(); } }
    }}><h2 id="name-sync-title">Confirm name choice</h2><p>Codeit: {reference.codeitName}</p><p>Codex: {reference.codexName ?? "No title reported"}</p><p>{choice === "codeit" ? "Set the Codex title to the Codeit name. Codex has no atomic conflict check; a change made after the final check could be overwritten." : choice === "codex" ? "Set the Codeit name to the Codex title. Codex may change again after the check." : "Record these matching names as the baseline."}</p><div className="dialog-actions"><button type="button" autoFocus disabled={saving} onClick={() => { setChoice(undefined); trigger.current?.focus(); }}>Cancel</button><button type="button" disabled={saving} onClick={() => void synchronize()}>{saving ? "Checking…" : "Confirm"}</button></div></div></div>}
    {feedback && <span role="status">{feedback}</span>}
    {syncError && <span role="alert">{syncError}</span>}
    {!reference?.threadId && feedback && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}
  </div>;
}
