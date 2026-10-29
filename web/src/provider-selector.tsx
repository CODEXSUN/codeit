import { useEffect, useRef, useState } from "react";
import { request, message } from "./app.js";
import "./provider-selector.css";

export type ProviderSelection = { provider: "codex" | "gemini"; model?: string; effort?: string };
type Model = { model: string; displayName: string; isDefault: boolean; defaultReasoningEffort: string; supportedReasoningEfforts: { reasoningEffort: string; description: string }[]; inputModalities: string[] };
type Catalog = { lockedProvider?: "codex" | "gemini"; codex: { available: boolean; models: Model[]; reason?: string }; gemini: { available: boolean; models: { model: string; displayName: string }[]; reason?: string } };

export function ProviderSelector({ base, value, onChange, disabled = false, refreshKey = 0 }: { base: string; value: ProviderSelection; onChange: (value: ProviderSelection) => void; disabled?: boolean; refreshKey?: number }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState("");
  const callback = useRef(onChange); callback.current = onChange;
  const current = useRef(value); current.current = value;
  useEffect(() => {
    let active = true;
    request<Catalog>(`${base}/providers`).then((data) => {
      if (!active) return;
      setCatalog(data);
      const provider = data.lockedProvider ?? current.current.provider;
      if (provider === "codex") {
        const initial = data.codex.models.find((item) => item.isDefault) ?? data.codex.models[0];
        callback.current(current.current.provider === provider && current.current.model ? current.current : { provider, model: initial?.model, effort: initial?.defaultReasoningEffort });
      } else callback.current(current.current.provider === provider && current.current.model ? current.current : { provider, model: data.gemini.models[0]?.model });
    }).catch((cause) => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [base, refreshKey]);
  const model = catalog?.codex.models.find((item) => item.model === value.model);
  const missingModel = Boolean(catalog && value.model && (value.provider === "codex" ? catalog.codex.available && !model : catalog.gemini.available && !catalog.gemini.models.some((item) => item.model === value.model)));
  const missingEffort = Boolean(model && value.effort && !model.supportedReasoningEfforts.some((item) => item.reasoningEffort === value.effort));
  const reason = error || (missingModel ? "The selected model is no longer available. Choose another model." : missingEffort ? "The selected reasoning level is no longer available. Choose another level." : "") || (value.provider === "gemini" ? !catalog?.gemini.available ? catalog?.gemini.reason : "Gemini uses text generation and has no workspace tools. Reasoning uses the model default." : !catalog?.codex.available ? catalog?.codex.reason : "");
  return <div className="provider-selector">
    <label><span className="sr-only">Provider</span><select aria-label="Provider" title={catalog?.lockedProvider ? "Provider is fixed for this chat. Create a new chat to change it." : "Provider"} disabled={disabled || Boolean(catalog?.lockedProvider)} value={value.provider} onChange={(event) => {
      if (event.target.value === "gemini") onChange({ provider: "gemini", model: catalog?.gemini.models[0]?.model });
      else { const next = catalog?.codex.models.find((item) => item.isDefault) ?? catalog?.codex.models[0]; onChange({ provider: "codex", model: next?.model, effort: next?.defaultReasoningEffort }); }
    }}><option value="codex">Codex{catalog && !catalog.codex.available ? " (unavailable)" : ""}</option><option value="gemini">Gemini{catalog && !catalog.gemini.available ? " (unavailable)" : ""}</option></select></label>
    {value.provider === "codex" && catalog?.codex.available && <><label><span className="sr-only">Model</span><select aria-label="Model" title="Model" disabled={disabled || !catalog.codex.models.length} value={value.model ?? ""} onChange={(event) => { const next = catalog.codex.models.find((item) => item.model === event.target.value); if (next) onChange({ provider: "codex", model: next.model, effort: next.defaultReasoningEffort }); }}>{missingModel && <option value={value.model}>Unavailable: {value.model}</option>}{catalog.codex.models.map((item) => <option key={item.model} value={item.model}>{item.displayName}</option>)}</select></label>
    {model && model.supportedReasoningEfforts.length > 0 && <label><span className="sr-only">Reasoning</span><select aria-label="Reasoning" title="Reasoning" disabled={disabled} value={value.effort ?? ""} onChange={(event) => onChange({ ...value, effort: event.target.value })}>{missingEffort && <option value={value.effort}>Unavailable: {value.effort}</option>}{model.supportedReasoningEfforts.map((item) => <option key={item.reasoningEffort} value={item.reasoningEffort} title={item.description}>{item.reasoningEffort}</option>)}</select></label>}</>}
    {value.provider === "gemini" && catalog?.gemini.available && <label><span className="sr-only">Model</span><select aria-label="Model" title="Gemini model" disabled={disabled} value={value.model ?? ""} onChange={(event) => onChange({ provider: "gemini", model: event.target.value })}>{missingModel && <option value={value.model}>Unavailable: {value.model}</option>}{catalog.gemini.models.map((item) => <option key={item.model} value={item.model}>{item.displayName}</option>)}</select></label>}
    {!catalog && !error && <span role="status">Loading models…</span>}{reason && <span role="status">{reason}</span>}{catalog?.lockedProvider && <span title="Create a new chat to use another provider">Provider fixed for this chat</span>}
  </div>;
}
