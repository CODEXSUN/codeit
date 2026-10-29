import { useEffect, useRef, useState } from "react";
import { request, message } from "./app.js";
import { Button } from "./components/ui/button.js";

type Model = { model: string; displayName: string; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: { reasoningEffort: string }[] };
export function PlanRefinement({ projectId, plan, onUse, onAddTask, canAddTask }: { projectId: string; plan: string; onUse: (text: string) => void; onAddTask: (text: string) => void; canAddTask: boolean }) {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const attempt = useRef<{ payload: string; id: string } | undefined>(undefined);
  async function load() {
    setError("");
    try {
      const status = await request<{ available: boolean; models: Model[]; reason?: string }>("/api/providers/codex/status");
      setLoaded(true); setModels(status.models);
      if (!status.available) { setError(status.reason ?? "Codex is unavailable."); return; }
      const initial = status.models.find((item) => item.isDefault) ?? status.models[0];
      setModel(initial?.model ?? ""); setEffort(initial?.defaultReasoningEffort ?? "");
    } catch (cause) { setLoaded(true); setError(message(cause)); }
  }
  async function refine() {
    if (result && !window.confirm("Replace the current proposal with a new provider response?")) return;
    setBusy(true); setError("");
    const selection = { provider: "codex", model, ...(effort ? { effort } : {}) };
    const payload = JSON.stringify({ plan, selection });
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
    try { const output = await request<{ text: string }>(`/api/projects/${encodeURIComponent(projectId)}/loop/refine-plan`, "POST", { text: plan, selection, requestId: attempt.current.id }); setResult(output.text); attempt.current = undefined; }
    catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  }
  const selected = models.find((item) => item.model === model);
  useEffect(() => { setResult(""); }, [projectId]);
  return <section aria-label="Refine plan"><h3>Refine plan with Codex</h3><p>Sending this draft to Codex is explicit. Review the response before using or saving it.</p>
    {!loaded && <Button type="button" onClick={() => void load()}>Load Codex models</Button>}
    {loaded && <Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>Refresh models</Button>}
    {models.length > 0 && <><label>Model<select value={model} disabled={busy} onChange={(event) => { const next = models.find((item) => item.model === event.target.value); setModel(event.target.value); setEffort(next?.defaultReasoningEffort ?? ""); }}>{models.map((item) => <option key={item.model} value={item.model}>{item.displayName}</option>)}</select></label>{selected?.supportedReasoningEfforts.length ? <label>Reasoning<select value={effort} disabled={busy} onChange={(event) => setEffort(event.target.value)}>{selected.supportedReasoningEfforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort}>{item.reasoningEffort}</option>)}</select></label> : null}<Button type="button" disabled={busy || !plan.trim() || !model} onClick={() => void refine()}>{busy ? "Refining…" : "Refine plan"}</Button></>}
    {error && <><p role="alert">{error}</p><p>The previous attempt may have reached the provider. Starting a new attempt can send the plan again.</p><Button type="button" variant="outline" disabled={busy} onClick={() => { attempt.current = undefined; setError(""); }}>Start a new attempt</Button></>}{result && <><label>Proposed plan or task<textarea rows={8} value={result} disabled={busy} onChange={(event) => setResult(event.target.value)} /></label><Button type="button" disabled={busy} onClick={() => { if (!plan.trim() || window.confirm("Replace the current plan summary draft with this proposal?")) onUse(result); }}>Use proposed summary</Button> <Button type="button" variant="outline" disabled={busy || !result.trim() || !canAddTask} onClick={() => onAddTask(result)}>Add as task draft</Button><p>Edit the proposal to the task you want before adding it. Review its title and description before saving the plan.{!canAddTask && " A plan can have at most 20 tasks."}</p></>}
  </section>;
}
