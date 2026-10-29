import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./components/ui/button.js";
import { ProjectDialog } from "./project-dialog.js";
import { Conversation } from "./conversation.js";
import { ProjectLoop } from "./project-loop.js";
import { WorkspaceRail, ProjectMenuList, type Workspace } from "./workspace-nav.js";
import { DocsWorkspace } from "./docs-workspace.js";
import { SettingsWorkspace } from "./settings-workspace.js";
import { Supervisor } from "./supervisor.js";
import { Icon, SidebarProjects, type ChatSummary as Chat, type ProjectSummary as Project } from "./sidebar-projects.js";


export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const projectRequest = useRef(0);
  const [initialView] = useState(readView);
  const [workspace, setWorkspace] = useState<Workspace>(initialView.workspace);
  const [visited, setVisited] = useState<Workspace[]>(["chat", initialView.workspace]);
  const [selected, setSelected] = useState(initialView.chatId);
  const [openedChats, setOpenedChats] = useState<string[]>(initialView.chatId ? [initialView.chatId] : []);
  const [workProject, setWorkProject] = useState(initialView.projectId);
  const [openedProjects, setOpenedProjects] = useState<string[]>(initialView.projectId ? [initialView.projectId] : []);
  const [proposal, setProposal] = useState<{ projectId: string; text: string }>();
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 650);
  const [editing, setEditing] = useState<{ kind: "project" | "chat"; id: string; name: string }>();
  const [creating, setCreating] = useState<{ kind: "project" | "chat"; projectId?: string }>();
  const [name, setName] = useState("");
  const [projectDialog, setProjectDialog] = useState<Project | "new">();
  const [settingsTarget, setSettingsTarget] = useState<{ projectId: string; nonce: number }>();
  const [deleting, setDeleting] = useState<Chat>();

  async function loadProjects() {
    const requestId = ++projectRequest.current;
    try {
      const result = await request<{ projects: Project[] }>("/api/projects");
      if (requestId !== projectRequest.current) return;
      setProjects(result.projects);
      setOpenedProjects((current) => current.filter((id) => result.projects.some((item) => item.id === id)));
      const activeChats = new Set(result.projects.flatMap((item) => item.chats.filter((entry) => !entry.archived).map((entry) => entry.id)));
      setOpenedChats((current) => current.filter((id) => activeChats.has(id)));
      setWorkProject((current) => result.projects.some((item) => item.id === current) ? current : result.projects[0]?.id ?? "");
      setSelected((current) => result.projects.some((project) => project.chats.some((chat) => chat.id === current && !chat.archived)) ? current : result.projects.flatMap((project) => project.chats).find((chat) => !chat.archived)?.id ?? "");
      setError("");
    } catch (cause) { if (requestId === projectRequest.current) setError(message(cause)); }
    finally { if (requestId === projectRequest.current) setProjectsLoaded(true); }
  }
  useEffect(() => { void loadProjects(); return () => { projectRequest.current++; }; }, []);
  useEffect(() => { if (workProject) setOpenedProjects((current) => current.includes(workProject) ? current : [...current, workProject]); }, [workProject]);
  useEffect(() => { if (selected) setOpenedChats((current) => current.includes(selected) ? current : [...current, selected]); }, [selected]);
  useEffect(() => { try { sessionStorage.setItem("codeit-view", JSON.stringify({ workspace, chatId: selected, projectId: workProject })); } catch { /* Storage may be unavailable. */ } }, [workspace, selected, workProject]);

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
  const docsView = workspace === "docs" || workspace === "rules" || workspace === "settings";
  return <main className="app h-dvh overflow-hidden">
    <WorkspaceRail value={workspace} onChange={switchWorkspace} />
    <aside className={`sidebar ${sidebarOpen && !docsView ? "" : "closed"}`} aria-label={`${workspace} navigation`}>
      {workspace === "chat" ? <><div className="sidebar-brand"><span>CodeIT</span></div>
      <SidebarProjects projects={projects} selected={selected} select={(id) => { const entry = projects.flatMap((item) => item.chats).find((item) => item.id === id); if (entry?.archived) return; setSelected(id); if (window.innerWidth <= 650) setSidebarOpen(false); }} edit={edit} create={create} archive={(entry, archived) => void changeArchive(entry, archived)} remove={setDeleting} settings={setProjectDialog} preferences={(item) => { setSettingsTarget((current) => ({ projectId: item.id, nonce: (current?.nonce ?? 0) + 1 })); switchWorkspace("settings"); }} /></> : workspace === "ideas" || workspace === "projects" ? <ProjectMenuList title={workspace === "ideas" ? "Ideas" : "Projects"} projects={projects} selected={workProject} onSelect={chooseProject} onCreate={() => create("project")} onSettings={(id) => { const item = projects.find((entry) => entry.id === id); if (item) setProjectDialog(item); }} /> : <><div className="sidebar-brand"><span className="brand-mark">&gt;_</span><span>Automation</span></div><p className="sidebar-empty">No automation features are configured.</p></>}

    </aside>
    <section className="main-panel min-h-0 min-w-0" hidden={docsView}>
      <header className="header"><div className="header-path overflow-hidden"><button type="button" className="icon-button sidebar-toggle" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={() => setSidebarOpen(!sidebarOpen)}><Icon name="menu" /></button><span>{workspace === "chat" ? project?.name ?? "Chat" : workspace === "automation" ? "Automation" : work?.name ?? "Projects"}</span>{workspace === "chat" && chat && <><span className="separator">/</span><strong>{chat.name}</strong><button className="icon-button header-rename" type="button" aria-label={`Rename chat ${chat.name}`} title="Rename chat" onClick={() => edit("chat", chat)}><Icon name="edit" /></button></>}</div>{workspace === "chat" && chat && <span className="connection" role="status" aria-label={`Codex ${connection}`}><span className={`dot ${connection}`} /><span className="hidden min-[400px]:inline">Codex {connection === "connecting" ? "connecting…" : connection}</span></span>}</header>
      {error && <div className="app-error" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      <div className="workspace-slot overflow-hidden" hidden={workspace !== "chat"}>{(selected && !openedChats.includes(selected) ? [...openedChats, selected] : openedChats).map((id) => { const entry = projects.flatMap((item) => item.chats).find((item) => item.id === id && !item.archived); return entry ? <Conversation key={id} chat={entry} active={workspace === "chat" && id === selected} onConnectionChange={setConnection} /> : null; })}{!chat && <div className="no-chat" role="status"><h1>{projectsLoaded ? "Select a chat" : "Loading chats…"}</h1>{projectsLoaded && <p>Choose a chat from a project to start working.</p>}</div>}</div>
      {visited.includes("ideas") && <div className="workspace-slot workspace-scroll overflow-y-auto overscroll-contain" hidden={workspace !== "ideas"}>{(workProject && !openedProjects.includes(workProject) ? [...openedProjects, workProject] : openedProjects).map((id) => { const item = projects.find((entry) => entry.id === id); return item ? <Supervisor key={id} active={workspace === "ideas" && id === workProject} project={item} openPlan={() => switchWorkspace("projects")} handoff={(text) => { setProposal({ projectId: id, text }); switchWorkspace("projects"); }} /> : null; })}{!work && <div className="workspace-empty"><h1>No project selected</h1><p>Create or select a project to discuss ideas.</p></div>}</div>}
      {visited.includes("projects") && <div className="workspace-slot workspace-scroll overflow-y-auto overscroll-contain" hidden={workspace !== "projects"}>{(workProject && !openedProjects.includes(workProject) ? [...openedProjects, workProject] : openedProjects).map((id) => { const item = projects.find((entry) => entry.id === id); return item ? <ProjectLoop key={id} active={workspace === "projects" && id === workProject} project={item} proposal={proposal?.projectId === id ? proposal.text : undefined} clearProposal={() => setProposal(undefined)} /> : null; })}{!work && <div className="workspace-empty"><h1>No project selected</h1><p>Create or select a project to manage its plan and tasks.</p></div>}</div>}
      {workspace === "automation" && <div className="workspace-empty"><h1>Automation</h1><p>Automation is not available in Codeit yet.</p></div>}
    </section>
    {visited.includes("docs") && <div className="workspace-content min-h-0" hidden={workspace !== "docs"}><DocsWorkspace projects={projects} projectId={workProject} onProject={chooseProject} /></div>}
    {visited.includes("rules") && <div className="workspace-content min-h-0" hidden={workspace !== "rules"}><DocsWorkspace projects={projects} projectId={workProject} onProject={chooseProject} rules /></div>}
    {visited.includes("settings") && <div className="workspace-content min-h-0" hidden={workspace !== "settings"}><SettingsWorkspace key={settingsTarget?.nonce ?? 0} projects={projects} initialProject={settingsTarget?.projectId ?? workProject} projectScope={Boolean(settingsTarget)} /></div>}
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


function readView(): { workspace: Workspace; chatId: string; projectId: string } {
  const fallback = { workspace: "chat" as Workspace, chatId: "", projectId: "" };
  try {
    const value = JSON.parse(sessionStorage.getItem("codeit-view") ?? "null");
    if (!value || !["chat", "ideas", "projects", "automation", "docs", "rules"].includes(value.workspace)) return fallback;
    return { workspace: value.workspace, chatId: typeof value.chatId === "string" ? value.chatId : "", projectId: typeof value.projectId === "string" ? value.projectId : "" };
  } catch { return fallback; }
}
