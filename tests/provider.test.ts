import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GeminiClient } from "../api/src/gemini.js";
import { Chat } from "../api/src/chat.js";
import { Store } from "../api/src/store.js";
import { codexDiscoveryReason } from "../api/src/providers.js";

test("Codex discovery errors are actionable without exposing provider details", () => {
  assert.match(codexDiscoveryReason(new Error("Codex CLI could not start. Install Codex and sign in.")), /PATH/);
  assert.match(codexDiscoveryReason(new Error("Codex did not answer model\/list.")), /did not answer/);
  assert.doesNotMatch(codexDiscoveryReason(new Error("secret-test-value")), /secret-test-value/);
});

const model = "models/gemini-mock";
const encoder = new TextEncoder();
function service(chunks: string[], status = 200) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/models?")) return Response.json({ models: [{ name: model, displayName: "Mock", supportedGenerationMethods: ["generateContent"] }] });
    if (status !== 200) return new Response("failure", { status });
    return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }));
  };
  return { fetcher, calls };
}
const complete = ["data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello \"}]}}]}\n\n", "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"world\"}]},\"finishReason\":\"STOP\"}]}\n\n"];
const input = { text: "  raw prompt\n", selection: { provider: "gemini" as const, model }, attachments: [
  { kind: "text" as const, name: "sample.ts", content: "const x = 1" },
  { kind: "image" as const, name: "sample.png", content: "data:image/png;base64,YWJj", ocrText: "visible text" },
] };

test("Gemini streams, preserves inputs and continues after a stored turn", async () => {
  const mock = service(complete);
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const directory = mkdtempSync(join(tmpdir(), "codeit-gemini-test-"));
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = mock.fetcher;
  try {
    const store = new Store(directory);
    const record = store.chat(store.projects()[0].chats[0].id)!;
    const chat = new Chat(store, record);
    await chat.send(input);
    assert.equal(chat.provider(), "gemini");
    assert.equal(record.events.filter((item) => item.type === "delta").map((item) => item.delta).join(""), "Hello world");
    const reopened = new Store(directory);
    const saved = reopened.chat(record.id)!;
    assert.equal(saved.geminiHistory?.[0].parts[0].text, input.text);
    assert.equal(saved.geminiHistory?.[0].parts[2].inlineData?.data, "YWJj");
    await assert.rejects(new Chat(reopened, saved).send({ ...input, selection: { provider: "codex", model: "test" } }), /Create another chat/);
    await new Chat(reopened, saved).send({ ...input, text: "follow up", attachments: [] });
    const sent = mock.calls.filter((call) => call.url.includes(":streamGenerateContent"));
    assert.equal(JSON.parse(String(sent[1].options?.body)).contents.length, 3);
    assert.equal((sent[0].options?.headers as Record<string, string>)["x-goog-api-key"], "test-key");
    assert(!sent[0].url.includes("test-key"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Gemini rejects failed and interrupted responses", async () => {
  const interrupted = new GeminiClient("test-key", service([complete[0]]).fetcher);
  await assert.rejects(interrupted.stream(model, [], input, () => {}), /did not complete/);
  const failed = new GeminiClient("test-key", service([], 403).fetcher);
  await assert.rejects(failed.stream(model, [], input, () => {}), /request failed \(403\)/);
  await assert.rejects(interrupted.stream("models/unknown", [], input, () => {}), /unavailable/);
  await assert.rejects(interrupted.stream(model, [], { ...input, selection: { ...input.selection, effort: "high" } }, () => {}), /reasoning/);
});
