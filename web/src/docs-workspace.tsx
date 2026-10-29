import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { message, request } from "./app.js";
import type { ProjectSummary } from "./sidebar-projects.js";
import "./docs-workspace.css";

type Root = { id: string; label: string };
type FileEntry = { root: string; path: string };
type Catalog = { roots: Root[]; files: FileEntry[] };
export function DocsWorkspace({ projects, projectId, onProject, rules = false }: { projects: ProjectSummary[]; projectId: string; onProject: (id: string) => void; rules?: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [root, setRoot] = useState("");
  const [file, setFile] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const base = `/api/projects/${encodeURIComponent(projectId)}/docs`;
  useEffect(() => {
    setCatalog(undefined); setRoot(""); setFile(""); setContent(""); setError(""); setLoading(false);
    if (!projectId) return;
    let live = true;
    request<Catalog>(base).then((result) => { if (live) setCatalog(result); }).catch((cause) => { if (live) setError(message(cause)); });
    return () => { live = false; };
  }, [base, projectId]);
  useEffect(() => {
    if (!root || !file) { setLoading(false); return; }
    let live = true;
    setLoading(true); setError(""); setContent("");
    request<{ content: string }>(`${base}/file?${new URLSearchParams({ root, path: file })}`).then((result) => { if (live) setContent(result.content); }).catch((cause) => { if (live) setError(message(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [base, root, file]);
  const entries = (catalog?.files ?? []).filter((entry) => entry.root === root && (!rules || ["rule-book.md", "agent-rules.md", "architecture.md"].includes(entry.path.replaceAll("\\", "/"))));
  return <div className="docs-layout min-h-0 min-w-0"><aside className="docs-sidebar" aria-label={`${rules ? "Rule Book" : "Docs"} navigation`}><h2>{rules ? "Rule Book" : "Docs"}</h2><label>Project<select aria-label="Documentation project" value={projectId} onChange={(event) => onProject(event.target.value)}><option value="" disabled>Select project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    {catalog && <label>Source folder<select aria-label="Documentation source folder" value={root} onChange={(event) => { setRoot(event.target.value); setFile(""); setContent(""); setLoading(false); }}><option value="">Select an allowed source</option>{catalog.roots.filter((item) => !rules || item.id === "codeit").map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>}
    {root && <nav aria-label="Documents">{entries.length === 0 ? <p>No {rules ? "rule documents" : "Markdown files"} in this source.</p> : entries.map((entry) => <button type="button" key={entry.path} aria-current={file === entry.path ? "page" : undefined} onClick={() => setFile(entry.path)}>{entry.path}</button>)}</nav>}
    {rules && <p>Shared Assist governance and agent rules are outside the allowed Docs sources and cannot be opened here.</p>}
  </aside><section className="docs-main workspace-scroll min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain" aria-label={`${rules ? "Rule Book" : "Docs"} viewer`}><header><h1>{file || (rules ? "Rule Book" : "Docs")}</h1><p>Markdown and MDX are displayed as inert content. Embedded code and components do not run. Images and links are disabled.</p></header>{error && <p role="alert" className="docs-error">{error}</p>}{loading ? <p role="status">Loading document…</p> : file ? <article className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: () => null, a: ({ children }: { children?: ReactNode }) => <span>{children}</span> }}>{content}</ReactMarkdown></article> : <p className="docs-placeholder">Select an allowed source folder and a document to read.</p>}</section></div>;
}
