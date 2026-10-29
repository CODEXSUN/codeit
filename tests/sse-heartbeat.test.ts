import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { startHeartbeat } from "../api/src/sse-heartbeat.js";

test("SSE heartbeat sends valid events and stops when the stream closes", async () => {
  let responseClosed = false;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.once("close", () => { responseClosed = true; });
    startHeartbeat(response, 10);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const request = get(`http://127.0.0.1:${address.port}/`);
  try {
    const [response] = await once(request, "response");
    const [chunk] = await once(response, "data");
    assert.equal(String(chunk), 'data: {"type":"heartbeat"}\n\n');
    response.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(responseClosed, true);
  } finally { request.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
