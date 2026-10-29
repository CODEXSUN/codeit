import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { message, request } from "./app.js";
import { Button } from "./components/ui/button.js";

type Root = { id: string; label: string };
export function IdeaHandoff({ projectId, title, content, kind, onClose }: { projectId: string; title: string; content: string; kind: "document" | "rule"; onClose: () => void }) {
  const [text, setText] = useState(`# ${title}\n\n${content}`);
  const [name, setName] = useState(kind === "rule" ? "rule-" : "");
  const [roots, setRoots] = useState<Root[]>([]);
  const [root, setRoot] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${encodeURIComponent(projectId)}/docs`;
  useEffect(() => {
    let live = true;
    request<{ roots: Root[] }>(base).then((catalog) => { if (live) setRoots(catalog.roots.filter((item) => kind === "document" || item.id === "codeit")); }).catch((cause) => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [base, kind]);
  async function save() {
    setBusy(true); setError("");
    try { const saved = await request<{ root: string; path: string }>(`${base}/file`, "POST", { root, name, content: text, kind }); setResult(`Created ${saved.path} in ${saved.root}.`); window.dispatchEvent(new Event("codeit:docs-changed")); }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  return <section aria-label={`Save idea as ${kind}`} className="idea-handoff"><h3>Save as {kind}</h3>
    <p>Creates a new file in a Docs source. Existing files cannot be replaced. The source idea stays unchanged.{kind === "rule" && " A rule document is not automatically enforced."}</p>
    {error && <p role="alert">{error}</p>}{result && <p role="status">{result}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}><label>Destination<select required value={root} disabled={busy || Boolean(result)} onChange={(event) => setRoot(event.target.value)}><option value="">Select a destination</option>{roots.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Filename<input required disabled={busy || Boolean(result)} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === "rule" ? "rule-example.md" : "example.md"} /></label>
      <label>Markdown content<textarea rows={10} disabled={busy || Boolean(result)} value={text} onChange={(event) => setText(event.target.value)} /></label>
      <h4>Preview</h4><article className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: () => null, a: ({ children }: { children?: ReactNode }) => <span>{children}</span> }}>{text}</ReactMarkdown></article>
      <div><Button type="submit" disabled={busy || Boolean(result) || !root || !name}>Create {kind}</Button> <Button type="button" disabled={busy} variant="outline" onClick={() => { if (result || window.confirm("Discard the unsaved handoff draft?")) onClose(); }}>Close</Button></div>
    </form></section>;
}
