import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { request, message } from "./app.js";
import type { ProviderSelection } from "./provider-selector.js";
import "./settings-workspace.css";

type Scope = "workspace" | "project" | "chat";
type Model = { model: string; displayName: string; defaultReasoningEffort?: string; supportedReasoningEfforts?: { reasoningEffort: string }[] };
type Status = { available: boolean; models: Model[]; reason?: string; account?: { state: "signed_in" | "signed_out" | "unknown"; type?: string; email?: string } };
type Preferences = { revision: number; overrides: Record<Scope, { selection?: ProviderSelection } | null>; effective: { selection: ProviderSelection }; source: { selection: string } };
type Project = { id: string; name: string; chats: { id: string; name: string }[] };
const sections = [["providers", "AI providers and agents"], ["codex", "Codex"], ["gemini", "Gemini"], ["theme", "Theme"], ["keys", "API keys"], ["connectors", "Local connectors"]] as const;
type Section = typeof sections[number][0];

export function SettingsWorkspace({ projects, initialProject, projectScope = false }: { projects: Project[]; initialProject?: string; projectScope?: boolean }) {
  const [section, setSection] = useState<Section>("providers");
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const [scope, setScope] = useState<Scope>(projectScope ? "project" : "workspace");
  const [projectId, setProjectId] = useState(initialProject ?? "");
  const [chatId, setChatId] = useState("");
  const [prefs, setPrefs] = useState<Preferences>();
  const [selection, setSelection] = useState<ProviderSelection>({ provider: "codex" });
  const [statuses, setStatuses] = useState<Partial<Record<"codex" | "gemini", Status>>>({});
  const [testing, setTesting] = useState<Partial<Record<"codex" | "gemini", boolean>>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const project = projects.find((item) => item.id === projectId);
  const target = scope === "workspace" ? "default" : scope === "project" ? projectId : chatId;
  const query = new URLSearchParams();
  if (scope !== "workspace" && projectId) query.set("projectId", projectId);
  if (scope === "chat" && chatId) query.set("chatId", chatId);
  const queryString = query.toString();
  async function load() {
    const data = await request<Preferences>(`/api/preferences${queryString ? `?${queryString}` : ""}`);
    setPrefs(data); setSelection(data.overrides[scope]?.selection ?? data.effective.selection);
  }
  useEffect(() => {
    let active = true;
    setPrefs(undefined); setError("");
    if (!target) return () => { active = false; };
    request<Preferences>(`/api/preferences${queryString ? `?${queryString}` : ""}`).then((data) => {
      if (active) { setPrefs(data); setSelection(data.overrides[scope]?.selection ?? data.effective.selection); }
    }).catch((cause) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [scope, target, queryString]);
  async function testProvider(provider: "codex" | "gemini") {
    setTesting((current) => ({ ...current, [provider]: true })); setError("");
    try { const result = await request<Status>(`/api/providers/${provider}/status`); setStatuses((current) => ({ ...current, [provider]: result })); }
    catch (cause) { setStatuses((current) => ({ ...current, [provider]: { available: false, models: [], reason: "Connection check failed. Check the Codeit server and retry." } })); setError(message(cause)); }
    finally { setTesting((current) => ({ ...current, [provider]: false })); }
  }
  async function save(value: ProviderSelection | null) {
    if (!prefs || !target) return;
    setSaving(true); setError("");
    try { await request(`/api/preferences/${scope}/${encodeURIComponent(target)}`, "PUT", { revision: prefs.revision, selection: value }); window.dispatchEvent(new Event("codeit:preferences-changed")); await load(); }
    catch (cause) { setError(message(cause)); }
    finally { setSaving(false); }
  }
  const status = statuses[selection.provider];
  const model = status?.models.find((item) => item.model === selection.model);
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : event.key === "ArrowDown" || event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const key = sections[next][0]; setSection(key); tabRefs.current[key]?.focus();
  }
  return <section className="settings-workspace" aria-label="Settings">
    <header><h1>Settings</h1><p>Choose defaults for this workspace, a project, or a chat.</p></header>
    <div className="settings-layout">
    <div className="settings-tabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical">{sections.map(([key, label], index) => <button key={key} ref={(element) => { tabRefs.current[key] = element; }} type="button" role="tab" id={`settings-tab-${key}`} aria-controls="settings-panel" aria-selected={section === key} tabIndex={section === key ? 0 : -1} onClick={() => setSection(key)} onKeyDown={(event) => navigateTabs(event, index)}>{label}</button>)}</div>
    <div className="settings-panel" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`} tabIndex={0}>
    {section === "providers" && <div className="settings-body"><h2>AI providers and agents</h2><p>Providers supply models. Codeit’s supervisor, worker and reviewer are workflows that use Codex; they are not separate provider connections.</p>
      <p>Check each provider in its own settings page before choosing a model below.</p>
      <h3>Default selection</h3><fieldset className="settings-fields" disabled={saving}><legend className="sr-only">Default selection scope and model</legend><label>Scope<select value={scope} onChange={(event) => setScope(event.target.value as Scope)}><option value="workspace">Workspace</option><option value="project">Project</option><option value="chat">Chat</option></select></label>
      {scope !== "workspace" && <label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setChatId(""); }}><option value="">Select a project</option>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      {scope === "chat" && <label>Chat<select value={chatId} onChange={(event) => setChatId(event.target.value)}><option value="">Select a chat</option>{project?.chats.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      <label>Provider<select value={selection.provider} onChange={(event) => setSelection({ provider: event.target.value as "codex" | "gemini" })}><option value="codex">Codex</option><option value="gemini">Gemini</option></select></label>
      <label>Model<select value={selection.model ?? ""} onChange={(event) => { const next = status?.models.find((item) => item.model === event.target.value); setSelection({ provider: selection.provider, ...(next ? { model: next.model, ...(next.defaultReasoningEffort ? { effort: next.defaultReasoningEffort } : {}) } : {}) }); }}><option value="">Provider default</option>{selection.model && !model && <option value={selection.model}>{status?.available ? "Unavailable" : "Not verified"}: {selection.model}</option>}{status?.models.map((item) => <option key={item.model} value={item.model}>{item.displayName}</option>)}</select></label>
      {model?.supportedReasoningEfforts?.length ? <label>Reasoning<select value={selection.effort ?? ""} onChange={(event) => setSelection({ ...selection, effort: event.target.value || undefined })}><option value="">Model default</option>{model.supportedReasoningEfforts.map((item) => <option value={item.reasoningEffort} key={item.reasoningEffort}>{item.reasoningEffort}</option>)}</select></label> : null}</fieldset>
      {prefs && <p>Effective: {prefs.effective.selection.provider}{prefs.effective.selection.model ? ` / ${prefs.effective.selection.model}` : " / provider default"} · from {prefs.source.selection}.</p>}
      <div className="settings-actions"><button type="button" disabled={!prefs || saving} onClick={() => void save(selection)}>Save selection</button><button type="button" disabled={!prefs || saving || !prefs.overrides[scope]?.selection} onClick={() => void save(null)}>Use inherited selection</button></div>
    </div>}
    {(section === "codex" || section === "gemini") && <div className="settings-body"><h2>{section === "codex" ? "Codex" : "Gemini"}</h2>
      <div className="provider-check"><div><strong>Last check</strong><p role="status">{testing[section] ? "Checking…" : statuses[section] ? statuses[section]!.available ? "Models discovered on last check" : statuses[section]!.reason : "Not checked"}</p></div><button type="button" disabled={Boolean(testing[section])} onClick={() => void testProvider(section)}>{testing[section] ? "Checking…" : section === "codex" ? "Check local Codex" : "Check Gemini API"}</button></div>
      <p>{section === "codex" ? !statuses.codex ? "Account: not checked." : statuses.codex.account?.state === "signed_out" ? "Not signed in. Sign in with the Codex CLI and check again." : statuses.codex.account?.state === "signed_in" ? statuses.codex.account.email ? `Account: ${statuses.codex.account.email}` : `Account: ${statuses.codex.account.type ?? "signed in"}; identity unavailable.` : "Account identity unavailable." : "Account identity unavailable for API-key access."}</p>
    </div>}
    {section === "theme" && <div className="settings-body"><h2>Theme</h2><p>Codeit currently uses its light theme. Other themes are not available yet.</p></div>}
    {section === "keys" && <div className="settings-body"><h2>API keys</h2><p>Gemini reads GEMINI_API_KEY or GOOGLE_API_KEY from the Codeit server environment. Restart Codeit after changing it. Codeit does not save API keys here.</p><p>Codex uses its own CLI sign-in.</p></div>}
    {section === "connectors" && <div className="settings-body"><h2>Local connectors</h2><p>No configurable local connectors are implemented. Codex CLI is a provider integration and can be tested under AI providers.</p></div>}
    {error && <p className="settings-error" role="alert">{error}</p>}
    </div></div>
  </section>;
}
