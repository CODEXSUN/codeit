import { useState } from "react";
import { ProjectMenu } from "./project-menu.js";
import type { ProjectSettings } from "./project-dialog.js";

export type ChatSummary = { id: string; name: string; archived?: boolean };
export type ProjectSummary = { id: string; name: string; settings?: ProjectSettings; chats: ChatSummary[] };
type Props = { projects: ProjectSummary[]; selected: string; select: (id: string) => void; edit: (kind: "project" | "chat", item: ProjectSummary | ChatSummary) => void; create: (kind: "project" | "chat", projectId?: string) => void; archive: (chat: ChatSummary, archived: boolean) => void; remove: (chat: ChatSummary) => void; settings: (project: ProjectSummary) => void };

export function SidebarProjects({ projects, selected, select, edit, create, archive, remove, settings }: Props) {
  const [showArchived, setShowArchived] = useState(false);
  return <>
    <div className="sidebar-heading"><span>Projects</span><button className="icon-button" type="button" aria-label="Create project" title="Create project" onClick={() => create("project")}>+</button></div>
    <nav className="project-list" aria-label="Projects and chats">
      {projects.length === 0 && <p className="sidebar-empty">No projects yet. Create one to get started.</p>}
      {projects.map((project) => {
        const chats = project.chats.filter((chat) => Boolean(chat.archived) === showArchived);
        return <section className="project" key={project.id}>
          <div className="project-row"><span className="project-icon" aria-hidden="true"><Icon name="folder" /></span><span className="project-name" title={project.name}>{project.name}</span>
            <ProjectMenu project={project} onNewChat={() => { setShowArchived(false); create("chat", project.id); }} onRename={() => edit("project", project)} onSettings={() => settings(project)} />
          </div>
          <div className="chat-list">{chats.map((chat) => <div className={`chat-row ${selected === chat.id && !showArchived ? "active" : ""}`} key={chat.id}>
            {showArchived ? <div className="chat-link archived-name"><span aria-hidden="true"><Icon name="chat" /></span><span>{chat.name}</span></div> : <button type="button" className="chat-link" onClick={() => select(chat.id)} aria-current={selected === chat.id ? "page" : undefined}><span aria-hidden="true"><Icon name="chat" /></span><span>{chat.name}</span></button>}
            <div className="chat-actions">
              {!showArchived && <button className="icon-button" type="button" aria-label={`Rename chat ${chat.name}`} title="Rename chat" onClick={() => edit("chat", chat)}><Icon name="edit" /></button>}
              <button className="icon-button" type="button" aria-label={`${showArchived ? "Restore" : "Archive"} chat ${chat.name}`} title={showArchived ? "Restore chat" : "Archive chat"} onClick={() => archive(chat, !showArchived)}><Icon name={showArchived ? "restore" : "archive"} /></button>
              <button className="icon-button" type="button" aria-label={`Delete chat ${chat.name}`} title="Delete chat" onClick={() => remove(chat)}><Icon name="delete" /></button>
            </div>
          </div>)}{chats.length === 0 && <p className="sidebar-empty">{showArchived ? "No archived chats" : "No chats yet"}</p>}</div>
        </section>;
      })}
    </nav>
    <button className="archive-toggle" type="button" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Show active chats" : "Archived chats"}</button>
  </>;
}

export function Icon({ name }: { name: "folder" | "chat" | "edit" | "menu" | "more" | "archive" | "restore" | "delete" }) {
  const paths = {
    folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    chat: <path d="M4 5h16v11H8l-4 3z" />,
    edit: <><path d="m4 20 4-1 11-11-3-3L5 16z" /><path d="m14 7 3 3" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />,
    archive: <><path d="M4 4h16v4H4zM5 8v12h14V8M10 12h4" /></>,
    restore: <><path d="M4 4h16v4H4zM5 8v12h14V8M12 17v-6m-3 3 3-3 3 3" /></>,
    delete: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></>
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
