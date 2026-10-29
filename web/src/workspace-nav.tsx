import type { ReactNode } from "react";
import "./workspaces.css";
export type Workspace = "chat" | "ideas" | "projects" | "automation" | "docs" | "rules" | "settings";
const icons: Record<Workspace, ReactNode> = {
  chat: <path d="M4 5h16v11H8l-4 3z" />,
  ideas: <><path d="M9 18h6M10 21h4M8 14c-1-1-2-2-2-4a6 6 0 1 1 12 0c0 2-1 3-2 4l-1 2H9z" /></>,
  projects: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  automation: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
  docs: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></>,
  rules: <><path d="M4 5a3 3 0 0 1 3-2h5v17H7a3 3 0 0 0-3 2zM20 5a3 3 0 0 0-3-2h-5v17h5a3 3 0 0 1 3 2z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>,
};
const labels: Record<Workspace,string> = { chat: "Chat", ideas: "Ideas", projects: "Projects", automation: "Automation", docs: "Docs", rules: "Rule Book", settings: "Settings" };
export function WorkspaceRail({ value, onChange }: { value: Workspace; onChange: (value: Workspace) => void }) {
  return <nav className="workspace-rail" aria-label="Workspaces"><div className="rail-brand" aria-hidden="true">&gt;_</div>{(Object.keys(labels) as Workspace[]).map((key) => <button type="button" key={key} className={`rail-button ${key === "settings" ? "rail-settings" : ""}`} aria-label={labels[key]} title={labels[key]} aria-current={value === key ? "page" : undefined} onClick={() => onChange(key)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[key]}</svg></button>)}</nav>;
}
export function ProjectMenuList({ projects, selected, onSelect, title, onSettings, onCreate }: { projects: { id: string; name: string }[]; selected: string; onSelect: (id: string) => void; title: string; onSettings?: (id: string) => void; onCreate?: () => void }) {
  return <><div className="sidebar-brand"><span className="brand-mark">&gt;_</span><span>{title}</span>{onCreate && <button type="button" className="icon-button" aria-label="Create project" title="Create project" onClick={onCreate}>+</button>}</div><nav className="workspace-projects" aria-label={`${title} projects`}>{projects.length === 0 && <p>No projects available.</p>}{projects.map((project) => <div className="workspace-project-row" key={project.id}><button type="button" aria-current={selected === project.id ? "page" : undefined} onClick={() => onSelect(project.id)}>{project.name}</button>{onSettings && <button type="button" className="workspace-settings" aria-label={`Folder and permissions for ${project.name}`} title="Folder and permissions" onClick={() => onSettings(project.id)}>⋯</button>}</div>)}</nav></>;
}
