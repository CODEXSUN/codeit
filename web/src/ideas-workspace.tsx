import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { message, request } from "./app.js";
import { Button } from "./components/ui/button.js";
import "./ideas-workspace.css";
import { IdeaHandoff } from "./idea-handoff.js";

type Stage = "draft" | "exploring" | "ready" | "archived";
type Idea = { id: string; title: string; content: string; stage: Stage; revision: number };
const stages: Stage[] = ["draft", "exploring", "ready", "archived"];

export function IdeasWorkspace({ projectId, active }: { projectId: string; active: boolean }) {
  const draftKey = `codeit-idea-draft:${projectId}`;
  const [draft] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
      return saved && typeof saved.title === "string" && typeof saved.content === "string" ? saved as { title: string; content: string; selected?: Idea } : undefined;
    } catch { return undefined; }
  });
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [selected, setSelected] = useState<Idea | undefined>(draft?.selected);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [content, setContent] = useState(draft?.content ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(Boolean(draft));
  const [handoff, setHandoff] = useState<"document" | "rule">();
  const base = `/api/projects/${encodeURIComponent(projectId)}/ideas`;
  useEffect(() => {
    try { if (editing) sessionStorage.setItem(draftKey, JSON.stringify({ title, content, selected })); else sessionStorage.removeItem(draftKey); } catch { /* Browser storage may be unavailable. */ }
  }, [draftKey, editing, title, content, selected]);
  useEffect(() => {
    if (!editing) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    request<{ ideas: Idea[] }>(base).then((data) => { if (live) setIdeas(data.ideas); }).catch((cause) => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [active, base]);
  function open(idea?: Idea, discard = false) {
    if (busy || handoff) return;
    const dirty = editing && (title !== (selected?.title ?? "") || content !== (selected?.content ?? ""));
    if (dirty && !discard && !window.confirm("Discard the unsaved idea draft?")) return;
    setSelected(idea); setTitle(idea?.title ?? ""); setContent(idea?.content ?? ""); setEditing(!idea); setError("");
  }
  async function save() {
    setBusy(true); setError("");
    try {
      const saved = await request<Idea>(selected ? `${base}/${encodeURIComponent(selected.id)}` : base, selected ? "PUT" : "POST", selected ? { title, content, revision: selected.revision } : { title, content });
      setIdeas((current) => [...current.filter((item) => item.id !== saved.id), saved]); setSelected(saved); setEditing(false);
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function changeStage(stage: Stage) {
    if (!selected) return;
    setBusy(true); setError("");
    try { const saved = await request<Idea>(`${base}/${encodeURIComponent(selected.id)}/stage`, "POST", { revision: selected.revision, stage }); setIdeas((current) => current.map((item) => item.id === saved.id ? saved : item)); setSelected(saved); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  async function startPlan() {
    if (!selected) return;
    setBusy(true); setError("");
    try { await request(`/api/projects/${encodeURIComponent(projectId)}/loop/idea/from-saved`, "POST", { ideaId: selected.id }); window.alert("Idea copied to project work. Open Projects to write and approve a plan."); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <section className="ideas-workspace" aria-label="Project ideas"><header><h1>Ideas</h1><Button type="button" onClick={() => open()}>New idea</Button></header>
    {error && <p role="alert">{error}</p>}
    <div className="ideas-layout"><nav aria-label="Ideas">{ideas.length ? ideas.map((idea) => <button type="button" key={idea.id} aria-current={selected?.id === idea.id ? "page" : undefined} onClick={() => open(idea)}>{idea.title} · {idea.stage}</button>) : <p>No ideas saved yet.</p>}</nav>
      <div>{editing ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}><label>Title<input required disabled={busy} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Content <span>Markdown</span><textarea disabled={busy} rows={12} value={content} onChange={(event) => setContent(event.target.value)} /></label><h3>Preview</h3><Preview content={content} /><div><Button type="submit" disabled={busy || !title.trim()}>Save idea</Button> <Button type="button" disabled={busy} variant="outline" onClick={() => { if (!title && !content || window.confirm("Discard the unsaved idea draft?")) { setEditing(false); if (selected) { setTitle(selected.title); setContent(selected.content); } } }}>Cancel</Button></div></form> : selected ? <><h2>{selected.title}</h2><p>Stage: {selected.stage}</p><Preview content={selected.content} /><Button type="button" disabled={busy} onClick={() => setEditing(true)}>Edit idea</Button> <Button type="button" variant="outline" disabled={busy} onClick={() => void startPlan()}>Start project plan</Button><div className="ideas-stages" aria-label="Change idea stage">{stages.filter((stage) => stage !== selected.stage).map((stage) => <Button type="button" variant="outline" disabled={busy} key={stage} onClick={() => void changeStage(stage)}>Move to {stage}</Button>)}</div></> : <p>Select an idea or create one.</p>}</div>
    </div>{selected && !editing && !handoff && <div className="ideas-stages"><Button type="button" variant="outline" onClick={() => setHandoff("document")}>Save as documentation</Button><Button type="button" variant="outline" onClick={() => setHandoff("rule")}>Save as rule</Button></div>}{selected && handoff && <IdeaHandoff projectId={projectId} title={selected.title} content={selected.content} kind={handoff} onClose={() => setHandoff(undefined)} />}
  </section>;
}
function Preview({ content }: { content: string }) { return <article className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: () => null, a: ({ children }: { children?: ReactNode }) => <span>{children}</span> }}>{content}</ReactMarkdown></article>; }
