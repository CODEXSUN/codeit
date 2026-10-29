import { useState, type FormEvent } from "react";
import { Button } from "./components/ui/button.js";
import { message, request } from "./app.js";

export type ProjectSettings = { folder: string; sandbox: "read-only" | "workspace-write"; approvalPolicy: "untrusted" | "on-request" };
export function ProjectDialog({ project, close, saved }: { project?: { id: string; name: string; settings?: ProjectSettings }; close: () => void; saved: () => Promise<void> }) {
  const [name, setName] = useState(project?.name ?? "");
  const [folder, setFolder] = useState(project?.settings?.folder ?? "");
  const [resolved, setResolved] = useState("");
  const [sandbox, setSandbox] = useState<ProjectSettings["sandbox"]>(project?.settings?.sandbox ?? "read-only");
  const [approvalPolicy, setApprovalPolicy] = useState<ProjectSettings["approvalPolicy"]>(project?.settings?.approvalPolicy ?? "on-request");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function validate() {
    const result = await request<{ folder: string }>("/api/projects/resolve-folder", "POST", { folder });
    setResolved(result.folder);
    return result.folder;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true); setError("");
    try {
      const validatedFolder = await validate();
      const settings = { folder: validatedFolder, sandbox, approvalPolicy };
      if (project) await request(`/api/projects/${encodeURIComponent(project.id)}/settings`, "PATCH", settings);
      else await request("/api/projects", "POST", { name: name.trim(), settings });
      await saved(); close();
    } catch (cause) { setError(message(cause)); }
    finally { setPending(false); }
  }
  return <div className="dialog-backdrop" onMouseDown={close}><form className="dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <h2 id="project-dialog-title">{project ? "Folder and permissions" : "Create project"}</h2>
    {!project && <><label htmlFor="project-name">Project name</label><input autoFocus id="project-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} required /></>}
    <label htmlFor="project-folder">Working folder</label><input autoFocus={Boolean(project)} id="project-folder" value={folder} onChange={(event) => { setFolder(event.target.value); setResolved(""); }} placeholder="Absolute path, for example D:\\work\\project" required />
    <p className="field-hint">Enter a folder on the computer running Codeit. This browser cannot select a native folder path.</p>
    <button type="button" className="validate-folder" disabled={!folder.trim() || pending} onClick={() => { setError(""); void validate().catch((cause) => setError(message(cause))); }}>Validate folder</button>
    {resolved && <p className="field-hint" role="status">Resolved folder: {resolved}</p>}
    <label htmlFor="project-sandbox">Codex file access</label><select id="project-sandbox" value={sandbox} onChange={(event) => setSandbox(event.target.value as ProjectSettings["sandbox"])}><option value="read-only">Read only</option><option value="workspace-write">Workspace write</option></select>
    <label htmlFor="project-approval">Codex approvals</label><select id="project-approval" value={approvalPolicy} onChange={(event) => setApprovalPolicy(event.target.value as ProjectSettings["approvalPolicy"])}><option value="on-request">When Codex requests approval</option><option value="untrusted">For untrusted commands</option></select>
    <p className="field-hint">The selected folder is the working directory. Read-only limits writes but does not confine reads to that folder. Effective Codex settings do not prove operating-system isolation. Gemini does not run commands through this setting.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><Button variant="outline" type="button" onClick={close}>Cancel</Button><Button type="submit" disabled={pending || !folder.trim() || (!project && !name.trim())}>{project ? "Save" : "Create project"}</Button></div>
  </form></div>;
}
