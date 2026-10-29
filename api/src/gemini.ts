import type { MessageInput } from "./message-input.js";

export type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string }; thought?: boolean; thoughtSignature?: string };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type GeminiModel = { model: string; displayName: string };
type Fetch = typeof fetch;
const endpoint = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiClient {
  constructor(private readonly apiKey: string, private readonly fetcher: Fetch = fetch) {}
  static fromEnvironment() {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    return key ? new GeminiClient(key) : undefined;
  }
  async models(): Promise<GeminiModel[]> {
    const models: GeminiModel[] = [];
    let token = "";
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (token) params.set("pageToken", token);
      const response = await this.fetcher(`${endpoint}/models?${params}`, { headers: { "x-goog-api-key": this.apiKey }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Gemini model discovery failed (${response.status}). Check the API key and network.`);
      const data = await response.json() as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
      for (const model of data.models ?? []) {
        if (/^models\/gemini-[a-z0-9.-]+$/i.test(model.name) && model.supportedGenerationMethods?.includes("generateContent")) models.push({ model: model.name, displayName: model.displayName ?? model.name });
      }
      token = data.nextPageToken ?? "";
    } while (token);
    return models;
  }

  async stream(model: string, history: GeminiContent[], message: MessageInput, onDelta: (text: string) => void): Promise<GeminiContent[]> {
    const models = await this.models();
    if (!models.some((item) => item.model === model)) throw new Error("The selected Gemini model is unavailable. Choose an available model.");
    if (message.selection.effort) throw new Error("Gemini reasoning selection is not supported by Codeit; use the model default.");
    const user: GeminiContent = { role: "user", parts: message.text ? [{ text: message.text }] : [] };
    for (const item of message.attachments) {
      if (item.kind === "text") user.parts.push({ text: `Attached text file: ${item.name}\n\n${item.content}` });
      else {
        const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.*)$/.exec(item.content);
        if (!match) throw new Error("Unsupported image format for Gemini.");
        user.parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        if (item.ocrText) user.parts.push({ text: `OCR text from image: ${item.name}\n\n${item.ocrText}` });
      }
    }
    const response = await this.fetcher(`${endpoint}/${model}:streamGenerateContent?alt=sse`, {
      method: "POST", headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ contents: [...history, user] }), signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok || !response.body) throw new Error(`Gemini request failed (${response.status}). Check model access and input support.`);
    const parts: GeminiPart[] = [];
    let finishReason = "";
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? "";
      for (const event of events) {
        const json = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!json) continue;
        const result = JSON.parse(json) as { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string }; error?: { message?: string } };
        if (result.error) throw new Error("Gemini returned an error during streaming.");
        if (result.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt (${result.promptFeedback.blockReason}).`);
        const candidate = result.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        for (const part of candidate?.content?.parts ?? []) {
          parts.push(part);
          if (part.text && !part.thought) onDelta(part.text);
        }
      }
    }
    if (buffer.trim()) throw new Error("Gemini returned an incomplete stream.");
    if (finishReason !== "STOP") throw new Error(`Gemini did not complete the response${finishReason ? ` (${finishReason})` : ""}.`);
    if (!parts.some((part) => part.text && !part.thought)) throw new Error("Gemini returned no text.");
    return [...history, user, { role: "model", parts }];
  }
}
