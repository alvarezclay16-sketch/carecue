// The public demo: clock policy, spend guard on the demo routes, sandbox households (create, isolation, expiry,
// purge), scenarios, the shared playground and alert delivery. Starts its own PUBLIC server (fake agent, temp DB,
// no model credentials, no clock control) and a tiny webhook listener.
//   node tests/demo-guard.ts [server-port] [webhook-port]      defaults 8853 and 8854
// Needs `node` on PATH. Nothing here calls a model.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = Number(process.argv[2] ?? 8853);
const HOOK_PORT = Number(process.argv[3] ?? 8854);
const base = `http://127.0.0.1:${PORT}`;
const root = path.join(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(tmpdir(), "carecue-demo-guard-"));
const dbFile = path.join(tmp, "t.db");
const KEY = "recorder-key-for-this-test";

// ---------- webhook listener: a positive control for "alerts leave the server" ----------
const hooks: string[] = [];
const hookServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    hooks.push(body);
    res.end("ok");
  });
}).listen(HOOK_PORT, "127.0.0.1");

// ---------- the public server ----------
const env: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  PORT: String(PORT),
  CARECUE_DB: dbFile,
  CARECUE_DATA_DIR: tmp,
  ALEXA_SKIP_VERIFY: "1",
  CARECUE_PUBLIC: "1",
  CARECUE_FAKE_AGENT: "1",
  CARECUE_RECORDER_KEY: KEY,
  CARECUE_ALERT_WEBHOOK: `http://127.0.0.1:${HOOK_PORT}/hook`,
  CARECUE_LIMIT_IP_DAY: "100",
  CARECUE_LIMIT_IP_BURST: "3",
  CARECUE_LIMIT_URGENT_IP_DAY: "5",
  CARECUE_LIMIT_CREATE_IP_HOUR: "4",
  CARECUE_SANDBOX_IP_HOUR: "3",
  CARECUE_SANDBOX_TTL_S: "6",
  CARECUE_SANDBOX_SWEEP_S: "1",
  CARECUE_AUTORESET_MIN: "0.05",
};
const child = spawn(process.execPath, ["src/server.ts"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
const done = (code: number) => {
  child.kill();
  hookServer.close();
  rmSync(tmp, { recursive: true, force: true });
  process.exit(code);
};
process.on("uncaughtException", (e) => {
  console.error(e);
  console.error("--- server log ---\n" + log.split("\n").slice(-25).join("\n"));
  done(1);
});
process.on("unhandledRejection", (e) => {
  console.error(e);
  console.error("--- server log ---\n" + log.split("\n").slice(-25).join("\n"));
  done(1);
});

for (let i = 0; i < 100; i++) {
  if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}

// ---------- helpers ----------
let n = 0;
const newIp = () => `10.20.${Math.floor(n++ / 250)}.${(n % 250) + 1}`;
type J = Record<string, any>;
async function call(p: string, o: { ip?: string; body?: unknown; sb?: string; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? newIp(), ...(o.sb ? { "x-carecue-sandbox": o.sb } : {}), ...(o.headers ?? {}) };
  const r = await fetch(base + p, { method: o.method ?? (o.body === undefined ? "GET" : "POST"), headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await r.text();
  let json: J = {};
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, headers: r.headers };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (m: string) => console.log("ok:", m);
const sqlite = () => new DatabaseSync(dbFile, { readOnly: true });
const TABLES = ["alerts", "doses", "checkins", "medications", "caregivers", "links", "pair_codes", "alexa_reminders"] as const;
const rowsFor = (pid: number) => {
  const db = sqlite();
  try {
    const counts: Record<string, number> = {};
    for (const t of TABLES) counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE patient_id = ?`).get(pid) as { n: number }).n;
    counts.patients = (db.prepare("SELECT COUNT(*) AS n FROM patients WHERE id = ?").get(pid) as { n: number }).n;
    counts.sandboxes = (db.prepare("SELECT COUNT(*) AS n FROM sandboxes WHERE patient_id = ?").get(pid) as { n: number }).n;
    return counts;
  } finally {
    db.close();
  }
};
const pidOfSandbox = (id: string) => {
  const db = sqlite();
  try {
    return (db.prepare("SELECT patient_id FROM sandboxes WHERE id = ?").get(id) as { patient_id: number } | undefined)?.patient_id;
  } finally {
    db.close();
  }
};
const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
async function newSandbox(scenario?: string, ip = newIp()) {
  const r = await call("/api/sandbox", { ip, body: scenario ? { scenario } : {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json as { sandbox_id: string; utterance: string | null; lang: string; replay: boolean };
}

// ---------- clock policy ----------
{
  let r = await call("/api/clock", { body: { time: "08:00" } });
  assert.equal(r.status, 403, "POST /api/clock is 403 on the public instance");
  r = await call("/api/clock", { body: { reset: true } });
  assert.equal(r.status, 403);
  r = await call("/api/reset", { body: {} });
  assert.equal(r.status, 403, "resetting the shared demo is a local-only action");
  const st = await call("/api/state");
  assert.equal(st.json.device.clock_control, false);
  assert.equal(st.json.clock.shifted, false);
  ok("clock: 403 on /api/clock and /api/reset, device.clock_control false, clock not shifted");
}

// ---------- spend guard on the demo routes ----------
{
  const ip = newIp();
  const chat = (text: string, extra: Record<string, string> = {}) => call("/api/chat", { ip, body: { text, conversationId: "t" }, headers: extra });
  for (let i = 0; i < 3; i++) assert.equal((await chat("What is next?")).json.reply, "[fake agent] ok");
  const over = await chat("What is next?");
  assert.equal(over.json.limited, true);
  assert.deepEqual(over.json.toolCalls, []);
  assert.equal(over.json.scene, null);
  const emerg = await chat("I have a pain in my chest");
  assert.equal(emerg.json.reply, "[fake agent] ok", "an emergency is still answered by the agent");
  assert.equal(emerg.json.limited, undefined);
  for (let i = 0; i < 6; i++) assert.equal((await chat("hello", { "x-carecue-recorder": KEY })).json.reply, "[fake agent] ok", "the recorder key is never limited");
  const lim = await call("/api/limits", { ip });
  assert.equal(lim.json.enabled, true);
  ok("limiter: burst of 3 then limited:true, emergency still served, recorder key never limited");
}

// ---------- household creation and sandbox creation throttles ----------
{
  const ip = newIp();
  for (let i = 0; i < 4; i++) assert.equal((await call("/api/app/households", { ip, body: { patientName: "P", caregiverName: "C" } })).status, 200);
  const r = await call("/api/app/households", { ip, body: { patientName: "P", caregiverName: "C" } });
  assert.equal(r.status, 429);
  const ip2 = newIp();
  for (let i = 0; i < 3; i++) await newSandbox(undefined, ip2);
  const s = await call("/api/sandbox", { ip: ip2, body: {} });
  assert.equal(s.status, 429, "the 4th sandbox in an hour from one address is refused");
  assert.ok(Number(s.headers.get("retry-after")) > 0);
  ok("household creation 429 after 4/hour; sandbox creation 429 after 3/hour");
}

// ---------- scenarios: deterministic states ----------
const sbA = await newSandbox("morning");
const sbB = await newSandbox("morning");
{
  const st = (id: string) => call("/api/state", { sb: id }).then((r) => r.json);
  const a0 = await st(sbA.sandbox_id);
  assert.equal(a0.scene.kind, "reminder");
  assert.equal(a0.alerts.length, 0);
  assert.equal(a0.today.due_now.length, 2);
  assert.equal(a0.clock.shifted, false, "the global clock offset stays 0");
  assert.equal(a0.timezone, "America/Santiago");

  const run = (id: string, sb: string) => call(`/api/scenario/${id}`, { sb, body: {} }).then((r) => r.json);
  assert.equal((await run("hedged", sbA.sandbox_id)).utterance, "I think I took it, maybe.");
  assert.equal((await st(sbA.sandbox_id)).today.due_now.length, 2);
  assert.equal((await run("took", sbA.sandbox_id)).utterance, null);
  const ex = await run("extra", sbA.sandbox_id);
  assert.equal(ex.utterance, "I'll take another one, just in case.");
  let s = await st(sbA.sandbox_id);
  assert.equal(s.today.done_today.length, 2);
  assert.equal(s.today.due_now.length, 0);
  // The chip then sends the utterance through chat: the scene is computed from the log (nothing was logged this turn).
  const chat = await call("/api/chat", { sb: sbA.sandbox_id, body: { text: ex.utterance } });
  assert.equal(chat.json.scene.kind, "stop");
  assert.deepEqual(chat.json.scene.medications.map((m: { name: string }) => m.name).sort(), ["Losartan", "Metformin"]);
  assert.equal(chat.json.ttl_s, 15);
  assert.equal((await st(sbA.sandbox_id)).today.done_today.length, 2, "the extra chip leaves the dose log unchanged");
  const chest = await run("chest", sbA.sandbox_id);
  assert.equal(chest.utterance, "I don't feel good. I have a pain in my chest.");
  const spanish = await run("spanish", sbA.sandbox_id);
  assert.equal(spanish.lang, "es");
  s = await st(sbA.sandbox_id);
  assert.equal(s.device.language, "es");
  assert.equal((await call("/api/scenario/nope", { sb: sbA.sandbox_id, body: {} })).status, 404);
  assert.equal((await call("/api/scenario/extra", { body: {} })).status, 403, "scenarios on the shared demo need a sandbox");
  ok("scenarios: morning/hedged/took/extra/chest/spanish set their state; the extra chip shows STOP and leaves the log unchanged");
}

// ---------- isolation: two sandboxes at the same time ----------
{
  const st = (id: string) => call("/api/state", { sb: id }).then((r) => r.json);
  const [ex, mi] = await Promise.all([
    call("/api/scenario/extra", { sb: sbA.sandbox_id, body: {} }).then((r) => r.json),
    call("/api/scenario/missed", { sb: sbB.sandbox_id, body: {} }).then((r) => r.json),
  ]);
  assert.ok(ex.utterance);
  const a = await st(sbA.sandbox_id);
  const b = await st(sbB.sandbox_id);
  assert.equal(a.alerts.length, 0, "A has no alerts");
  assert.equal(a.today.done_today.length, 2);
  if (!mi.replay) {
    assert.ok(b.alerts.some((x: { kind: string }) => x.kind === "missed_dose"), "B has the missed-dose alert");
    assert.equal(b.today.done_today.length, 0);
    assert.equal(b.scene.kind, "late");
    const evA = await call("/api/events?since=0", { sb: sbA.sandbox_id });
    const evB = await call("/api/events?since=0", { sb: sbB.sandbox_id });
    assert.ok(evB.json.some((e: { kind: string }) => e.kind === "alert"));
    assert.ok(!evA.json.some((e: { kind: string }) => e.kind === "alert"), "A never sees B's events");
    assert.deepEqual(evA.json.map((e: any) => e.patient_id).filter((p: number) => p !== pidOfSandbox(sbA.sandbox_id)), []);
  } else assert.ok(nowMin() < 55, "replay only at the midnight edge");
  // one chat each: conversations and scenes are per sandbox, never a 409 or busy
  const [ca, cb] = await Promise.all([
    call("/api/chat", { sb: sbA.sandbox_id, body: { text: "I'll take another one, just in case." } }),
    call("/api/chat", { sb: sbB.sandbox_id, body: { text: "I'll take another one, just in case." } }),
  ]);
  assert.equal(ca.status, 200);
  assert.equal(cb.status, 200);
  assert.equal(ca.json.scene.kind, "stop", "A took both: STOP");
  assert.equal(cb.json.scene.kind, "check_first", "B took nothing: check first");
  ok("isolation: extra on A and missed on B at once; no shared state, alerts, events or scenes; no 409");
}

// ---------- weekly history ----------
{
  const w = await call("/api/week", { sb: sbA.sandbox_id });
  assert.equal(w.json.label, "Sample history (demo)");
  assert.ok(w.json.callouts.includes("Evening Metformin: confirmed late 4 of the last 7 days"));
  assert.equal(w.json.window.today, new Date().toLocaleDateString("en-CA"));
  assert.ok(w.json.callouts.every((c: string) => !/should|recommend|poor|advice|consider|worry/i.test(c)));
  // a real household never has seeded history
  const h = await call("/api/app/households", { body: { patientName: "Real", caregiverName: "Pat" } });
  const pid = h.json.patient_id as number;
  const db = sqlite();
  try {
    const past = db.prepare("SELECT COUNT(*) AS n FROM doses WHERE patient_id = ? AND date < ?").get(pid, new Date().toLocaleDateString("en-CA")) as { n: number };
    assert.equal(past.n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM checkins WHERE patient_id = ?").get(pid) as { n: number }).n, 0);
  } finally {
    db.close();
  }
  ok("history: labelled, counts only, absent from real households");
}

// ---------- alerts of sandboxes never leave the server ----------
{
  // The shared demo household raises its own alerts as the real clock passes (missed doses, refill): let those settle first.
  let last = hooks.length;
  let since = Date.now();
  while (Date.now() - since < 6000) {
    await sleep(250);
    if (hooks.length !== last) {
      last = hooks.length;
      since = Date.now();
    }
  }
  const before = hooks.length;
  const missed = await newSandbox("missed");
  assert.ok(missed.sandbox_id);
  await sleep(5500); // longer than one background tick
  assert.equal(hooks.length, before, "a sandbox's alerts (missed dose) never reach the webhook");
  // positive control: an alert on the shared playground does
  const c = new Client({ name: "demo-guard", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { "x-forwarded-for": newIp() } } }));
  const r = await c.callTool({ name: "notify_caregiver", arguments: { message: "Rosa says she feels dizzy.", severity: "warning", kind: "wellbeing" } });
  assert.equal(JSON.parse((r.content as Array<{ text: string }>)[0].text).ok, true);
  await c.close();
  for (let i = 0; i < 30 && hooks.length === before; i++) await sleep(100);
  assert.equal(hooks.length, before + 1, "the shared playground's alert is delivered (positive control)");
  ok("delivery: sandbox alerts stay on the server; the playground's alert reaches the webhook");
}

// ---------- the shared playground resets itself when dirty and idle ----------
{
  const demoPid = () => {
    const db = sqlite();
    try {
      return (db.prepare("SELECT id FROM patients WHERE is_demo = 1").get() as { id: number }).id;
    } finally {
      db.close();
    }
  };
  const wellbeing = (pid: number) => {
    const db = sqlite();
    try {
      return (db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE patient_id = ? AND kind = 'wellbeing'").get(pid) as { n: number }).n;
    } finally {
      db.close();
    }
  };
  const first = demoPid();
  assert.equal(wellbeing(first), 1, "the anonymous MCP client left an alert: the playground is dirty");
  // idle (autoreset 3 s, sweep 1 s); we read the database file, not the API, so we do not count as activity
  let reset = false;
  for (let i = 0; i < 80 && !reset; i++) {
    await sleep(500);
    reset = demoPid() !== first;
  }
  assert.ok(reset, "the dirty, idle playground was re-seeded within 40 s");
  const second = demoPid();
  assert.equal(wellbeing(second), 0);
  await sleep(6000);
  assert.equal(demoPid(), second, "a clean playground is not reset again");
  ok("playground: dirty + idle -> re-seeded; clean -> left alone");
}

// ---------- expiry and purge ----------
{
  const sbC = await newSandbox("extra");
  const idC = sbC.sandbox_id;
  const pidC = pidOfSandbox(idC)!;
  const live = rowsFor(pidC);
  assert.ok(live.doses > 0 && live.medications === 3 && live.caregivers === 1 && live.links === 1, JSON.stringify(live));
  // activity keeps a sandbox alive: poll for 3 s, then stop and let the 6 s TTL pass (the watchdog runs every second)
  for (let i = 0; i < 6; i++) {
    assert.equal((await call("/api/state", { sb: idC })).status, 200);
    await sleep(500);
  }
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    await sleep(500);
    gone = pidOfSandbox(idC) === undefined;
  }
  assert.ok(gone, "an idle sandbox expires");
  const r = await call("/api/state", { sb: idC });
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: "sandbox_expired" });
  assert.equal((await call("/api/chat", { sb: idC, body: { text: "hello" } })).status, 404);
  assert.equal((await call("/api/device/touch", { sb: idC, body: { action: "took" } })).status, 404);
  assert.equal((await call("/api/probe", { sb: idC, body: { id: "hedged_log" } })).status, 404);
  assert.equal((await call("/api/state", { sb: "not a valid id" })).status, 404);
  assert.deepEqual(Object.values(rowsFor(pidC)).filter((x) => x), [], `no rows left for the purged sandbox: ${JSON.stringify(rowsFor(pidC))}`);
  // the earlier sandboxes went the same way
  for (const id of [sbA.sandbox_id, sbB.sandbox_id]) assert.equal((await call("/api/state", { sb: id })).status, 404);
  const sweep = sqlite();
  try {
    const orphans = sweep.prepare("SELECT COUNT(*) AS n FROM doses WHERE patient_id NOT IN (SELECT id FROM patients)").get() as { n: number };
    assert.equal(orphans.n, 0);
  } finally {
    sweep.close();
  }
  // the browser then silently creates a new one
  const fresh = await newSandbox("morning");
  assert.equal((await call("/api/state", { sb: fresh.sandbox_id })).json.scene.kind, "reminder");
  ok("expiry: idle sandboxes answer 404 sandbox_expired and leave no rows in any table; a new one starts clean");
}

console.log("\nDEMO GUARD PASSED");
done(0);
