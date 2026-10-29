import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";

import { z } from "zod";

import { message, request } from "./app.js";

import { Button } from "./components/ui/button.js";

import { AttachmentComposer, type Attachment } from "./attachments.js";

import { VoiceInput } from "./voice-input.js";

import { ComposerIcon } from "./composer-icon.js";
import { ProviderSelector, type ProviderSelection } from "./provider-selector.js";
import "./chat-layout.css";
import { timingLabel, updateTiming, type TimingState } from "./chat-timing.js";
import { copyText } from "./copy-text.js";
import { UserMessage } from "./user-message.js";
import { AssistantMessage } from "./assistant-message.js";
import { activityFromItem } from "./chat-activity.js";
import { CodexThreadReference } from "./codex-thread-reference.js";



type Entry = { id: string; kind: "user" | "assistant" | "command" | "activity" | "notice"; text: string; label?: string; status?: string; routine?: boolean; turnKey?: string; attachments?: { name: string; kind: "text" | "image"; content?: string; ocrText?: string }[] };

type Approval = { id: string; method: string; params: unknown };

const savedAttachmentSchema = z.object({ name: z.string(), kind: z.enum(["text", "image"]), content: z.string().optional(), ocrText: z.string().optional() });

const eventSchema = z.object({ turnKey: z.string().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional(), interruptionObservedAt: z.string().optional(), attachments: z.array(savedAttachmentSchema).optional(), type: z.string(), busy: z.boolean().optional(), text: z.string().optional(), threadId: z.string().optional(), itemId: z.string().optional(), delta: z.string().optional(), item: z.record(z.string(), z.unknown()).optional(), id: z.string().optional(), method: z.string().optional(), params: z.unknown().optional(), status: z.string().optional(), error: z.unknown().optional(), message: z.string().optional() });



export function Conversation({ chat, onConnectionChange, active = true }: { chat: { id: string; name: string }; active?: boolean; onConnectionChange: (status: "connecting" | "connected" | "disconnected") => void }) {

  const [entries, setEntries] = useState<Entry[]>([]);
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; text: string }>();
  const copySequence = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [timing, setTiming] = useState<TimingState>({ turns: {} });
  const [clock, setClock] = useState(() => Date.now());

  const [prompt, setPrompt] = useState("");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [providerRefresh, setProviderRefresh] = useState(0);
  const [threadRefresh, setThreadRefresh] = useState(0);
  const [selection, setSelection] = useState<ProviderSelection>({ provider: "codex" });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesVersion, setPreferencesVersion] = useState(0);
  const [preferencesError, setPreferencesError] = useState("");
  const preferencesDirty = useRef(true);
  const selectionVersion = useRef(0);

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
  const [sendError, setSendError] = useState("");
  const sendAbort = useRef<AbortController | null>(null);
  const submission = useRef<{ payload: string; id: string } | null>(null);
  const refinementSubmission = useRef<{ payload: string; id: string } | null>(null);

  const [approval, setApproval] = useState<Approval | null>(null);

  const [deciding, setDeciding] = useState(false);

  const end = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const approvalPanel = useRef<HTMLElement>(null);
  const followHistory = useRef(true);
  const [awayFromEnd, setAwayFromEnd] = useState(false);

  const base = `/api/chats/${encodeURIComponent(chat.id)}`;
  const promptId = `prompt-${chat.id}`;

  useEffect(() => {
    const changed = () => { preferencesDirty.current = true; setPreferencesReady(false); setPreferencesVersion((value) => value + 1); };
    window.addEventListener("codeit:preferences-changed", changed);
    return () => window.removeEventListener("codeit:preferences-changed", changed);
  }, []);

  useEffect(() => {
    if (!active || busy || sending || !preferencesDirty.current) return;
    let cancelled = false;
    let settled = false;
    const version = selectionVersion.current;
    preferencesDirty.current = false;
    loadChatPreferences(chat.id).then((result) => {
      if (cancelled) return;
      if (version === selectionVersion.current) { setSelection(result.effective.selection); setProviderRefresh((value) => value + 1); }
      setPreferencesError("");
      setPreferencesReady(true);
    }).catch((error) => { if (!cancelled) setPreferencesError(`Could not load chat preferences: ${message(error)}`); })
      .finally(() => { if (!cancelled) settled = true; });
    return () => { cancelled = true; if (!settled) preferencesDirty.current = true; };
  }, [active, busy, sending, chat.id, preferencesVersion]);



  useEffect(() => {

    if (!active) return;
    setConnected(false);
    onConnectionChange("connecting");

    let source: EventSource;
    let watchdog: ReturnType<typeof setTimeout>;
    let disposed = false;
    let replaying = true;
    let replayEntries: Entry[] = [];
    let replayTiming: TimingState = { turns: {} };
    let replayApproval: Approval | null = null;
    const updateEntries = (update: (items: Entry[]) => Entry[]) => { if (replaying) replayEntries = update(replayEntries); else setEntries(update); };
    function lostConnection() { setConnected(false); onConnectionChange("disconnected"); sendAbort.current?.abort(); }
    function resetWatchdog() {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { if (!disposed) { lostConnection(); connect(); } }, 35_000);
    }
    function connect() {
      source?.close();
      const current = new EventSource(`${base}/events`);
      source = current; resetWatchdog();
      current.onopen = () => { if (disposed || source !== current) return; replaying = true; replayEntries = []; replayTiming = { turns: {} }; replayApproval = null; setConnected(false); resetWatchdog(); };
      current.onerror = () => { if (disposed || source !== current) return; lostConnection(); };
      current.onmessage = (messageEvent) => {

      if (disposed || source !== current) return;
      let event: z.infer<typeof eventSchema>;

      try { const result = eventSchema.safeParse(JSON.parse(messageEvent.data)); if (!result.success) return; event = result.data; } catch { return; }
      resetWatchdog();

      if ((event.type === "user" || event.type === "finished") && event.turnKey) { if (replaying) replayTiming = updateTiming(replayTiming, event); else { setTiming((current) => updateTiming(current, event)); if (event.type === "user") setClock(Date.now()); } }
      if (event.type === "ready") { replaying = false; setTiming(replayTiming); setEntries(replayEntries); setApproval(replayApproval); setConnected(true); setLoaded(true); setBusy(Boolean(event.busy)); }
      if (event.type === "thread") setThreadRefresh((value) => value + 1);

      if (event.type === "connection" && (event.status === "connecting" || event.status === "connected" || event.status === "disconnected")) onConnectionChange(event.status);

      if (event.type === "notice" && event.text) updateEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: event.text!, routine: event.text!.startsWith("Codex effective settings:") || event.text!.startsWith("Codex reported latest usage:") }]);

      if (event.type === "user" && event.id && event.text !== undefined) updateEntries((items) => [...items, { id: event.id!, kind: "user", text: event.text!, attachments: event.attachments }]);

      if (event.type === "delta" && event.itemId && event.delta) updateEntries((items) => appendDelta(items, event.itemId!, event.delta!, "assistant", event.turnKey));

      if (event.type === "commandDelta" && event.itemId && event.delta) updateEntries((items) => appendDelta(items, event.itemId!, event.delta!, "command", event.turnKey));

      if (event.type === "item" && event.item) updateEntries((items) => upsertItem(items, event.item!, event.turnKey));

      if (event.type === "approval" && event.id && event.method) { const next = { id: event.id, method: event.method, params: event.params }; if (replaying) replayApproval = next; else setApproval(next); }

      if (event.type === "approvalResolved" && event.id) { if (replaying) { if (replayApproval?.id === event.id) replayApproval = null; } else setApproval((current) => current?.id === event.id ? null : current); }

      if (event.type === "finished") {

        if (replaying) replayApproval = null; else { setBusy(false); setApproval(null); }

        updateEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: event.error ? `${event.status ?? "Failed"}: ${formatError(event.error)}` : `Turn ${event.status ?? "completed"}`, routine: event.status === "completed" && !event.error }]);

      }

      if (event.type === "error") {

        updateEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: event.message ?? "An error occurred." }]);

      }

      };
    }
    connect();

    return () => { disposed = true; clearTimeout(watchdog); source.close(); };

  }, [base, onConnectionChange, active]);

  useEffect(() => {
    const panel = history.current;
    if (panel && followHistory.current) panel.scrollTop = panel.scrollHeight;
  }, [entries, approval]);



  useEffect(() => {
    if (!active || !busy || !timing.active) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, busy, timing.active]);

  useLayoutEffect(() => {

    const input = promptInput.current;

    if (input) { input.style.height = promptExpanded ? "" : "auto"; if (!promptExpanded) input.style.height = `${Math.min(input.scrollHeight, 144)}px`; }

  }, [prompt, promptExpanded, active]);

  useEffect(() => () => { copySequence.current++; clearTimeout(copyTimer.current); }, []);
  async function copyEntry(entry: Entry) {
    const sequence = ++copySequence.current;
    clearTimeout(copyTimer.current);
    try { await copyText(entry.text, navigator.clipboard); if (sequence === copySequence.current) setCopyFeedback({ id: entry.id, text: "Copied" }); }
    catch { if (sequence === copySequence.current) setCopyFeedback({ id: entry.id, text: "Could not copy. Check clipboard access." }); }
    if (sequence === copySequence.current) copyTimer.current = setTimeout(() => setCopyFeedback(undefined), 4000);
  }
  function updatePrompt(value: string) { promptVersion.current++; setPrompt(value); }

  async function refine() {

    if (!preferencesReady || !prompt.trim() || refining || busy || sending || selection.provider !== "codex" || !selection.model) return;

    const version = promptVersion.current;

    const text = prompt;
    const payload = JSON.stringify({ text, selection });
    if (!refinementSubmission.current || refinementSubmission.current.payload !== payload) refinementSubmission.current = { payload, id: crypto.randomUUID() };

    setRefining(true); setRefineError(""); setRefinedDraft("");

    try {

      const result = await request<{ text: string }>(`${base}/refine`, "POST", { text, selection, requestId: refinementSubmission.current.id });
      refinementSubmission.current = null;

      if (version === promptVersion.current) updatePrompt(result.text);

      else setRefinedDraft(result.text);

    } catch (error) { setRefineError(message(error)); }

    finally { setRefining(false); }

  }

  async function send(event: FormEvent) {

    event.preventDefault();

    if (!preferencesReady || (!prompt.trim() && !attachments.length) || busy || sending || refining || !connected || processing || !selection.model) return;

    const text = prompt;

    const version = promptVersion.current;

    setBusy(true); setSending(true); setSendError("");
    const controller = new AbortController(); sendAbort.current = controller;
    const payload = JSON.stringify({ text, attachments, selection });
    if (!submission.current || submission.current.payload !== payload) submission.current = { payload, id: crypto.randomUUID() };

    try { await sendChatMessage(`${base}/messages`, { text, attachments, selection, requestId: submission.current.id }, controller.signal); submission.current = null; if (version === promptVersion.current) updatePrompt(""); setAttachments([]); setProviderRefresh((value) => value + 1); }

    catch (error) { setBusy(false); setSendError((controller.signal.aborted || error instanceof TypeError) ? "Connection lost. The message may have started; check chat history before retrying." : message(error)); }
    finally { if (sendAbort.current === controller) sendAbort.current = null; setSending(false); }

  }

  async function decide(decision: "accept" | "decline") {

    if (!approval || deciding) return;

    setDeciding(true);

    try { await request(`${base}/approvals/${encodeURIComponent(approval.id)}`, "POST", { decision }); setApproval(null); }

    catch (error) { setEntries((items) => [...items, { id: crypto.randomUUID(), kind: "notice", text: message(error) }]); }

    finally { setDeciding(false); }

  }

  return <section className="workspace" hidden={!active} aria-label={`${chat.name} chat`}>
    <CodexThreadReference chatId={chat.id} chatName={chat.name} active={active} refresh={threadRefresh} />

    <div className="history-container">
    <div ref={history} className="history workspace-scroll w-full min-h-0 flex-1 overflow-y-auto overscroll-contain px-[5%] pt-6 pb-2" aria-live="polite" onScroll={(event) => { const panel = event.currentTarget; followHistory.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 64; setAwayFromEnd(!followHistory.current); }}>

      {loaded && entries.length === 0 && !busy && <div className="empty"><span className="empty-mark">&gt;_</span><h2>What would you like to build?</h2><p>Send a message to start a conversation with Codex.</p></div>}

      {entries.filter((entry) => !entry.routine).map((entry) => entry.kind === "activity" || entry.kind === "command" ? <details className="chat-activity" key={entry.id}><summary><span>{entry.label ?? "Ran command"}</span>{entry.status && entry.status !== "completed" && <span className="chat-activity-status"> · {entry.status}</span>}</summary><pre>{entry.text || "No details reported."}</pre></details> : <article className={`entry ${entry.kind} group ${entry.kind === "assistant" ? "w-[90%] max-w-full" : ""}`} key={entry.id}>
        <div className="flex items-center gap-2"><div className={`entry-label flex min-w-0 flex-1 flex-wrap items-center gap-2 ${entry.kind === "user" ? "justify-end" : ""}`}>{entry.kind === "assistant" && <span className="inline-grid h-5 w-5 place-items-center rounded bg-neutral-800 font-mono text-[10px] text-white" aria-hidden="true">{selection.provider === "gemini" ? "✦" : ">_"}</span>}{entry.kind === "user" ? "You" : entry.kind === "assistant" ? (selection.provider === "gemini" ? "Gemini" : "Codex") : "Status"}{entry.kind === "assistant" && entry.turnKey && timingLabel(timing.turns[entry.turnKey], clock, busy && timing.active === entry.turnKey) && <span className="inline-block border-b border-neutral-200 pb-1 normal-case tracking-normal" aria-live="off">{timingLabel(timing.turns[entry.turnKey], clock, busy && timing.active === entry.turnKey)}</span>}{entry.status && <span> · {entry.status}</span>}</div>{copyFeedback?.id === entry.id && <span className="text-xs text-neutral-600" role="status">{copyFeedback.text}</span>}{entry.kind === "assistant" && <button type="button" className="icon-button opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100" aria-label={`Copy ${selection.provider === "gemini" ? "Gemini" : "Codex"} response`} title="Copy message" onClick={() => void copyEntry(entry)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/></svg></button>}</div>
        {entry.kind === "user" ? <><UserMessage text={entry.text}>{entry.attachments?.map((attachment, index) => <details key={index}><summary>{attachment.kind === "image" ? "Image" : "Text file"}: {attachment.name}</summary>{attachment.content !== undefined && <pre>{attachment.content}</pre>}{attachment.ocrText !== undefined && <pre>OCR text: {attachment.ocrText}</pre>}{attachment.kind === "image" && <small>Image preview is not stored in Codeit history.</small>}</details>)}</UserMessage><div className="user-message-actions"><button type="button" className="icon-button user-copy" aria-label="Copy your message" title="Copy message" onClick={() => void copyEntry(entry)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/></svg></button></div></> : entry.kind === "assistant" ? <AssistantMessage text={entry.text} /> : <div><pre>{entry.text}</pre></div>}
      </article>)}
      {entries.some((entry) => entry.routine) && <details className="text-xs text-neutral-600"><summary className="cursor-pointer py-2 font-medium">Turn status and effective settings</summary>{entries.filter((entry) => entry.routine).map((entry) => <pre className="whitespace-pre-wrap break-words py-1" key={entry.id}>{entry.text}</pre>)}</details>}
      {busy && !approval && <div className="working"><span className="pulse" /> {selection.provider === "gemini" ? "Gemini" : "Codex"} is working</div>}

      {approval && <section ref={approvalPanel} tabIndex={-1} className="approval" aria-label="Approval request"><h2>Codex needs your approval</h2><p>Review the requested action before continuing.</p><pre>{JSON.stringify(approval.params, null, 2)}</pre><div className="actions"><Button type="button" onClick={() => void decide("accept")} disabled={deciding}>Approve</Button><Button variant="outline" type="button" onClick={() => void decide("decline")} disabled={deciding}>Decline</Button></div></section>}

      <div ref={end} />

    </div>
    {awayFromEnd && <button type="button" className={`jump-to-latest ${approval ? "jump-to-approval" : ""}`} aria-label={approval ? "Review pending approval" : "Jump to latest message"} title={approval ? "Review pending approval" : "Jump to latest message"} onClick={() => { const panel = history.current; if (panel) { followHistory.current = true; panel.scrollTo({ top: panel.scrollHeight, behavior: "auto" }); setAwayFromEnd(false); if (approval && approvalPanel.current) { approvalPanel.current.scrollIntoView({ block: "start", behavior: "auto" }); approvalPanel.current.focus({ preventScroll: true }); } } }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v15M6 13l6 6 6-6" /></svg>{approval && <span>Approval requested</span>}</button>}
    </div>

    <form className="composer" onSubmit={(event) => void send(event)}>


      <label className="sr-only" htmlFor={promptId}>Message Codex</label>

      <textarea ref={promptInput} className={`chat-prompt ${promptExpanded ? "chat-prompt-expanded" : ""}`} id={promptId} value={prompt} onChange={(event) => updatePrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Ask Codex to help with your work…" rows={3} />

      <p className="prompt-retention-notice">Prompt attempts are saved in Prompt Manager. Avoid including secrets.</p>
      {refineError && <div className="composer-error" role="alert"><p>{refineError}</p><p>A previous attempt may have reached the provider. Start a new attempt only if you want to retry.</p><button type="button" onClick={() => { refinementSubmission.current = null; setRefineError(""); }}>Start new refinement attempt</button></div>}
      {sendError && <div className="composer-error" role="alert"><p>{sendError}</p><p>Check chat history before starting another attempt. The previous attempt may have reached the provider.</p><button type="button" onClick={() => { submission.current = null; setSendError(""); }}>Start new message attempt</button></div>}

      {refinedDraft && <div className="refinement-result"><p>Your draft changed while Codex refined it. Review the result before replacing your draft.</p><pre>{refinedDraft}</pre><button type="button" onClick={() => { updatePrompt(refinedDraft); setRefinedDraft(""); }}>Use refined prompt</button><button type="button" onClick={() => setRefinedDraft("")}>Dismiss</button></div>}

      {preferencesError && <div className="composer-preferences-error" role="status">{preferencesError} <button type="button" onClick={() => { preferencesDirty.current = true; setPreferencesError(""); setPreferencesVersion((value) => value + 1); }}>Retry</button></div>}
      <div className="composer-controls"><button type="button" className="composer-icon" aria-label={promptExpanded ? "Collapse input" : "Expand input"} title={promptExpanded ? "Collapse input" : "Expand input"} aria-expanded={promptExpanded} aria-controls={promptId} onClick={() => setPromptExpanded((value) => !value)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={promptExpanded ? "m7 10 5 5 5-5" : "m7 14 5-5 5 5"} /></svg></button><AttachmentComposer attachments={attachments} setAttachments={setAttachments} disabled={busy || sending} onProcessingChange={setProcessing} /><button className="composer-icon" type="button" aria-label="Refine prompt" title={selection.provider === "gemini" ? "Prompt refinement is not available for Gemini" : "Refine prompt with Codex"} disabled={!preferencesReady || !connected || busy || sending || refining || !prompt.trim() || selection.provider !== "codex" || !selection.model} onClick={() => void refine()}><ComposerIcon name="wand" /></button>{refining && <span className="composer-progress" role="status">Refining…</span>}<span className="composer-spacer" aria-hidden="true" /><div className="composer-right">{preferencesReady ? <ProviderSelector refreshKey={providerRefresh} base={base} value={selection} onChange={(value) => { selectionVersion.current++; setSelection(value); }} disabled={busy || sending || refining} /> : !preferencesError && <span role="status">Loading chat preferences…</span>}<VoiceInput disabled={busy || sending} onTranscript={(text) => { promptVersion.current++; setPrompt((current) => current + (current && !/\s$/.test(current) ? " " : "") + text); }} /><button className="composer-icon composer-send" type="submit" aria-label="Send message" title="Send message (Enter)" disabled={!preferencesReady || !connected || busy || sending || refining || processing || !selection.model || (!prompt.trim() && !attachments.length)}><ComposerIcon name="send" /></button></div></div>

    </form>

  </section>;

}

function appendDelta(items: Entry[], id: string, delta: string, kind: "assistant" | "command", turnKey?: string): Entry[] {

  const index = items.findIndex((item) => item.id === id);

  if (index < 0) return [...items, { id, kind, text: delta, turnKey, status: kind === "command" ? "running" : undefined }];

  return items.map((item, position) => position === index ? { ...item, text: item.text + delta, turnKey: turnKey ?? item.turnKey } : item);

}

function upsertItem(items: Entry[], item: Record<string, unknown>, turnKey?: string): Entry[] {

  const id = String(item.id ?? crypto.randomUUID());

  const type = String(item.type ?? "");

  let entry: Entry | null = null;

  if (type === "agentMessage") entry = { id, kind: "assistant", text: String(item.text ?? ""), turnKey };

  const activity = activityFromItem(item);
  if (activity) entry = { id, kind: "activity", turnKey, label: activity.label, text: activity.detail, status: typeof item.status === "string" ? item.status : undefined };

  if (!entry) return items;

  const index = items.findIndex((existing) => existing.id === id);

  if (index < 0) return [...items, entry];

  return items.map((existing, position) => position === index ? { ...entry!, text: type === "commandExecution" && typeof item.aggregatedOutput !== "string" && existing.text ? existing.text : entry!.text || existing.text } : existing);

}

function formatError(error: unknown): string {

  if (error instanceof Error) return error.message;

  if (typeof error === "string") return error;

  if (error && typeof error === "object" && "message" in error) return String(error.message);

  return JSON.stringify(error) ?? "Unknown error";

}




async function sendChatMessage(path: string, body: unknown, signal: AbortSignal): Promise<void> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-codeit-request": "1" }, body: JSON.stringify(body), signal });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(result.error ?? result.message ?? `Request failed (${response.status})`);
  }
}

async function loadChatPreferences(chatId: string): Promise<{ effective: { selection: ProviderSelection } }> {
  const response = await fetch(`/api/preferences?chatId=${encodeURIComponent(chatId)}`);
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
    if (response.status === 404 && /^Route GET:\/api\/preferences(?:\?[^ ]*)? not found$/.test(result.message ?? "")) {
      throw new Error("The running API does not support preferences. Restart the API after active work finishes, then retry.");
    }
    throw new Error(result.error ?? result.message ?? `Request failed (${response.status})`);
  }
  return response.json();
}
