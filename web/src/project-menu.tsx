import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon, type ProjectSummary } from "./sidebar-projects.js";

export function ProjectMenu({ project, onNewChat, onRename, onSettings }: { project: ProjectSummary; onNewChat: () => void; onRename: () => void; onSettings: () => void }) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="icon-button" aria-label={`Actions for ${project.name}`} title="Project actions"><Icon name="more" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="project-menu-content" side="top" align="end" sideOffset={5} collisionPadding={8}>
      <div className="project-menu-label">{project.settings?.folder ?? "Folder not configured"}</div>
      <DropdownMenu.Separator className="project-menu-separator" />
      <DropdownMenu.Item className="project-menu-item" onSelect={onNewChat}>New chat</DropdownMenu.Item>
      <DropdownMenu.Item className="project-menu-item" onSelect={onRename}>Rename project</DropdownMenu.Item>
      <DropdownMenu.Item className="project-menu-item" onSelect={onSettings}>Folder and permissions</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
