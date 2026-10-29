import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { message, request } from "./app.js";
import { Button } from "./components/ui/button.js";
import "./supervisor.css";
import { latestCompletedResponse, type SupervisorEvent } from "./supervisor-response.js";

type State = { events: SupervisorEvent[]; busy: boolean; status: "idle" | "running" | "failed" | "interrupted"; approval?: { id: string; method: string; params: unknown } };
export function Supervisor({ project, openPlan, handoff, active = true }: { active?: boolean; project: { id: string; name: string; settings?: unknown }; openPlan: () => void; handoff: (text: string) => void }) {
  const base = `/api/projects/${encodeURIComponent(project.id)}/supervisor`;
  const [state, setState] = useState<State>();
  const [draft, setDraft] = useState("");
  const submission = useRef<{ text: string; id: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0); const generation = useRef(0); const pendingRef = useRef(false); const loadError = useRef(false); const readPending = useRef(false);
  const refresh = useCallback(async () => {
    if (pendingRef.current || readPending.current) return;
    readPending.current = true;
    const expected = generation.current;
    try { const result = await request<State>(base); if (expected === generation.current && !pendingRef.current) { setState(result); if (loadError.current) { setError(""); loadError.current = false; } } }
    catch (cause) { if (expected === generation.current && !pendingRef.current) { loadError.current = true; setError(message(cause)); } }
    finally { readPending.current = false; }
  }, [base]);
  useEffect(() => { if (!active) return; void refresh(); const timer = window.setInterval(() => void refresh(), 2000); return () => { generation.current++; clearInterval(timer); }; }, [refresh, active]);
  async function act(path: string, body: unknown) {
    if (pendingRef.current) return false;
    pendingRef.current = true; generation.current++; setPending(true); setError(""); loadError.current = false;
    try { setState(await request<State>(base + path, "POST", body)); return true; }
    catch (cause) { setError(message(cause)); return false; }
    finally { generation.current++; pendingRef.current = false; setPending(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault(); if (!draft.trim() || state?.busy || pending || !project.settings) return;
    const current = version.current; const text = draft;
    if (!submission.current || submission.current.text !== text) submission.current = { text, id: crypto.randomUUID() };
    if (await act("/messages", { text, requestId: submission.current.id })) { submission.current = null; if (version.current === current) { version.current++; setDraft(""); } }
  }
  const latest = pending ? undefined : latestCompletedResponse(state);
  return <section className="supervisor" hidden={!active} aria-label={`${project.name} ideas supervisor`}><header><h1>{project.name} ideas</h1><p>Discuss an idea with the supervisor. Proposals do not approve plans or start tasks.</p><div className="supervisor-actions"><Button type="button" variant="outline" onClick={openPlan}>Open project plan</Button>{latest && <Button type="button" variant="outline" onClick={() => handoff(latest.text)}>Use latest response in idea draft</Button>}</div></header>
    {!project.settings && <p className="supervisor-notice">Set this project’s folder and permissions before starting a supervisor conversation. The folder does not restrict reads to that location.</p>}
    {error && <div role="alert" className="supervisor-error"><p>{error}</p>{submission.current && <><p>Check supervisor history before starting another attempt. The previous attempt may have reached the provider.</p><button type="button" onClick={() => { submission.current = null; setError(""); }}>Start new supervisor attempt</button></>}</div>}
    <div className="supervisor-history" aria-live="polite">{!state && !error ? <p role="status">Loading supervisor…</p> : state?.events.length === 0 ? <p>Start with an idea or question. Review any proposal before copying it into the project plan.</p> : state?.events.map((entry) => <article key={entry.id}><strong>{entry.type === "user" ? "You" : entry.type === "assistant" ? "Supervisor" : entry.type.replaceAll("_", " ")}</strong><pre>{entry.text}</pre></article>)}{state?.busy && <p role="status">Supervisor is working…</p>}{state && !state.busy && state.status !== "idle" && <p role="status">Supervisor {state.status}.</p>}</div>
    {state?.approval && <section className="supervisor-approval" aria-label="Supervisor approval request"><h2>Approval required</h2><p>Review the request before deciding.</p><pre>{JSON.stringify(state.approval.params, null, 2)}</pre><div><Button type="button" disabled={pending} onClick={() => void act(`/approvals/${encodeURIComponent(state.approval!.id)}`, { decision: "accept" })}>Approve</Button><Button type="button" variant="outline" disabled={pending} onClick={() => void act(`/approvals/${encodeURIComponent(state.approval!.id)}`, { decision: "decline" })}>Decline</Button></div></section>}
    <form className="supervisor-composer" onSubmit={(event) => void send(event)}><label htmlFor={`supervisor-draft-${project.id}`}>Message supervisor</label><p>Prompt attempts are saved in Prompt Manager. Avoid including secrets.</p><textarea id={`supervisor-draft-${project.id}`} value={draft} onChange={(event) => { version.current++; setDraft(event.target.value); }} rows={3} placeholder="Describe your idea…" /><Button type="submit" disabled={!state || state.busy || pending || !project.settings || !draft.trim()}>Send</Button></form>
  </section>;
}
