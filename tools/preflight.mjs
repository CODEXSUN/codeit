#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "./config.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const registryKey = createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 16);
const registry = (service) => join(tmpdir(), `codeit-${registryKey}-${service.name}.json`);
const services = [
  { name: "api", port: 9030, controlPort: 9031, args: ["--import", "tsx", "api/src/server.ts"] },
  { name: "web", port: 9020, controlPort: 9032, args: ["tools/vite-runner.mjs", "--config", "web/vite.config.ts", "--host", "127.0.0.1", "--port", "9020", "--strictPort"] }
];
const children = [];
const controls = [];
let stopping = false;
let ready = false;
let token;
const args = process.argv.slice(2);
const mode = args[0] ?? "all";
const selected = services.filter((service) => mode === "all" || service.name === mode);

if (mode === "stop" && args.length === 1) {
  await requestStop();
} else if (args.length > 1 || !["all", "api", "web"].includes(mode)) {
  console.error("Usage: node tools/preflight.mjs [api|web|stop]");
  process.exitCode = 1;
} else {
  await start();
}

async function start() {
  try { loadConfig(); } catch (error) { console.error(`Configuration error: ${error.message}`); process.exitCode = 1; return; }
  let gate;
  try {
    gate = new DatabaseSync(join(tmpdir(), "codeit-port-takeover.sqlite"), { timeout: 30000 });
    gate.exec("BEGIN IMMEDIATE");
    await startUnderGate();
  } catch (error) {
    console.error(`Codeit startup failed: ${error.message}`); process.exitCode = 1;
    if (children.length && !stopping) await shutdown(1);
    else { if (token) await removeRegistry(); await closeControls(); }
  } finally {
    if (gate) { try { gate.exec("ROLLBACK"); } catch {} gate.close(); }
  }
}

async function startUnderGate() {
  await protectSibling();
  await gracefulOwnedStop();
  for (const service of selected) {
    await reclaimPort(service.controlPort);
    await reclaimPort(service.port);
  }
  token = randomBytes(32).toString("hex");
  for (const service of selected) {
    const control = createHttpServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/stop" || request.headers.authorization !== `Bearer ${token}`) return void response.writeHead(403).end();
      if (!ready) return void response.writeHead(503).end("Codeit is starting");
      response.writeHead(200).end("Stopping Codeit");
      void shutdown();
    });
    try { await new Promise((resolveListen, reject) => control.once("error", reject).listen(service.controlPort, "127.0.0.1", resolveListen)); }
    catch {
      console.error(`Control port ${service.controlPort} is occupied${portOwners(service.controlPort)}. Stop its owner and retry.`);
      await closeControls(); process.exitCode = 1; return;
    }
    controls.push(control);
    if (listenerPids(service.controlPort).some((pid) => pid !== process.pid)) {
      throw new Error(`Another listener appeared on control port ${service.controlPort}; retry startup.`);
    }
  }
  for (const service of selected) {
    if (!(await portAvailable(service.port))) {
      console.error(`Port ${service.port} is occupied${portOwners(service.port)}. Stop its owner and retry.`);
      await closeControls();
      process.exitCode = 1;
      return;
    }
  }
  try {
    for (const service of selected) await writeFile(registry(service), JSON.stringify({ pid: process.pid, port: service.controlPort, token, services: selected.map((item) => item.name) }), { mode: 0o600 });
  } catch (error) {
    await removeRegistry(); await closeControls();
    throw error;
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown());
  for (const service of selected) launch(service);
  ready = true;
  console.log(`Codeit starting: ${selected.map((service) => `${service.name} http://127.0.0.1:${service.port}`).join(", ")}`);
  console.log("Stop with Ctrl+C or npm run stop.");
  for (let i = 0; i < selected.length; i++) {
    const service = selected[i];
    if (!(await waitForOwnedPort(service.port, children[i]))) { await shutdown(1); return; }
  }
}

function launch(service) {
  const args = service.cwd ? [resolve(root, service.args[0]), ...service.args.slice(1)] : service.args;
  const child = spawn(process.execPath, args, {
    cwd: resolve(root, service.cwd ?? "."),
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    detached: process.platform !== "win32"
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(`${service.name} failed to start: ${error.message}`);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${service.name} exited (${signal ?? code}). Stopping Codeit.`);
    void shutdown(1);
  });
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.log("Stopping Codeit...");
  await Promise.all(children.map((child, index) => stopChild(child, selected[index])));
  await removeRegistry();
  await closeControls();
  for (const service of selected) {
    if (!(await waitForPort(service.port))) {
      console.error(`Port ${service.port} did not become available.`);
      exitCode = 1;
    }
  }
  process.exit(exitCode);
}

async function removeRegistry() {
  for (const service of selected) {
    try { const entry = JSON.parse(await readFile(registry(service), "utf8")); if (entry.token === token) await rm(registry(service), { force: true }); } catch {}
  }
}
async function closeControls() { await Promise.all(controls.map((control) => new Promise((done) => control.close(done)))); }

async function protectSibling() {
  if (selected.length !== 1) return;
  const target = selected[0];
  const sibling = services.find((service) => service !== target);
  const otherOwners = listenerPids(sibling.controlPort);
  const shared = listenerPids(target.controlPort).find((pid) => otherOwners.includes(pid));
  if (shared) throw new Error(`A shared listener owns both control ports (PID ${shared}). Use combined startup to restart both without losing the sibling service.`);
}

async function gracefulOwnedStop() {
  const attempted = new Set();
  for (const service of selected) {
    try {
      const entry = JSON.parse(await readFile(registry(service), "utf8"));
      if (entry.port !== service.controlPort || !listenerPids(service.controlPort).includes(entry.pid) || attempted.has(entry.pid)) continue;
      attempted.add(entry.pid);
      console.log(`Requesting graceful stop of PID ${entry.pid} on control port ${service.controlPort}.`);
      await fetch(`http://127.0.0.1:${service.controlPort}/stop`, { method: "POST", headers: { authorization: `Bearer ${entry.token}` }, signal: AbortSignal.timeout(3000) });
      await waitForPortBriefly(service.controlPort);
    } catch {}
  }
}

async function reclaimPort(port) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const owners = listenerPids(port);
    if (!owners.length) {
      if (await portAvailable(port)) return;
      if (await waitForPortBriefly(port)) return;
      continue;
    }
    for (const pid of owners) {
      if (pid === process.pid) throw new Error(`Port ${port} is owned by the current process.`);
      const identity = processIdentity(pid);
      if (!identity) throw new Error(`Cannot verify listener PID ${pid} on port ${port}.`);
      if (!sameListener(port, pid, identity)) continue;
      console.log(`Stopping listener PID ${pid} on port ${port}.`);
      if (process.platform === "win32") {
        try { execFileSync("taskkill", ["/PID", String(pid)], { stdio: "ignore", timeout: 3000 }); } catch {}
      } else { try { process.kill(pid, "SIGTERM"); } catch {} }
      await waitForPortBriefly(port);
      if (!sameListener(port, pid, identity)) continue;
      console.log(`Terminating listener PID ${pid} on port ${port}.`);
      if (process.platform === "win32") {
        try { execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore", timeout: 3000 }); } catch {}
      } else { try { process.kill(pid, "SIGKILL"); } catch {} }
      await waitForPortBriefly(port);
    }
  }
  if (!(await portAvailable(port))) throw new Error(`Port ${port} is still occupied${portOwners(port)}.`);
}

async function waitForPortBriefly(port) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!listenerPids(port).length && await portAvailable(port)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

async function waitForOwnedPort(port, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    const owners = listenerPids(port);
    if (owners.includes(child.pid)) {
      if (owners.some((pid) => pid !== child.pid)) { console.error(`Another listener appeared on port ${port}; retry startup.`); return false; }
      return true;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  console.error(`Service did not bind port ${port} as expected.`);
  return false;
}

async function stopChild(child, service) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (child.connected) child.send({ type: "codeit:shutdown" }, () => {});
  if (await waitForExit(child, 2000)) return;
  const identity = processIdentity(child.pid);
  if (!identity || !sameListener(service.port, child.pid, identity)) {
    console.error(`${service.name} did not exit, but its PID no longer owns port ${service.port}; it was not forcibly terminated.`);
    return;
  }
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/F"], { stdio: "ignore" }); } catch {}
  } else {
    try { process.kill(child.pid, "SIGTERM"); } catch {}
    if (await waitForExit(child, 2000)) return;
    if (sameListener(service.port, child.pid, identity)) try { process.kill(child.pid, "SIGKILL"); } catch {}
  }
  await waitForExit(child, 3000);
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => { child.off("exit", done); resolveWait(false); }, timeout);
    function done() { clearTimeout(timer); resolveWait(true); }
    child.once("exit", done);
  });
}

async function requestStop() {
  const entries = [];
  for (const service of services) {
    try { entries.push({ service, entry: JSON.parse(await readFile(registry(service), "utf8")) }); }
    catch (error) { if (error.code !== "ENOENT") { console.error(`Could not read ${service.name} control record: ${error.message}`); process.exitCode = 1; } }
  }
  if (!entries.length) { console.error("No Codeit services found for this checkout."); process.exitCode = 1; return; }
  const owners = new Map(entries.map((item) => [`${item.entry.pid}:${item.entry.token}`, item]));
  for (const { service, entry } of owners.values()) {
    try {
      if (entry.port !== service.controlPort) throw new Error("Invalid control port");
      const response = await fetch(`http://127.0.0.1:${service.controlPort}/stop`, { method: "POST", headers: { authorization: `Bearer ${entry.token}` }, signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`Control server returned ${response.status}`);
    } catch (error) { console.error(`Could not stop ${service.name}: ${error.message}`); process.exitCode = 1; }
  }
  const available = await Promise.all(entries.map(({ service }) => waitForPort(service.port)));
  if (available.some((value) => !value)) { console.error("Some Codeit ports are still occupied."); process.exitCode = 1; }
  if (!process.exitCode) console.log("Codeit stopped.");
}

function portAvailable(port) {
  return new Promise((resolveProbe) => {
    const server = createServer();
    server.once("error", () => resolveProbe(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveProbe(true)));
  });
}

async function waitForPort(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!listenerPids(port).length && await portAvailable(port)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return false;
}

function portOwners(port) {
  try {
    const pids = listenerPids(port);
    return pids.length ? ` by PID ${pids.join(", ")}` : " (owner unknown)";
  } catch { return " (owner unknown)"; }
}

function listenerPids(port) {
  if (process.platform === "win32") {
    const output = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    return [...new Set(output.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => [`127.0.0.1:${port}`, `0.0.0.0:${port}`].includes(parts[1]) && parts[3] === "LISTENING").map((parts) => Number(parts[4])).filter((pid) => Number.isInteger(pid) && pid > 0))];
  }
  try { const output = execFileSync("lsof", ["-nP", `-iTCP@127.0.0.1:${port}`, `-iTCP@0.0.0.0:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim(); return output ? [...new Set(output.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0))] : []; }
  catch { return []; }
}

function processIdentity(pid) {
  try {
    if (process.platform === "win32") return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], { encoding: "utf8", timeout: 5000 }).trim();
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 5000 }).trim();
  } catch { return ""; }
}
function sameListener(port, pid, identity) { return listenerPids(port).includes(pid) && processIdentity(pid) === identity; }


