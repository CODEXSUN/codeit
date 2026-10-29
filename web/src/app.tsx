import { useEffect, useState, type FormEvent } from "react";
import { Button } from "./components/ui/button.js";
import { ProjectDialog } from "./project-dialog.js";
import { Conversation } from "./conversation.js";
import { ProjectLoop } from "./project-loop.js";
import { WorkspaceRail, ProjectMenuList, type Workspace } from "./workspace-nav.js";
import { DocsWorkspace } from "./docs-workspace.js";
import { Supervisor } from "./supervisor.js";
import { Icon, SidebarProjects, type ChatSummary as Chat, type ProjectSummary as Project } from "./sidebar-projects.js";


export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<Workspace>("chat");
  const [visited, setVisited] = useState<Workspace[]>(["chat"]);
  const [selected, setSelected] = useState("");
  const [workProject, setWorkProject] = useState("");
  const [proposal, setProposal] = useState<{ projectId: string; text: string }>();
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 650);
  const [editing, setEditing] = useState<{ kind: "project" | "chat"; id: string; name: string }>();
  const [creating, setCreating] = useState<{ kind: "project" | "chat"; projectId?: string }>();
  const [name, setName] = useState("");
  const [projectDialog, setProjectDialog] = useState<Project | "new">();
  const [deleting, setDeleting] = useState<Chat>();

  async function loadProjects() {
    try {
      const result = await request<{ projects: Project[] }>("/api/projects");
      setProjects(result.projects);
      setWorkProject((current) => result.projects.some((item) => item.id === current) ? current : result.projects[0]?.id ?? "");
      setSelected((current) => result.projects.some((project) => project.chats.some((chat) => chat.id === current && !chat.archived)) ? current : result.projects.flatMap((project) => project.chats).find((chat) => !chat.archived)?.id ?? "");
      setError("");
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void loadProjects(); }, []);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      if (editing) {
        await request(`/api/${editing.kind === "project" ? "projects" : "chats"}/${encodeURIComponent(editing.id)}`, "PATCH", { name: name.trim() });
      } else if (creating) {
        const path = creating.kind === "project" ? "/api/projects" : `/api/projects/${encodeURIComponent(creating.projectId!)}/chats`;
        const result = await request<{ id: string }>(path, "POST", { name: name.trim() });
        if (creating.kind === "chat") setSelected(result.id);
      }
      setEditing(undefined);
      setCreating(undefined);
      await loadProjects();
    } catch (cause) { setError(message(cause)); }
  }

  function edit(kind: "project" | "chat", item: Project | Chat) {
    setCreating(undefined);
    setEditing({ kind, id: item.id, name: item.name });
    setName(item.name);
  }
  function create(kind: "project" | "chat", projectId?: string) {
    setEditing(undefined);
    if (kind === "project") { setProjectDialog("new"); return; }
    setCreating({ kind, projectId });
    setName("");
  }
  async function changeArchive(entry: Chat, archived: boolean) {
    try { await request(`/api/chats/${encodeURIComponent(entry.id)}/archive`, "PATCH", { archived }); await loadProjects(); }
    catch (cause) { setError(message(cause)); }
  }
  async function deleteChat() {
    if (!deleting) return;
    try { await request(`/api/chats/${encodeURIComponent(deleting.id)}`, "DELETE", {}); setDeleting(undefined); await loadProjects(); }
    catch (cause) { setError(message(cause)); }
  }
  const project = projects.find((item) => item.chats.some((chat) => chat.id === selected));
  const chat = project?.chats.find((item) => item.id === selected);
  const work = projects.find((item) => item.id === workProject);

  function switchWorkspace(value: Workspace) { setWorkspace(value); setVisited((current) => current.includes(value) ? current : [...current, value]); setSidebarOpen(window.innerWidth > 650); }
  function chooseProject(id: string) { setWorkProject(id); if (window.innerWidth <= 650) setSidebarOpen(false); }
  const docsView = workspace === "docs" || workspace === "rules";
  return <main className="app">
    <WorkspaceRail value={workspace} onChange={switchWorkspace} />
    <aside className={`sidebar ${sidebarOpen && !docsView ? "" : "closed"}`} aria-label={`${workspace} navigation`}>
      {workspace === "chat" ? <><div className="sidebar-brand"><span>CodeIT</span></div>
      <SidebarProjects projects={projects} selected={selected} select={(id) => { const entry = projects.flatMap((item) => item.chats).find((item) => item.id === id); if (entry?.archived) return; setSelected(id); if (window.innerWidth <= 650) setSidebarOpen(false); }} edit={edit} create={create} archive={(entry, archived) => void changeArchive(entry, archived)} remove={setDeleting} settings={setProjectDialog} /></> : workspace === "ideas" || workspace === "projects" ? <ProjectMenuList title={workspace === "ideas" ? "Ideas" : "Projects"} projects={projects} selected={workProject} onSelect={chooseProject} onCreate={() => create("project")} onSettings={(id) => { const item = projects.find((entry) => entry.id === id); if (item) setProjectDialog(item); }} /> : <><div className="sidebar-brand"><span className="brand-mark">&gt;_</span><span>Automation</span></div><p className="sidebar-empty">No automation features are configured.</p></>}

    </aside>
    <section className="main-panel" hidden={docsView}>
      <header className="header"><div className="header-path"><button type="button" className="icon-button sidebar-toggle" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="menu" /></button><span>{workspace === "chat" ? project?.name ?? "Chat" : workspace === "automation" ? "Automation" : work?.name ?? "Projects"}</span>{workspace === "chat" && chat && <><span className="separator">/</span><strong>{chat.name}</strong><button className="icon-button header-rename" type="button" aria-label={`Rename chat ${chat.name}`} title="Rename chat" onClick={() => edit("chat", chat)}><Icon name="edit" /></button></>}</div>{workspace === "chat" && chat && <span className="connection" role="status"><span className={`dot ${connection}`} />Codex {connection === "connecting" ? "connecting…" : connection}</span>}</header>
      {error && <div className="app-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      <div className="workspace-slot" hidden={workspace !== "chat"}>{chat ? <Conversation key={chat.id} chat={chat} onConnectionChange={setConnection} /> : <div className="no-chat"><h1>Select a chat</h1><p>Choose a chat from a project to start working.</p></div>}</div>
      {visited.includes("ideas") && <div className="workspace-slot" hidden={workspace !== "ideas"}>{work ? <Supervisor key={work.id} project={work} openPlan={() => switchWorkspace("projects")} handoff={(text) => { setProposal({ projectId: work.id, text }); switchWorkspace("projects"); }} /> : <div className="workspace-empty"><h1>No project selected</h1><p>Create or select a project to discuss ideas.</p></div>}</div>}
      {visited.includes("projects") && <div className="workspace-slot" hidden={workspace !== "projects"}>{work ? <ProjectLoop key={work.id} project={work} proposal={proposal?.projectId === work.id ? proposal.text : undefined} clearProposal={() => setProposal(undefined)} /> : <div className="workspace-empty"><h1>No project selected</h1><p>Create or select a project to manage its plan and tasks.</p></div>}</div>}
      {workspace === "automation" && <div className="workspace-empty"><h1>Automation</h1><p>Automation is not available in Codeit yet.</p></div>}
    </section>
    {visited.includes("docs") && <div className="workspace-content" hidden={workspace !== "docs"}><DocsWorkspace projects={projects} projectId={workProject} onProject={chooseProject} /></div>}
    {visited.includes("rules") && <div className="workspace-content" hidden={workspace !== "rules"}><DocsWorkspace projects={projects} projectId={workProject} onProject={chooseProject} rules /></div>}
    {projectDialog && <ProjectDialog project={projectDialog === "new" ? undefined : projectDialog} close={() => setProjectDialog(undefined)} saved={loadProjects} />}
    {deleting && <div className="dialog-backdrop" onMouseDown={() => setDeleting(undefined)}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setDeleting(undefined); }}><h2 id="delete-title">Delete chat?</h2><p id="delete-description">Permanently delete “{deleting.name}” and its saved Codeit conversation history. This cannot be undone. Project files are not deleted.</p><div className="dialog-actions"><Button variant="outline" autoFocus type="button" onClick={() => setDeleting(undefined)}>Cancel</Button><Button type="button" onClick={() => void deleteChat()}>Delete permanently</Button></div></div></div>}
    {(editing || creating) && <div className="dialog-backdrop" onMouseDown={() => { setEditing(undefined); setCreating(undefined); }}><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={(event) => void saveName(event)} onMouseDown={(event) => event.stopPropagation()}><h2 id="dialog-title">{editing ? "Rename" : "New"} {editing?.kind ?? creating?.kind}</h2><label htmlFor="item-name">Name</label><input id="item-name" autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /><div className="dialog-actions"><Button variant="outline" type="button" onClick={() => { setEditing(undefined); setCreating(undefined); }}>Cancel</Button><Button type="submit" disabled={!name.trim()}>{editing ? "Save" : "Create"}</Button></div></form></div>}
  </main>;
}

export async function request<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json", "x-codeit-request": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(result.error ?? result.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

