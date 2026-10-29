import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icon, type ProjectSummary } from "./sidebar-projects.js";

export function ProjectMenu({ project, onNewChat, onRename, onSettings, onPreferences }: { project: ProjectSummary; onNewChat: () => void; onRename: () => void; onSettings: () => void; onPreferences: () => void }) {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="icon-button" aria-label={`Actions for ${project.name}`} title="Project actions"><Icon name="more" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="project-menu-content" side="top" align="end" sideOffset={5} collisionPadding={8}>
      <div className="flex items-center gap-1"><div className="project-menu-label flex min-w-0 flex-1 items-start gap-2"><Icon name="folder" /><span>{project.settings?.folder ?? "Folder not configured"}</span></div><DropdownMenu.Item className="project-menu-item grid h-8 w-8 shrink-0 place-items-center" aria-label={`Settings for ${project.name}`} title="Project settings" onSelect={onPreferences}><Icon name="settings" /></DropdownMenu.Item></div>
      <DropdownMenu.Separator className="project-menu-separator" />
      <DropdownMenu.Item className="project-menu-item flex items-center gap-2" onSelect={onNewChat}><Icon name="addchat" />New chat</DropdownMenu.Item>
      <DropdownMenu.Item className="project-menu-item flex items-center gap-2" onSelect={onRename}><Icon name="edit" />Rename project</DropdownMenu.Item>
      <DropdownMenu.Item className="project-menu-item flex items-center gap-2" onSelect={onSettings}><Icon name="settings" />Folder and permissions</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
