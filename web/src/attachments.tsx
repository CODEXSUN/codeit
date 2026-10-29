import { DndContext, useDroppable } from "@dnd-kit/core";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { recognize } from "tesseract.js";
import "./attachments.css";
import { ComposerIcon } from "./composer-icon.js";

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "text" | "image";
  content: string;
  ocrText?: string;
};

type Props = { attachments: Attachment[]; setAttachments: Dispatch<SetStateAction<Attachment[]>>; disabled?: boolean; onProcessingChange?: (processing: boolean) => void };
const textExtensions = /\.(txt|md|markdown|json|jsonc|js|jsx|ts|tsx|mjs|cjs|css|scss|html|xml|svg|yaml|yml|toml|ini|conf|env|sh|ps1|py|java|c|h|cpp|hpp|cs|go|rs|sql|csv|log|diff|patch|gitignore|dockerfile)$/i;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const maxText = 1024 * 1024;
const maxImage = 5 * 1024 * 1024;
const maxCount = 5;

export function AttachmentComposer(props: Props) {
  return <DndContext><AttachmentArea {...props} /></DndContext>;
}

function AttachmentArea({ attachments, setAttachments, disabled, onProcessingChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const { setNodeRef } = useDroppable({ id: "composer-files", disabled });
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [recognizing, setRecognizing] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => { onProcessingChange?.(reading || recognizing !== null); }, [reading, recognizing, onProcessingChange]);

  async function addFiles(files: FileList | File[]) {
    if (reading || recognizing !== null) return;
    setReading(true);
    const incoming = Array.from(files);
    const errors: string[] = [];
    const available = Math.max(0, maxCount - attachments.length);
    if (incoming.length > available) errors.push(`You can attach up to ${maxCount} files.`);
    const added: Attachment[] = [];
    for (const file of incoming.slice(0, available)) {
      const image = imageTypes.has(file.type);
      const text = file.type.startsWith("text/") || textExtensions.test(file.name) || /^(Dockerfile|Makefile|\.env|\.gitignore)$/i.test(file.name);
      if (!image && !text) { errors.push(`${file.name}: unsupported file type.`); continue; }
      if (file.size > (image ? maxImage : maxText)) { errors.push(`${file.name}: exceeds the ${image ? "5 MB" : "1 MB"} limit.`); continue; }
      try {
        const content = image ? await readDataUrl(file) : new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        if (!image && content.includes("\0")) throw new Error("not a text file");
        added.push({ id: crypto.randomUUID(), name: file.name, mimeType: file.type || (image ? "image/png" : "text/plain"), kind: image ? "image" : "text", content });
      } catch { errors.push(`${file.name}: could not read as ${image ? "an image" : "UTF-8 text"}.`); }
    }
    setAttachments((current) => [...current, ...added].slice(0, maxCount));
    setError(errors.join(" "));
    setReading(false);
  }

  async function extractText(attachment: Attachment) {
    setRecognizing(attachment.id);
    setError("");
    try {
      const result = await recognize(attachment.content, "eng");
      if (new TextEncoder().encode(result.data.text).length > 100 * 1024) throw new Error("Extracted text exceeds 100 KiB");
      setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, ocrText: result.data.text } : item));
    } catch (cause) { setError(`OCR failed for ${attachment.name}: ${cause instanceof Error ? cause.message : "unknown error"}. Check your network connection and try again.`); }
    finally { setRecognizing(null); }
  }

  useEffect(() => {
    const form = input.current?.closest("form");
    if (!form) return;
    const hasFiles = (event: globalThis.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: globalThis.DragEvent) => { if (hasFiles(event)) { event.preventDefault(); setDragging(true); } };
    const over = (event: globalThis.DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
    const leave = (event: globalThis.DragEvent) => { if (!form.contains(event.relatedTarget as Node | null)) setDragging(false); };
    const drop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault(); setDragging(false);
      if (!disabled && event.dataTransfer) void addFiles(event.dataTransfer.files);
    };
    form.addEventListener("dragenter", enter); form.addEventListener("dragover", over);
    form.addEventListener("dragleave", leave); form.addEventListener("drop", drop);
    return () => { form.removeEventListener("dragenter", enter); form.removeEventListener("dragover", over); form.removeEventListener("dragleave", leave); form.removeEventListener("drop", drop); };
  });

  return <div ref={setNodeRef} className={`attachment-area ${dragging ? "attachment-dragging" : ""}`}>
    <div className="attachment-tools"><button type="button" className="composer-icon" aria-label="Attach files" title="Attach files or drop files here" disabled={disabled || reading || recognizing !== null} onClick={() => input.current?.click()}><ComposerIcon name="attach" /></button></div>
    <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.jsonc,.js,.jsx,.ts,.tsx,.mjs,.cjs,.css,.scss,.html,.xml,.svg,.yaml,.yml,.toml,.ini,.conf,.env,.sh,.ps1,.py,.java,.c,.h,.cpp,.hpp,.cs,.go,.rs,.sql,.csv,.log,.diff,.patch" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }} />
    {dragging && <div className="attachment-drop-label">Drop files to attach</div>}
    {error && <p className="attachment-error" role="alert">{error}</p>}
    {attachments.length > 0 && <div className="attachment-list">{attachments.map((attachment) => <div className="attachment-card" key={attachment.id}>
      {attachment.kind === "image" && <img src={attachment.content} alt={`Preview of ${attachment.name}`} />}
      <div className="attachment-info"><div className="attachment-name" title={attachment.name}>{attachment.name}</div><div className="attachment-actions">
        {attachment.kind === "image" && <button type="button" className="composer-icon" aria-label={`Extract text from ${attachment.name} (OCR)`} title="Extract text (OCR)" disabled={disabled || recognizing !== null} onClick={() => void extractText(attachment)}><ComposerIcon name="ocr" /></button>}{recognizing === attachment.id && <span role="status">Reading text…</span>}
        <button type="button" className="composer-icon" aria-label={`Remove ${attachment.name}`} title="Remove attachment" disabled={disabled} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><ComposerIcon name="remove" /></button></div>
        {attachment.kind === "text" && <details><summary>View file text</summary><pre>{attachment.content}</pre></details>}
        {attachment.ocrText !== undefined && <label className="attachment-ocr">Extracted text (editable; sent with this image)<textarea value={attachment.ocrText} rows={3} onChange={(event) => { const value = event.target.value; if (new TextEncoder().encode(value).length > 100 * 1024) { setError("Extracted text exceeds 100 KiB."); return; } setError(""); setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, ocrText: value } : item)); }} /></label>}
      </div></div>)}</div>}
  </div>;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid image"));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
