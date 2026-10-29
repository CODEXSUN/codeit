import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { message, request } from "./app.js";
import { Button } from "./components/ui/button.js";
import type { ProjectSettings } from "./project-dialog.js";
import { ManualReviewForm, ManualReviewEvidence, type ManualReviewRecord } from "./manual-review.js";
import { PlanRefinement } from "./plan-refinement.js";
import "./project-loop.css";

type Run = { id: string; kind: "worker" | "review" | "manual_review"; status: string; events: { type: string; text: string }[]; error?: string; manualReview?: ManualReviewRecord };
type Task = { id: string; title: string; description: string; dependencies: string[]; status: string; runs: Run[]; findings?: string };
type Loop = { idea: { original: string; refined: string; ideaId?: string } | null; plan: { summary: string; criteria: string[]; approved: boolean; approvedSettings?: ProjectSettings } | null; tasks: Task[]; active?: { taskId: string; runId: string; approval?: { id: string; method: string; params: unknown } } };
type DraftTask = { title: string; description: string; dependencies: string[] };
const blankTask = (): DraftTask => ({ title: "", description: "", dependencies: [] });

export function ProjectLoop({ project, proposal, clearProposal, active = true }: { active?: boolean; project: { id: string; name: string; settings?: ProjectSettings }; proposal?: string; clearProposal?: () => void }) {
  const base = `/api/projects/${encodeURIComponent(project.id)}/loop`;
  const [state, setState] = useState<Loop>();
  const [original, setOriginal] = useState("");
  const [refined, setRefined] = useState("");
  const [summary, setSummary] = useState("");
  const [criteria, setCriteria] = useState("");
  const [tasks, setTasks] = useState<DraftTask[]>([blankTask()]);
  const [findings, setFindings] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [replacePlan, setReplacePlan] = useState(false);
  const [overwriteDraftPlan, setOverwriteDraftPlan] = useState(false);
  const [replaceRefined, setReplaceRefined] = useState(false);
  const [handoffConflict, setHandoffConflict] = useState(false);
  const seenIdea = useRef<string | undefined>(undefined);
  const revision = useRef(0);
  const pendingRef = useRef(false);
  const loadError = useRef(false);
  const readPending = useRef(false);

  const load = useCallback(async () => {
    if (pendingRef.current || readPending.current) return;
    readPending.current = true;
    const current = revision.current;
    try { const next = await request<Loop>(base); if (current === revision.current && !pendingRef.current) { setState(next); if (loadError.current) { setError(""); loadError.current = false; } } }
    catch (cause) { if (current === revision.current && !pendingRef.current) { loadError.current = true; setError(message(cause)); } }
    finally { readPending.current = false; }
  }, [base]);
  useEffect(() => { if (!active) return; void load(); const timer = window.setInterval(() => void load(), 3000); return () => { revision.current++; clearInterval(timer); }; }, [load, active]);
  useEffect(() => {
    if (!state || initialized) return;
    setOriginal(state.idea?.original ?? ""); setRefined(state.idea?.refined ?? "");
    setSummary(state.plan?.summary ?? ""); setCriteria(state.plan?.criteria.join("\n") ?? "");
    if (state.tasks.length) setTasks(state.tasks.map((task) => ({ title: task.title, description: task.description, dependencies: task.dependencies.map((id) => String(state.tasks.findIndex((entry) => entry.id === id))).filter((id) => id !== "-1") })));
    setInitialized(true);
  }, [state, initialized]);
  useEffect(() => {
    if (!initialized || !state?.idea?.ideaId || seenIdea.current === state.idea.ideaId) return;
    seenIdea.current = state.idea.ideaId;
    if (!original && !refined) { setOriginal(state.idea.original); setRefined(state.idea.refined); }
    else if (original !== state.idea.original || refined !== state.idea.refined) setHandoffConflict(true);
  }, [state, initialized, original, refined]);

  async function act(path: string, body: unknown, method = "POST") {
    if (pendingRef.current) return;
    pendingRef.current = true; revision.current++;
    setPending(path); setError(""); loadError.current = false;
    try { const next = await request<Loop>(`${base}${path}`, method, body); setState(next); }
    catch (cause) { setError(message(cause)); }
    finally { revision.current++; pendingRef.current = false; setPending(""); }
  }
  function saveIdea(event: FormEvent) { event.preventDefault(); if (!handoffConflict) void act("/idea", { original, refined, replaceExistingPlan: replacePlan }, "PUT"); }
  function savePlan(event: FormEvent) { event.preventDefault(); void act("/plan", { summary, criteria: criteria.split("\n").map((item) => item.trim()).filter(Boolean), tasks, replaceExisting: overwriteDraftPlan }, "PUT"); setOverwriteDraftPlan(false); }
  function updateTask(index: number, update: Partial<DraftTask>) { setTasks((current) => current.map((task, i) => i === index ? { ...task, ...update } : task)); }
  const locked = Boolean(state?.plan?.approved || state?.active);
  const controlsBusy = Boolean(pending || state?.active);
  const taskName = (id: string) => state?.tasks.find((task) => task.id === id)?.title ?? id;

  return <section className="project-loop" hidden={!active} aria-label={`${project.name} project work`}>
    <header className="loop-heading"><div><h1>{project.name}</h1><p>Idea, plan, tasks, and review</p></div><span role="status">{state?.active ? "Run in progress" : pending ? "Saving…" : "Ready"}</span></header>
    {error && <div className="loop-error" role="alert">{error}</div>}
    {!state ? <p role="status">Loading project work…</p> : <>
      <section className="loop-section"><h2>1. Idea</h2>{handoffConflict && <div role="alert"><p>A saved idea was handed off while this form had a draft. Your draft remains here; choose which content to use before saving.</p><Button type="button" onClick={() => { setOriginal(state.idea?.original ?? ""); setRefined(state.idea?.refined ?? ""); setHandoffConflict(false); }}>Use handed-off idea</Button> <Button type="button" variant="outline" onClick={() => setHandoffConflict(false)}>Keep my draft</Button></div>}{proposal && <div className="loop-saved"><h3>Supervisor response for review</h3><pre>{proposal}</pre>{refined.trim() && <label className="loop-check"><input type="checkbox" checked={replaceRefined} onChange={(event) => setReplaceRefined(event.target.checked)} />Replace the current refined idea draft with this response.</label>}<div className="loop-actions"><Button type="button" disabled={locked || Boolean(refined.trim() && !replaceRefined)} onClick={() => { setRefined(proposal); setReplaceRefined(false); clearProposal?.(); }}>Use as refined idea</Button><Button type="button" variant="outline" onClick={() => { setReplaceRefined(false); clearProposal?.(); }}>Dismiss</Button></div><p>The original idea stays unchanged. Review and save the refined draft yourself.</p></div>}<p>Keep the original idea and review the refined version before saving.</p>
        <form onSubmit={saveIdea} className="loop-form"><label>Original idea<textarea value={original} onChange={(event) => setOriginal(event.target.value)} disabled={locked} rows={3} required /></label><label>Refined idea <span>Optional</span><textarea value={refined} onChange={(event) => setRefined(event.target.value)} disabled={locked} rows={3} /></label>{state.plan && !state.plan.approved && <label className="loop-check"><input type="checkbox" checked={replacePlan} onChange={(event) => setReplacePlan(event.target.checked)} />I understand that saving the idea removes the saved draft plan and tasks.</label>}<Button type="submit" disabled={locked || handoffConflict || Boolean(pending) || !original.trim() || Boolean(state.plan && !replacePlan)}>Save idea</Button></form>
      </section>
      <section className="loop-section"><h2>2. Plan and acceptance criteria</h2><p>Write the plan and tasks, then approve the saved plan before starting work.</p>
        {!state.plan?.approved && <PlanRefinement projectId={project.id} plan={summary} onUse={setSummary} canAddTask={tasks.length < 20} onAddTask={(description) => setTasks((current) => current.length >= 20 ? current : [...current, { title: "", description, dependencies: [] }])} />}
        {!state.plan?.approved && <form className="loop-form" onSubmit={savePlan}><label>Plan summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} required /></label><label>Acceptance criteria <span>One criterion per line</span><textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} rows={3} required /></label>
          <div className="loop-draft-tasks"><h3>Tasks</h3>{tasks.map((task, index) => <fieldset key={index}><legend>Task {index + 1}</legend><label>Title<input value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} required /></label><label>Description<textarea value={task.description} onChange={(event) => updateTask(index, { description: event.target.value })} rows={2} required /></label>{index > 0 && <div><span>Depends on</span>{tasks.slice(0, index).map((entry, dependency) => <label className="loop-check" key={dependency}><input type="checkbox" checked={task.dependencies.includes(String(dependency))} onChange={(event) => updateTask(index, { dependencies: event.target.checked ? [...task.dependencies, String(dependency)] : task.dependencies.filter((id) => id !== String(dependency)) })} />{entry.title || `Task ${dependency + 1}`}</label>)}</div>}{tasks.length > 1 && index === tasks.length - 1 && <button className="loop-link" type="button" onClick={() => setTasks((current) => current.slice(0, -1))}>Remove task {index + 1}</button>}</fieldset>)}<button className="loop-link" type="button" onClick={() => setTasks((current) => [...current, blankTask()])}>+ Add task</button></div>
          {state.plan && <label className="loop-check"><input type="checkbox" checked={overwriteDraftPlan} onChange={(event) => setOverwriteDraftPlan(event.target.checked)} />Replace the saved draft plan and its tasks with these edits.</label>}<Button type="submit" disabled={Boolean(pending) || !state.idea || !summary.trim() || !criteria.trim() || Boolean(state.plan && !overwriteDraftPlan)}>Save plan and tasks</Button></form>}
        {state.plan && <div className="loop-saved"><h3>Saved plan <span className="loop-status">{state.plan.approved ? "Approved" : "Awaiting approval"}</span></h3><p>{state.plan.summary}</p>{!state.plan.approved && <p>Approval applies to this saved plan and tasks, not unsaved edits above.</p>}<h3>Acceptance criteria</h3><ul>{state.plan.criteria.map((item, index) => <li key={index}>{item}</li>)}</ul><div className="loop-settings"><h3>{state.plan.approved ? "Approved folder and permissions" : "Folder and permissions to approve"}</h3>{(state.plan.approved ? state.plan.approvedSettings : project.settings) ? <><p>Folder: {(state.plan.approved ? state.plan.approvedSettings : project.settings)?.folder}</p><p>File access: {(state.plan.approved ? state.plan.approvedSettings : project.settings)?.sandbox}</p><p>Approvals: {(state.plan.approved ? state.plan.approvedSettings : project.settings)?.approvalPolicy}</p><p>Approval pins these settings. Restore them if project settings change before a run.</p></> : <p>Set the project folder and permissions in project settings before approval.</p>}</div>{!state.plan.approved && <Button type="button" disabled={controlsBusy || !project.settings} onClick={() => void act("/approve", {})}>Approve saved plan</Button>}</div>}
      </section>
      <section className="loop-section"><h2>3. Work and review</h2><p>Start one task at a time. The selected folder is the working directory. Read-only limits writes but does not confine reads to that folder. Effective settings do not prove operating-system isolation. Review uses a separate read-only Codex thread; inspect the evidence before accepting.</p>
        {state.tasks.length === 0 && <p>No saved tasks yet.</p>}
        {state.tasks.map((task) => <article className="loop-task" key={task.id}><div className="loop-task-heading"><h3>{task.title}</h3><span className="loop-status">{task.status.replaceAll("_", " ")}</span></div><p>{task.description}</p>{task.dependencies.length > 0 && <p>Depends on: {task.dependencies.map(taskName).join(", ")}</p>}
          <div className="loop-actions">{["pending", "failed", "changes_requested"].includes(task.status) && <Button type="button" disabled={!state.plan?.approved || controlsBusy || task.dependencies.some((id) => state.tasks.find((entry) => entry.id === id)?.status !== "accepted")} title={task.dependencies.some((id) => state.tasks.find((entry) => entry.id === id)?.status !== "accepted") ? "Accept all dependencies before starting this task" : undefined} onClick={() => void act(`/tasks/${encodeURIComponent(task.id)}/start`, {})}>{task.status === "pending" ? "Start worker" : "Run worker again"}</Button>}{task.status === "needs_review" && <Button type="button" disabled={controlsBusy} onClick={() => void act(`/tasks/${encodeURIComponent(task.id)}/review`, {})}>Request review</Button>}</div>
          {task.runs.map((run) => <details key={run.id} open={run.status === "running"}><summary>{run.kind === "worker" ? "Worker" : run.kind === "manual_review" ? "Manual review" : "Review"} · {run.status}</summary>{run.error && <p className="loop-error">{run.error}</p>}{run.manualReview ? <ManualReviewEvidence review={run.manualReview} /> : run.events.length ? groupEvents(run.events).map((event, index) => <pre key={index}>{event.type}: {event.text}</pre>) : <p>No output yet.</p>}</details>)}
          {task.status === "needs_review" && !state.active && [...task.runs].reverse().find((run) => run.kind === "worker")?.status === "completed" && <ManualReviewForm key={task.id} workerRunId={[...task.runs].reverse().find((run) => run.kind === "worker")!.id} disabled={controlsBusy} onSubmit={(value) => void act(`/tasks/${encodeURIComponent(task.id)}/manual-review`, value)} />}
          {task.findings && <div><h4>Findings for the next worker run</h4><pre>{task.findings}</pre></div>}
          {task.status === "reviewing" && !state.active && (task.runs.at(-1)?.kind === "review" || task.runs.at(-1)?.kind === "manual_review") && task.runs.at(-1)?.status === "completed" && <div className="loop-review"><label>Findings for another iteration<textarea value={findings[task.id] ?? ""} onChange={(event) => setFindings((current) => ({ ...current, [task.id]: event.target.value }))} rows={3} /></label><div className="loop-actions"><Button type="button" disabled={controlsBusy} onClick={() => void act(`/tasks/${encodeURIComponent(task.id)}/resolve`, { decision: "accept", findings: findings[task.id] ?? "" })}>Accept task</Button><Button type="button" variant="outline" disabled={controlsBusy || !findings[task.id]?.trim()} onClick={() => void act(`/tasks/${encodeURIComponent(task.id)}/resolve`, { decision: "changes_requested", findings: findings[task.id] })}>Request changes</Button></div></div>}
        </article>)}
      </section>
      {state.active?.approval && <section className="loop-approval" aria-label="Worker approval request"><h2>Approval required</h2><p>Review this Codex request before deciding. Work is paused until you choose.</p><pre>{JSON.stringify(state.active.approval.params, null, 2)}</pre><div className="loop-actions"><Button type="button" disabled={Boolean(pending)} onClick={() => void act(`/approvals/${encodeURIComponent(state.active!.approval!.id)}`, { decision: "accept" })}>Approve request</Button><Button type="button" variant="outline" disabled={Boolean(pending)} onClick={() => void act(`/approvals/${encodeURIComponent(state.active!.approval!.id)}`, { decision: "decline" })}>Decline request</Button></div></section>}
    </>}
  </section>;
}

function groupEvents(events: Run["events"]): Run["events"] {
  const grouped: Run["events"] = [];
  for (const event of events) {
    const previous = grouped.at(-1);
    if (previous?.type === event.type && (event.type === "response" || event.type === "command_output")) previous.text += event.text;
    else grouped.push({ ...event });
  }
  return grouped;
}
