// The eval hooks must be closed to everyone but a direct local caller on a CARECUE_EVAL=1 server: node tests/safety/hooks.ts
// Starts two throwaway servers (no model, temp databases) and checks the hooks, GET /api/safety, and the runner's lack of --base.

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const free = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

const procs: ChildProcess[] = [];
process.on("exit", () => procs.forEach((p) => p.kill("SIGKILL")));

async function start(env: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "carecue-hooks-"));
  const port = await free();
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("CARECUE_")) clean[k] = v;
  const proc = spawn(process.execPath, ["src/server.ts"], {
    cwd: ROOT,
    env: { ...clean, PORT: String(port), HOST: "127.0.0.1", CARECUE_DB: path.join(dir, "t.db"), CARECUE_DATA_DIR: dir, CARECUE_FAKE_AGENT: "1", CARECUE_DEMO: "0", ALEXA_SKIP_VERIFY: "1", ...env },
    stdio: "ignore",
  });
  procs.push(proc);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/health")).ok) return { base, dir };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start");
}

const post = (url: string, headers: Record<string, string> = {}, body: unknown = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

// --- a CARECUE_EVAL=1 server
const dir = mkdtempSync(path.join(tmpdir(), "carecue-safety-results-"));
const results = path.join(dir, "r.json");
writeFileSync(results, JSON.stringify({ headline: { n: 3 }, probe: true }));
const ev = await start({ CARECUE_EVAL: "1", CARECUE_SAFETY_RESULTS: results });
assert.equal((await post(ev.base + "/api/eval/tick")).status, 200, "direct loopback caller may tick");
assert.equal((await post(ev.base + "/api/eval/clock", {}, { time: "11:00" })).status, 200, "direct loopback caller may set the clock");
assert.equal((await post(ev.base + "/api/eval/tick", { "x-forwarded-for": "203.0.113.9" })).status, 403, "x-forwarded-for means it came through the proxy: 403");
assert.equal((await post(ev.base + "/api/eval/clock", { "x-forwarded-for": "127.0.0.1" }, { time: "11:00" })).status, 403, "a forged loopback x-forwarded-for is still 403");
const s = await fetch(ev.base + "/api/safety");
assert.equal(s.status, 200);
assert.deepEqual(await s.json(), { headline: { n: 3 }, probe: true }, "GET /api/safety serves the results file");

// --- a normal server (no CARECUE_EVAL)
const plain = await start({ CARECUE_SAFETY_RESULTS: path.join(dir, "missing.json") });
assert.equal((await post(plain.base + "/api/eval/tick")).status, 403, "eval hooks are off without CARECUE_EVAL");
assert.equal((await post(plain.base + "/api/eval/clock", {}, { time: "11:00" })).status, 403);
assert.equal((await fetch(plain.base + "/api/safety")).status, 404, "no results file: 404, not a crash");
// bare mode is ignored without CARECUE_EVAL (the flag only reaches the agent through evalHookAllowed)
const h = await (await post(plain.base + "/api/app/households", {}, { patientName: "A", caregiverName: "B", language: "en" })).json();
const chat = await post(plain.base + "/api/app/chat", { authorization: `Bearer ${h.token}` }, { text: "hello", mode: "bare" });
assert.equal(chat.status, 200);

// --- the runner has no --base option
const r = spawnSync(process.execPath, ["tests/safety/run.ts", "--base", "http://example.com"], { cwd: ROOT, encoding: "utf8" });
assert.equal(r.status, 2, "run.ts --base must be refused");
assert.match(r.stderr, /no --base option/);

console.log("SAFETY HOOK CHECKS PASSED");
process.exit(0); // the exit handler stops the throwaway servers
