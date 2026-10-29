import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export type RpcMessage = { id?: string | number; method?: string; params?: any; result?: any; error?: { message: string } };

type Pending = { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout };

export class CodexRpc {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  onEvent: (message: RpcMessage) => void = () => {};
  onDisconnect: (reason: string) => void = () => {};

  connect() {
    if (!this.ready) this.ready = this.initialize().catch((error) => { this.close(); throw error; });
    return this.ready;
  }

  request(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex did not answer ${method}.`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  respond(id: string | number, result: unknown) { this.write({ id, result }); }
  reject(id: string | number, message: string) { this.write({ id, error: { code: -32601, message } }); }

  close() {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    child?.kill();
    this.fail("Codex disconnected.");
  }

  private async initialize() {
    const child = spawn("codex", ["app-server", "--stdio"], { windowsHide: true, stdio: "pipe" });
    this.child = child;
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => this.disconnected(child, "The Codex connection closed."));
    child.on("error", () => this.disconnected(child, "Codex CLI could not start. Install Codex and sign in."));
    child.on("exit", () => this.disconnected(child, "Codex disconnected."));
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => this.receive(line));
    await this.request("initialize", { clientInfo: { name: "codeit", title: "Codeit", version: "0.1.0" } });
    this.write({ method: "initialized", params: {} });
  }

  private receive(line: string) {
    let message: RpcMessage;
    try { message = JSON.parse(line); } catch { return; }
    if (!message.method && typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    } else if (message.method) this.onEvent(message);
  }

  private write(value: unknown) {
    if (!this.child?.stdin.writable) throw new Error("Codex is not connected.");
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private disconnected(child: ChildProcessWithoutNullStreams, reason: string) {
    if (this.child !== child) return;
    this.child = undefined;
    this.ready = undefined;
    this.fail(reason);
    this.onDisconnect(reason);
  }

  private fail(reason: string) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)); }
    this.pending.clear();
  }
}
