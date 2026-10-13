// Sandbox households: every visitor of the public demo gets a private Rosa + Daniel, so nobody shares state,
// alerts or a clock. The id travels in the x-carecue-sandbox header and is the only key to that household.
// There is no virtual clock and no lease: scenarios use times relative to the real server clock.

import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { db, demoPatientId, resetDemo } from "./db.ts";
import * as care from "./care.ts";
import { createHousehold, deleteHousehold } from "./households.ts";
import { clientIp, gateCreate, limitsApply } from "./limits.ts";
import { clearLatch } from "./scene.ts";
import { applyScenario, isScenarioId, type Lang, type ScenarioId } from "./scenarios.ts";
import { resetHouseholdData } from "./sample.ts";
import { atLocal, localDate, now } from "./clock.ts";

const num = (name: string, dflt: number) => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(v) ? v : dflt;
};

export const sandboxCfg = {
  ttlS: () => num("CARECUE_SANDBOX_TTL_S", 2 * 60 * 60), // idle time before a sandbox is deleted
  sweepS: () => num("CARECUE_SANDBOX_SWEEP_S", 5 * 60), // how often the watchdog looks
  ipHour: () => num("CARECUE_SANDBOX_IP_HOUR", 8), // new sandboxes per address per hour
  max: () => num("CARECUE_SANDBOX_MAX", 150), // live sandboxes
  autoresetMin: () => num("CARECUE_AUTORESET_MIN", 30), // idle minutes before a dirty shared playground is re-seeded
};

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const created = new Map<string, number[]>(); // ip -> creation timestamps (ms)

type Row = { id: string; patient_id: number };

export type CreateResult =
  | { ok: true; sandbox_id: string; patient_id: number; lang: Lang; scenario: ScenarioId; utterance: string | null; replay: boolean }
  | { ok: false; status: 429 | 503; error: string; retry_after_s?: number };

function liveCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM sandboxes").get() as { n: number }).n;
}

/** Creates a private demo household (Rosa and her son Daniel, like the shared demo) and sets up a scenario. */
export async function createSandbox(req: Request, opts: { scenario?: string; lang?: string } = {}): Promise<CreateResult> {
  const ip = clientIp(req);
  if (limitsApply(req)) {
    const cutoff = Date.now() - 3_600_000;
    const list = (created.get(ip) ?? []).filter((t) => t > cutoff);
    created.set(ip, list);
    if (list.length >= sandboxCfg.ipHour())
      return { ok: false, status: 429, error: "Too many private demos from this address. Please try again later.", retry_after_s: Math.max(1, Math.ceil((list[0] + 3_600_000 - Date.now()) / 1000)) };
  }
  if (liveCount() >= sandboxCfg.max()) await purgeIdle(15 * 60); // make room: anything idle for 15 minutes
  if (liveCount() >= sandboxCfg.max()) return { ok: false, status: 503, error: "The live demo is full right now. Press Play Rosa's day to watch a recorded run." };
  // The shared household-creation limit is charged here, once, and only for a sandbox that is really going to be made
  // (a refusal above costs nothing). The route must not call gateCreate for sandboxes itself.
  const wait = gateCreate(req);
  if (wait) return { ok: false, status: 429, error: "Too many new demos from this address. Please try again later.", retry_after_s: wait };

  const scenario: ScenarioId = opts.scenario && isScenarioId(opts.scenario) ? opts.scenario : "morning";
  const lang: Lang = opts.lang === "es" ? "es" : "en";
  const { patientId } = createHousehold({
    patientName: "Rosa",
    language: lang,
    caregiverName: "Daniel",
    caregiverRelationship: "son",
    caregiverPhone: "+56 9 0000 0000", // same as the shared demo, so the emergency number is the Chilean one
  });
  const id = `sb_${randomBytes(12).toString("base64url")}`;
  const t = new Date().toISOString(); // real time: a shifted demo clock must not age sandboxes
  db.prepare("INSERT INTO sandboxes (id, patient_id, ip, created_at, last_seen) VALUES (?, ?, ?, ?, ?)").run(id, patientId, ip, t, t);
  created.set(ip, [...(created.get(ip) ?? []), Date.now()]);
  const outcome = await applyScenario(patientId, scenario, opts.lang === "es" ? "es" : opts.lang === "en" ? "en" : undefined);
  return { ok: true, sandbox_id: id, patient_id: patientId, lang: outcome.lang, scenario, utterance: outcome.utterance, replay: outcome.replay };
}

/** Forgets addresses whose last sandbox is older than the hourly window, so the map cannot grow without bound. Returns how many went. */
export function pruneCreated(nowMs = Date.now()): number {
  const cutoff = nowMs - 3_600_000;
  let gone = 0;
  for (const [ip, list] of created) {
    const keep = list.filter((t) => t > cutoff);
    if (keep.length && keep.length === list.length) continue;
    if (keep.length) created.set(ip, keep);
    else {
      created.delete(ip);
      gone++;
    }
  }
  return gone;
}

/** How many addresses the per-IP sandbox counter is holding (for tests). */
export const createdSize = () => created.size;

/** The household a demo call is about: the caller's sandbox, or the shared demo household when no header was sent. */
export function pidFor(req: Request): number | undefined {
  const h = req.headers["x-carecue-sandbox"];
  if (h === undefined) {
    touchPlayground();
    return demoPatientId();
  }
  const id = Array.isArray(h) ? h[0] : h;
  if (!ID.test(id)) return undefined;
  const row = db.prepare("SELECT patient_id, last_seen FROM sandboxes WHERE id = ?").get(id) as { patient_id: number; last_seen: string } | undefined;
  if (!row) return undefined;
  const t = new Date().toISOString();
  if (t.slice(0, 19) !== row.last_seen.slice(0, 19)) db.prepare("UPDATE sandboxes SET last_seen = ? WHERE id = ?").run(t, id); // polls are frequent: once a second is enough
  return row.patient_id;
}

/** The sandbox id in the request header, if it names a live sandbox. */
export function sandboxIdOf(req: Request): string | undefined {
  const h = req.headers["x-carecue-sandbox"];
  const id = Array.isArray(h) ? h[0] : h;
  return id && ID.test(id) && db.prepare("SELECT 1 FROM sandboxes WHERE id = ?").get(id) ? id : undefined;
}

/** In-memory leftovers of one household: spoken reminders, scene latch, conversations, MCP bridge. */
async function forget(patientId: number, andBridge: boolean) {
  care.clearEvents(patientId);
  clearLatch(patientId);
  const agent = await import("./agent.ts");
  if (andBridge) agent.forgetHousehold(patientId);
  else agent.forgetConversations(patientId);
}

/** "Start over" for the caller's household: back to a fresh morning, nothing carried over. */
export async function restartHousehold(patientId: number): Promise<void> {
  resetHouseholdData(patientId);
  await forget(patientId, false);
}

/** Deletes sandboxes idle for longer than `idleS` seconds. Returns how many went. */
export async function purgeIdle(idleS: number): Promise<number> {
  const cutoff = new Date(Date.now() - idleS * 1000).toISOString();
  const rows = db.prepare("SELECT id, patient_id FROM sandboxes WHERE last_seen < ?").all(cutoff) as Row[];
  for (const r of rows) {
    deleteHousehold(r.patient_id);
    await forget(r.patient_id, true).catch(() => {});
  }
  return rows.length;
}

// ---------- the shared playground (what anonymous /mcp clients and header-less calls mutate) ----------

let lastTouch = Date.now();
export function touchPlayground(): void {
  lastTouch = Date.now();
}

/** Did a visitor change the shared demo household? Only what people do counts: system reminders and missed-dose alerts do not. */
export function playgroundDirty(): boolean {
  const pid = demoPatientId();
  const today = localDate(now());
  const doses = db.prepare("SELECT 1 FROM doses WHERE patient_id = ? AND date >= ? AND status IN ('taken','skipped') LIMIT 1").get(pid, today);
  const alerts = db.prepare("SELECT 1 FROM alerts WHERE patient_id = ? AND kind NOT IN ('missed_dose','refill') LIMIT 1").get(pid);
  const checkins = db.prepare("SELECT 1 FROM checkins WHERE patient_id = ? AND created_at >= ? LIMIT 1").get(pid, atLocal(today, "00:00").toISOString());
  const units = db
    .prepare(
      `SELECT 1 FROM medications WHERE patient_id = ? AND (active = 0 OR (name = 'Metformin' AND units_on_hand <> 22)
       OR (name = 'Losartan' AND units_on_hand <> 4) OR (name = 'Atorvastatin' AND units_on_hand <> 30)) LIMIT 1`,
    )
    .get(pid);
  return !!(doses || alerts || checkins || units);
}

/** Re-seeds the shared demo household when it is dirty and nobody has used it for a while. Never touches the clock. */
export async function resetPlaygroundIfIdle(): Promise<boolean> {
  const idleMs = sandboxCfg.autoresetMin() * 60_000;
  if (Date.now() - lastTouch < idleMs || !playgroundDirty()) return false;
  const old = demoPatientId();
  resetDemo();
  await forget(old, true).catch(() => {});
  touchPlayground();
  return true;
}

let jobs: NodeJS.Timeout | undefined;
/** The watchdog: purges idle sandboxes, prunes the per-address counter and re-seeds a dirty, idle shared playground. */
export function startSandboxJobs(): void {
  if (jobs) return;
  jobs = setInterval(() => {
    pruneCreated();
    purgeIdle(sandboxCfg.ttlS()).catch((e) => console.error("[sandbox] purge failed:", (e as Error).message));
    resetPlaygroundIfIdle().catch((e) => console.error("[sandbox] playground reset failed:", (e as Error).message));
  }, Math.max(500, sandboxCfg.sweepS() * 1000));
  jobs.unref();
}
