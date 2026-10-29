import { useEffect, useRef, useState, type FormEvent } from "react";
import { message, request } from "./app.js";
import "./prompt-workspace.css";

type Summary = { reference: number; source: string; chatId: string | null; createdAt: string };
type Detail = Summary & { attachments: { name: string; kind: "text" | "image"; content?: string; ocrText?: string; sha256?: string }[]; revisions: { revision: number; text: string; createdAt: string }[] };

export function PromptWorkspace({ projects, projectId, onProject }: { projects: { id: string; name: string }[]; projectId: string; onProject: (id: string) => void }) {
  const [records, setRecords] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<Detail>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const base = `/api/projects/${encodeURIComponent(projectId)}/prompts`;

  useEffect(() => {
    let cancelled = false;
    generation.current++;
    setRecords([]); setSelected(undefined); setDraft(""); setError("");
    if (projectId) request<{ prompts: Summary[] }>(base).then((result) => { if (!cancelled) setRecords(result.prompts); }).catch((cause) => { if (!cancelled) setError(message(cause)); });
    return () => { cancelled = true; };
  }, [base, projectId]);

  async function open(reference: number) {
    const current = ++generation.current;
    try { const result = await request<Detail>(`${base}/${reference}`); if (current !== generation.current) return; setSelected(result); setDraft(result.revisions.at(-1)?.text ?? ""); setError(""); }
    catch (cause) { if (current === generation.current) setError(message(cause)); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    try { await request(`${base}/${selected.reference}`, "PUT", { revision: selected.revisions.at(-1)!.revision, text: draft }); await open(selected.reference); }
    catch (cause) { setError(message(cause)); }
    finally { setSaving(false); }
  }
  return <section className="prompt-workspace workspace-scroll" aria-label="Prompt Manager">
    <h1>Prompt Manager</h1><p>Prompt text is sensitive and remains in local history, including earlier revisions.</p>
    <label>Project <select value={projectId} onChange={(event) => onProject(event.target.value)}><option value="">Select a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    {projectId && records.length === 0 && !error && <p>No prompt records.</p>}
    <ul className="prompt-records">{records.map((record) => <li key={record.reference}><button type="button" onClick={() => void open(record.reference)}>#{record.reference} · {record.source} · {new Date(record.createdAt).toLocaleString()}</button></li>)}</ul>
    {selected && <form className="prompt-detail" onSubmit={(event) => void save(event)}><h2>Prompt #{selected.reference}</h2><p>{selected.source}{selected.chatId ? ` · Chat ${selected.chatId}` : ""}</p><label htmlFor="prompt-record">Current text</label><textarea id="prompt-record" value={draft} onChange={(event) => setDraft(event.target.value)} rows={8} /><button type="submit" disabled={saving || draft === selected.revisions.at(-1)?.text}>Save revision</button>{(selected.attachments?.length ?? 0) > 0 && <><h3>Submitted attachments</h3>{(selected.attachments ?? []).map((item, index) => <details key={index}><summary>{item.kind}: {item.name}</summary>{item.content !== undefined && <pre>{item.content}</pre>}{item.ocrText !== undefined && <pre>{item.ocrText}</pre>}{item.sha256 && <p>Image data URL SHA-256: {item.sha256}. Image bytes are not retained here.</p>}</details>)}</>}<h3>Revision history</h3>{selected.revisions.map((revision) => <details key={revision.revision}><summary>Revision {revision.revision} · {new Date(revision.createdAt).toLocaleString()}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{revision.text}</pre></details>)}</form>}
  </section>;
}
