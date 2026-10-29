import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

test("takeover targets listeners, preserves siblings and serializes startup", { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "codeit-takeover-test-"));
  const ports = []; const processes = []; const foreignProcesses = [];
  try {
    while (ports.length < 4) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
    await mkdir(join(dir, "tools"));
    const source = await readFile(new URL("./preflight.mjs", import.meta.url), "utf8");
    const fixture = source.replaceAll("9030", String(ports[0])).replaceAll("9020", String(ports[1])).replaceAll("9031", String(ports[2])).replaceAll("9032", String(ports[3]))
      .replace('["--import", "tsx", "api/src/server.ts"]', '["tools/service.mjs", "api"]')
      .replace('["tools/vite-runner.mjs", "--config", "web/vite.config.ts", "--host", "127.0.0.1", "--port", "' + ports[1] + '", "--strictPort"]', '["tools/service.mjs", "web"]');
    await writeFile(join(dir, "tools", "preflight.mjs"), fixture);
    await writeFile(join(dir, "tools", "config.mjs"), await readFile(new URL("./config.mjs", import.meta.url)));
    await writeFile(join(dir, "tools", "service.mjs"), `import {createServer} from 'node:net'; const server=createServer(); server.listen(process.argv[2]==='api'?${ports[0]}:${ports[1]},'127.0.0.1'); process.on('message',()=>server.close(()=>process.exit())); process.on('disconnect',()=>server.close(()=>process.exit()));`);
    const env = { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir };
    delete env.CODEIT_API_PORT; delete env.CODEIT_WEB_PORT; delete env.CODEIT_DATA_DIR;
    const runMode = (mode) => { const result = run(dir, env, mode); processes.push(result); return result; };

    const api = runMode("api"); const web = runMode("web");
    try { await waitUntil(async () => (await Promise.all(ports.slice(0, 2).map(isBusy))).every(Boolean)); }
    catch (error) { throw new Error(`${error.message}; api: ${api.output()}; web: ${web.output()}`); }
    const replacement = runMode("web");
    assert.equal((await web.done).code, 0);
    await waitUntil(async () => (await isBusy(ports[1])) && replacement.output().includes("Codeit starting"));
    assert.equal(await isBusy(ports[0]), true);
    assert.equal((await stop(dir, env)).code, 0);
    assert.equal((await api.done).code, 0); assert.equal((await replacement.done).code, 0);

    const combined = runMode();
    try { await waitUntil(async () => (await Promise.all(ports.slice(0, 2).map(isBusy))).every(Boolean)); }
    catch (error) { throw new Error(`${error.message}; combined: ${combined.output()}`); }
    const fixtureKey = createHash("sha256").update(dir.toLowerCase()).digest("hex").slice(0, 16);
    const controlRecord = join(dir, `codeit-${fixtureKey}-api.json`);
    const savedRecord = await readFile(controlRecord, "utf8");
    await writeFile(controlRecord, JSON.stringify({ pid: -1, token: "stale", port: ports[2] }));
    const blocked = await runMode("api").done;
    assert.equal(blocked.code, 1); assert.match(blocked.output, /shared listener owns both control ports/);
    assert.equal(await isBusy(ports[1]), true);
    await writeFile(controlRecord, savedRecord);
    const newCombined = runMode();
    assert.equal((await combined.done).code, 0);
    await waitUntil(async () => (await Promise.all(ports.slice(0, 2).map(isBusy))).every(Boolean) && newCombined.output().includes("Codeit starting"));
    assert.equal((await stop(dir, env)).code, 0); assert.equal((await newCombined.done).code, 0);

    for (const port of ports) {
      const foreign = spawn(process.execPath, ["-e", `require('net').createServer().listen(${port},'127.0.0.1');`], { stdio: "ignore" });
      foreignProcesses.push(foreign);
      const ended = new Promise((resolve) => foreign.once("exit", resolve));
      await waitUntil(() => isBusy(port));
      const service = runMode(port === ports[0] || port === ports[2] ? "api" : "web");
      await ended;
      await waitUntil(() => service.output().includes("Codeit starting"));
      assert.match(service.output(), new RegExp(`PID ${foreign.pid} on port ${port}`));
      assert.equal((await stop(dir, env)).code, 0); assert.equal((await service.done).code, 0);
    }

    if (process.platform === "win32") {
      const wildcard = spawn(process.execPath, ["-e", `require('net').createServer().listen(${ports[0]},'0.0.0.0');`], { stdio: "ignore" });
      const wildcardEnded = new Promise((resolve) => wildcard.once("exit", resolve)); foreignProcesses.push(wildcard);
      await waitUntil(() => listening(wildcard.pid, ports[0]));
      const local = spawn(process.execPath, ["-e", `require('net').createServer().listen(${ports[0]},'127.0.0.1');`], { stdio: "ignore" });
      const localEnded = new Promise((resolve) => local.once("exit", resolve)); foreignProcesses.push(local);
      await waitUntil(() => listening(local.pid, ports[0]));
      assert.equal(local.exitCode, null);
      const service = runMode("api");
      await Promise.all([wildcardEnded, localEnded]);
      await waitUntil(() => service.output().includes("Codeit starting"));
      assert.match(service.output(), new RegExp(`PID ${wildcard.pid} on port ${ports[0]}`));
      assert.match(service.output(), new RegExp(`PID ${local.pid} on port ${ports[0]}`));
      assert.equal((await stop(dir, env)).code, 0); assert.equal((await service.done).code, 0);

      const dual = spawn(process.execPath, ["-e", `require('net').createServer().listen(${ports[0]},'::');`], { stdio: "ignore" });
      const dualEnded = new Promise((resolve) => dual.once("exit", resolve)); foreignProcesses.push(dual);
      await waitUntil(() => listening(dual.pid, ports[0]));
      const dualTakeover = runMode("api");
      await dualEnded;
      await waitUntil(() => dualTakeover.output().includes("Codeit starting"));
      assert.match(dualTakeover.output(), new RegExp(`PID ${dual.pid} on port ${ports[0]}`));
      assert.equal((await stop(dir, env)).code, 0); assert.equal((await dualTakeover.done).code, 0);
    }

    const other = spawn(process.execPath, ["-e", `require('net').createServer().listen(${ports[0]},'127.0.0.2');`], { stdio: "ignore" });
    const loopback = spawn(process.execPath, ["-e", `require('net').createServer().listen(${ports[0]},'127.0.0.1');`], { stdio: "ignore" });
    foreignProcesses.push(other, loopback);
    const loopbackEnded = new Promise((resolve) => loopback.once("exit", resolve));
    await waitUntil(() => isBusy(ports[0]));
    const registryKey = createHash("sha256").update(dir.toLowerCase()).digest("hex").slice(0, 16);
    await writeFile(join(dir, `codeit-${registryKey}-api.json`), JSON.stringify({ pid: other.pid, port: ports[2], token: "stale" }));
    const takeover = runMode("api");
    await loopbackEnded;
    await waitUntil(() => takeover.output().includes("Codeit starting"));
    assert.equal(other.exitCode, null);
    assert.match(takeover.output(), new RegExp(`PID ${loopback.pid} on port ${ports[0]}`));
    assert.equal((await stop(dir, env)).code, 0); assert.equal((await takeover.done).code, 0);
    other.kill();

    const first = runMode(); const second = runMode();
    const finished = await Promise.race([first.done, second.done]);
    assert.equal(finished.code, 0);
    try { await waitUntil(async () => (await Promise.all(ports.slice(0, 2).map(isBusy))).every(Boolean)); }
    catch (error) { throw new Error(`${error.message}; first: ${first.output()}; second: ${second.output()}`); }
    assert.equal((await stop(dir, env)).code, 0);
    assert.deepEqual((await Promise.all([first.done, second.done])).map((item) => item.code), [0, 0]);
    const records = (await readdir(dir)).filter((name) => /^codeit-.*-(api|web)\.json$/.test(name));
    assert.deepEqual(records, []);
  } finally {
    for (const child of foreignProcesses) if (child.exitCode === null && child.signalCode === null) child.kill();
    for (const process of processes) if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill();
    await Promise.all(processes.map((process) => process.done));
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

function run(dir, env, arg) {
  const child = spawn(process.execPath, [join(dir, "tools", "preflight.mjs"), ...(arg ? [arg] : [])], { cwd: dir, env });
  let output = "";
  child.stdout.on("data", (data) => output += data); child.stderr.on("data", (data) => output += data);
  return { child, output: () => output, done: new Promise((resolve) => child.on("exit", (code) => resolve({ code, output }))) };
}
function stop(dir, env) { return run(dir, env, "stop").done; }
function freePort() { return new Promise((resolve, reject) => { const server = createServer(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
function isBusy(port) { return new Promise((resolve) => { const server = createServer(); server.once("error", () => resolve(true)); server.listen(port, "127.0.0.1", () => server.close(() => resolve(false))); }); }
function listening(pid, port) { return execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" }).split(/\r?\n/).some((line) => { const parts = line.trim().split(/\s+/); return parts[1]?.endsWith(`:${port}`) && parts[3] === "LISTENING" && Number(parts[4]) === pid; }); }
async function waitUntil(predicate) { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error("Timed out waiting for fixture"); }
