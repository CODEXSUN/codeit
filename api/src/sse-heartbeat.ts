import type { ServerResponse } from "node:http";

export function startHeartbeat(response: ServerResponse, intervalMs = 10_000) {
  const timer = setInterval(() => {
    if (response.destroyed || response.writableEnded) { clearInterval(timer); return; }
    if (response.writableLength === 0) response.write('data: {"type":"heartbeat"}\n\n');
  }, intervalMs);
  timer.unref();
  response.once("close", () => clearInterval(timer));
}
