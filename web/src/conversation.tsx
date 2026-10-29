import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

import { z } from "zod";

import { message, request } from "./app.js";

import { Button } from "./components/ui/button.js";

import { AttachmentComposer, type Attachment } from "./attachments.js";

import { VoiceInput } from "./voice-input.js";

import { ComposerIcon } from "./composer-icon.js";
import { ProviderSelector, type ProviderSelection } from "./provider-selector.js";
import "./chat-layout.css";



type Entry = { id: string; kind: "user" | "assistant" | "command" | "notice"; text: string; status?: string; attachments?: { name: string; kind: "text" | "image"; content?: string; ocrText?: string }[] };

type Approval = { id: string; method: string; params: unknown };

const savedAttachmentSchema = z.object({ name: z.string(), kind: z.enum(["text", "image"]), content: z.string().optional(), ocrText: z.string().optional() });

const eventSchema = z.object({ attachments: z.array(savedAttachmentSchema).optional(), type: z.string(), busy: z.boolean().optional(), text: z.string().optional(), threadId: z.string().optional(), itemId: z.string().optional(), delta: z.string().optional(), item: z.record(z.string(), z.unknown()).optional(), id: z.string().optional(), method: z.string().optional(), params: z.unknown().optional(), status: z.string().optional(), error: z.unknown().optional(), message: z.string().optional() });



export function Conversation({ chat, onConnectionChange }: { chat: { id: string; name: string }; onConnectionChange: (status: "connecting" | "connected" | "disconnected") => void }) {

  const [entries, setEntries] = useState<Entry[]>([]);

  const [prompt, setPrompt] = useState("");
  const [providerRefresh, setProviderRefresh] = useState(0);
  const [selection, setSelection] = useState<ProviderSelection>({ provider: "codex" });

  const [refining, setRefining] = useState(false);

  const [refineError, setRefineError] = useState("");

  const [refinedDraft, setRefinedDraft] = useState("");

  const promptVersion = useRef(0);

  const promptInput = useRef<HTMLTextAreaElement>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [processing, setProcessing] = useState(false);

  const [connected, setConnected] = useState(false);

  const [loaded, setLoaded] = useState(false);

  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  const [approval, setApproval] = useState<Approval | null>(null);

  const [deciding, setDeciding] = useState(false);

  const end = useRef<HTMLDivElement>(null);

  const base = `/api/chats/${encodeURIComponent(chat.id)}`;



  useEffect(() => {

    onConnectionChange("connecting");

    const source = new EventSource(`${base}/events`);

    source.onopen = () => { setEntries([]); setApproval(null); setConnected(false); setLoaded(false); };

    source.onerror = () => { setConnected(false); onConnectionChange("disconnected"); };

    source.onmessage = (messageEvent) => {

      let event: z.infer<typeof eventSchema>;

      try { const result = eventSchema.safeParse(JSON.parse(messageEvent.data)); if (!result.success) return; event = result.data; } catch { return; }

      if (event.type === "ready") { setConnected(true); setLoaded(true); setBusy(Boolean(event.busy)); }

      if (event.type === "connection" && (event.status === "connecting" || event.status === "connected" || event.status === "disconnected")) onConnectionChange(event.status);

      if (event.type === "notice" && event.text) setEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: event.text! }]);

      if (event.type === "user" && event.id && event.text !== undefined) setEntries((items) => [...items, { id: event.id!, kind: "user", text: event.text!, attachments: event.attachments }]);

      if (event.type === "delta" && event.itemId && event.delta) setEntries((items) => appendDelta(items, event.itemId!, event.delta!, "assistant"));

      if (event.type === "commandDelta" && event.itemId && event.delta) setEntries((items) => appendDelta(items, event.itemId!, event.delta!, "command"));

      if (event.type === "item" && event.item) setEntries((items) => upsertItem(items, event.item!));

      if (event.type === "approval" && event.id && event.method) setApproval({ id: event.id, method: event.method, params: event.params });

      if (event.type === "approvalResolved" && event.id) setApproval((current) => current?.id === event.id ? null : current);

      if (event.type === "finished") {

        setBusy(false); setApproval(null);

        setEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: event.error ? `${event.status ?? "Failed"}: ${formatError(event.error)}` : `Turn ${event.status ?? "completed"}` }]);

      }

      if (event.type === "error") {

        setEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: event.message ?? "An error occurred." }]);

      }

    };

    return () => source.close();

  }, [base, onConnectionChange]);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [entries, approval]);



  useLayoutEffect(() => {

    const input = promptInput.current;

    if (input) { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 144)}px`; }

  }, [prompt]);

  function updatePrompt(value: string) { promptVersion.current++; setPrompt(value); }

  async function refine() {

    if (!prompt.trim() || refining || busy || sending || selection.provider !== "codex" || !selection.model) return;

    const version = promptVersion.current;

    const text = prompt;

    setRefining(true); setRefineError(""); setRefinedDraft("");

    try {

      const result = await request<{ text: string }>(`${base}/refine`, "POST", { text, selection });

      if (version === promptVersion.current) updatePrompt(result.text);

      else setRefinedDraft(result.text);

    } catch (error) { setRefineError(message(error)); }

    finally { setRefining(false); }

  }

  async function send(event: FormEvent) {

    event.preventDefault();

    if ((!prompt.trim() && !attachments.length) || busy || sending || refining || !connected || processing || !selection.model) return;

    const text = prompt;

    const version = promptVersion.current;

    setBusy(true); setSending(true);

    try { await request(`${base}/messages`, "POST", { text, attachments, selection }); if (version === promptVersion.current) updatePrompt(""); setAttachments([]); setProviderRefresh((value) => value + 1); }

    catch (error) { setBusy(false); setEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: message(error) }]); }
    finally { setSending(false); }

  }

  async function decide(decision: "accept" | "decline") {

    if (!approval || deciding) return;

    setDeciding(true);

    try { await request(`${base}/approvals/${encodeURIComponent(approval.id)}`, "POST", { decision }); setApproval(null); }

    catch (error) { setEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: message(error) }]); }

    finally { setDeciding(false); }

  }

  return <section className="workspace" aria-label={`${chat.name} chat`}>

    <div className="history" aria-live="polite">

      {loaded && entries.length === 0 && !busy && <div className="empty"><span className="empty-mark">&gt;_</span><h2>What would you like to build?</h2><p>Send a message to start a conversation with Codex.</p></div>}

      {entries.map((entry) => <article className={`entry ${entry.kind}`} key={entry.id}><div className="entry-label">{entry.kind === "user" ? "You" : entry.kind === "assistant" ? (selection.provider === "gemini" ? "Gemini" : "Codex") : entry.kind === "command" ? "Command" : "Status"}{entry.status && <span> · {entry.status}</span>}</div><pre>{entry.text}</pre>{entry.attachments?.map((attachment, index) => <details key={index}><summary>{attachment.kind === "image" ? "Image" : "Text file"}: {attachment.name}</summary>{attachment.content !== undefined && <pre>{attachment.content}</pre>}{attachment.ocrText !== undefined && <pre>OCR text:

{attachment.ocrText}</pre>}{attachment.kind === "image" && <small>Image preview is not stored in Codeit history.</small>}</details>)}</article>)}

      {busy && !approval && <div className="working"><span className="pulse" /> {selection.provider === "gemini" ? "Gemini" : "Codex"} is working</div>}

      {approval && <section className="approval" aria-label="Approval request"><h2>Codex needs your approval</h2><p>Review the requested action before continuing.</p><pre>{JSON.stringify(approval.params, null, 2)}</pre><div className="actions"><Button type="button" onClick={() => void decide("accept")} disabled={deciding}>Approve</Button><Button variant="outline" type="button" onClick={() => void decide("decline")} disabled={deciding}>Decline</Button></div></section>}

      <div ref={end} />

    </div>

    <form className="composer" onSubmit={(event) => void send(event)}>


      <label className="sr-only" htmlFor="prompt">Message Codex</label>

      <textarea ref={promptInput} id="prompt" value={prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Ask Codex to help with your work…" rows={3} />

      {refineError && <p className="composer-error" role="alert">{refineError}</p>}

      {refinedDraft && <div className="refinement-result"><p>Your draft changed while Codex refined it. Review the result before replacing your draft.</p><pre>{refinedDraft}</pre><button type="button" onClick={() => { updatePrompt(refinedDraft); setRefinedDraft(""); }}>Use refined prompt</button><button type="button" onClick={() => setRefinedDraft("")}>Dismiss</button></div>}

      <div className="composer-controls"><AttachmentComposer attachments={attachments} setAttachments={setAttachments} disabled={busy || sending} onProcessingChange={setProcessing} /><button className="composer-icon" type="button" aria-label="Refine prompt" title={selection.provider === "gemini" ? "Prompt refinement is not available for Gemini" : "Refine prompt with Codex"} disabled={!connected || busy || sending || refining || !prompt.trim() || selection.provider !== "codex" || !selection.model} onClick={() => void refine()}><ComposerIcon name="wand" /></button>{refining && <span className="composer-progress" role="status">Refining…</span>}<ProviderSelector refreshKey={providerRefresh} base={base} value={selection} onChange={setSelection} disabled={busy || sending || refining} /><VoiceInput disabled={busy || sending} onTranscript={(text) => { promptVersion.current++; setPrompt((current) => current + (current && !/\s$/.test(current) ? " " : "") + text); }} /><button className="composer-icon composer-send" type="submit" aria-label="Send message" title="Send message (Enter)" disabled={!connected || busy || sending || refining || processing || !selection.model || (!prompt.trim() && !attachments.length)}><ComposerIcon name="send" /></button></div>

    </form>

  </section>;

}

function appendDelta(items: Entry[], id: string, delta: string, kind: "assistant" | "command"): Entry[] {

  const index = items.findIndex((item) => item.id === id);

  if (index < 0) return [...items, { id, kind, text: delta, status: kind === "command" ? "running" : undefined }];

  return items.map((item, position) => position === index ? { ...item, text: item.text + delta } : item);

}

function upsertItem(items: Entry[], item: Record<string, unknown>): Entry[] {

  const id = String(item.id ?? crypto.randomUUID());

  const type = String(item.type ?? "");

  let entry: Entry | null = null;

  if (type === "agentMessage") entry = { id, kind: "assistant", text: String(item.text ?? "") };

  if (type === "commandExecution") entry = { id, kind: "command", text: [item.command, item.aggregatedOutput].filter(Boolean).join("\n"), status: String(item.status ?? "running") };

  if (!entry) return items;

  const index = items.findIndex((existing) => existing.id === id);

  if (index < 0) return [...items, entry];

  return items.map((existing, position) => position === index ? entry! : existing);

}

function formatError(error: unknown): string {

  if (error instanceof Error) return error.message;

  if (typeof error === "string") return error;

  if (error && typeof error === "object" && "message" in error) return String(error.message);

  return JSON.stringify(error) ?? "Unknown error";

}



