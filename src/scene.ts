// Which scene the simulated Echo Show draws. Computed on the server from MCP tool results and household state,
// never from the reply text, so a scene can be wrong only if a tool result or the log is wrong.
// The decision itself (decide, baselineFromSchedule) is pure; deriveScene/baselineScene add the database reads.
// Scenes are host-side rendering in the simulated Echo: a real Alexa+ device cannot be pushed scenes through MCP.

import * as care from "./care.ts";
import { fold } from "./fold.ts";
import { localTime, now } from "./clock.ts";
import { isDistress, isExtraDoseIntent, isMedicalEmergency } from "./emergency.ts";
import type { ToolTrace } from "./trace.ts";

type SceneMed = { name: string; dose: string; instructions: string };
export type NotWrittenReason = "unconfirmed" | "too_early" | "nothing_due" | "not_found";

export type Scene =
  | { kind: "ambient"; next?: { medications: string[]; spoken_time: string; time: string } }
  | { kind: "reminder"; medications: SceneMed[]; spoken_time: string; time: string }
  | { kind: "late"; medications: SceneMed[]; spoken_time: string; time: string }
  | { kind: "confirmed"; medications: string[]; at: string }
  | { kind: "stop"; medications: Array<{ name: string; taken_at: string }> }
  | { kind: "check_first"; caregiver: string }
  | { kind: "not_written"; reason: NotWrittenReason }
  | { kind: "emergency"; number: string; caregiver: string }
  | { kind: "support"; caregiver: string }
  | { kind: "done" };

export type SceneKind = Scene["kind"];

/** Seconds a transient scene stays up before the client goes back to the baseline. */
export const TTL_S = { confirmed: 8, not_written: 8, stop: 15, check_first: 15 } as const;
export const LATCH_TTL_MS = 10 * 60_000;

export type Latch = { kind: "emergency" | "support"; since: number; expires: number; scene: Scene };
export type Done = { name: string; taken_at: string };
export type Ctx = {
  atMs: number;
  done: Done[]; // medicines logged as taken today (one entry each, latest time)
  medNames: string[]; // active medicines of the household
  caregiver: string; // first name
  emergencyNumber: string;
  nowHHMM: string;
  latch?: Latch;
};
export type Decision = { scene: Scene | null; ttl_s: number | null; latch?: Latch };
type Call = Pick<ToolTrace, "name" | "input" | "ok" | "guard" | "result">;

// ---------- baseline ----------

type Dose = { medication: string; dose: string; instructions: string; time: string; spoken_time: string; status: string };
type Schedule = { due_now: Dose[]; next_up: Dose[] };

const asMed = (d: Dose): SceneMed => ({ name: d.medication, dose: d.dose, instructions: d.instructions });

/** What the screen shows when nothing special just happened. */
export function baselineFromSchedule(s: Schedule): Scene {
  const missed = s.due_now.filter((d) => d.status === "missed");
  if (missed.length) return { kind: "late", medications: missed.map(asMed), spoken_time: missed[0].spoken_time, time: missed[0].time };
  if (s.due_now.length) return { kind: "reminder", medications: s.due_now.map(asMed), spoken_time: s.due_now[0].spoken_time, time: s.due_now[0].time };
  if (s.next_up.length) {
    const first = s.next_up[0];
    const same = s.next_up.filter((d) => d.time === first.time).map((d) => d.medication);
    return { kind: "ambient", next: { medications: same, spoken_time: first.spoken_time, time: first.time } };
  }
  return { kind: "done" };
}

// ---------- the decision ----------

const input = (c: Call) => (c.input ?? {}) as Record<string, unknown>;
const okNotify = (c: Call, severity: string) => c.name === "notify_caregiver" && c.ok === true && input(c).severity === severity;

/** Medicines the user named, matched like findMedication does: whole name, or the first 6 letters ("Losartán", "metformina"). */
function named(text: string, medNames: string[]): string[] {
  const t = fold(text);
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 6);
  return medNames.filter((m) => {
    const f = fold(m);
    return t.includes(f) || words.some((w) => w.slice(0, 6) === f.slice(0, 6));
  });
}

const stopScene = (done: Done[]): Scene => ({ kind: "stop", medications: done.map((d) => ({ name: d.name, taken_at: d.taken_at })) });

/**
 * Priority: latch, emergency, support, stop, check_first, confirmed, not_written, else nothing (the client keeps the baseline).
 * `calls` are the tool calls of this turn (from the model or from touch); `text` is what the person said.
 */
export function decide(calls: Call[], text: string, ctx: Ctx): Decision {
  const active = ctx.latch && ctx.latch.expires > ctx.atMs ? ctx.latch : undefined;
  const left = (l: Latch) => Math.max(1, Math.ceil((l.expires - ctx.atMs) / 1000));
  const newLatch = (kind: "emergency" | "support"): Decision => {
    const scene: Scene = kind === "emergency" ? { kind, number: ctx.emergencyNumber, caregiver: ctx.caregiver } : { kind, caregiver: ctx.caregiver };
    const latch: Latch = { kind, since: ctx.atMs, expires: ctx.atMs + LATCH_TTL_MS, scene };
    return { scene, ttl_s: left(latch), latch };
  };

  const urgentHelp = calls.some((c) => okNotify(c, "urgent") && input(c).kind === "help");
  const emergency = urgentHelp && isMedicalEmergency(text);
  // (1) a latched emergency/support scene is never replaced by a later turn; an emergency still outranks support
  if (active) {
    if (active.kind === "support" && emergency) return newLatch("emergency");
    return { scene: active.scene, ttl_s: left(active) };
  }
  // (2) emergency, (3) support. Support also follows from the tool result alone: a sent urgent notify of kind help whose
  // words the lexicon does not know (the agent judged it urgent) still shows the support scene, with no digits.
  // A sent urgent notify of another kind needs the distress lexicon as before; a failed notify changes nothing.
  if (emergency) return newLatch("emergency");
  if (urgentHelp || (calls.some((c) => okNotify(c, "urgent")) && isDistress(text))) return newLatch("support");

  const transient = (scene: Scene, ttl: number): Decision => ({ scene, ttl_s: ttl });

  // (4) stop: the guard said possible_double_dose, or an extra-dose request about a medicine already logged today
  const doubleDose = calls.find((c) => c.name === "log_dose" && c.guard === "possible_double_dose");
  if (doubleDose) {
    const meds = named(String(input(doubleDose).medication ?? ""), ctx.medNames);
    const hit = ctx.done.filter((d) => meds.includes(d.name));
    const list = hit.length ? hit : ctx.done;
    if (list.length) return transient(stopScene(list), TTL_S.stop);
  }
  if (isExtraDoseIntent(text, ctx.medNames)) {
    const meds = named(text, ctx.medNames);
    const hit = meds.length ? ctx.done.filter((d) => meds.includes(d.name)) : ctx.done;
    // (5) check_first: nothing matching has been logged, so there is no log to point at
    return hit.length ? transient(stopScene(hit), TTL_S.stop) : transient({ kind: "check_first", caregiver: ctx.caregiver }, TTL_S.check_first);
  }

  // (6) confirmed: a successful log_dose that wrote something taken
  const logs = calls.filter((c) => c.name === "log_dose");
  const written = logs
    .filter((c) => c.ok === true)
    .flatMap((c) => ((c.result as { logged?: Array<{ medication: string; status: string }> } | null)?.logged ?? []).filter((l) => l.status === "taken").map((l) => l.medication));
  if (written.length) return transient({ kind: "confirmed", medications: [...new Set(written)], at: ctx.nowHHMM }, TTL_S.confirmed);
  // (7) not_written: tool-driven only; a hedge with no tool call changes nothing
  const refused = logs.find((c) => c.ok === false && (c.guard === "unconfirmed" || c.guard === "too_early" || c.guard === "nothing_due" || c.guard === "not_found"));
  if (refused) return transient({ kind: "not_written", reason: refused.guard as NotWrittenReason }, TTL_S.not_written);
  return { scene: null, ttl_s: null }; // (8)
}

// ---------- database-backed wrappers ----------

const latches = new Map<number, Latch>();

export function clearLatch(patientId: number): void {
  latches.delete(patientId);
}
export function clearAllLatches(): void {
  latches.clear();
}

function activeLatch(patientId: number, atMs: number): Latch | undefined {
  const l = latches.get(patientId);
  if (l && l.expires <= atMs) latches.delete(patientId);
  return latches.get(patientId);
}

function context(patientId: number, atMs: number): Ctx {
  const s = care.todaySchedule(patientId);
  const byMed = new Map<string, Done>();
  for (const d of s.done_today) if (d.status === "taken" && d.taken_at) byMed.set(d.medication, { name: d.medication, taken_at: d.taken_at });
  return {
    atMs,
    done: [...byMed.values()],
    medNames: care.medicationsOf(patientId).map((m) => m.name),
    caregiver: care.caregiversOf(patientId)[0]?.name.trim().split(/\s+/)[0] ?? "your family",
    emergencyNumber: care.emergencyNumber(patientId),
    nowHHMM: localTime(now()),
    latch: activeLatch(patientId, atMs),
  };
}

/** The scene one chat or touch turn produces, or null (keep the baseline). Stores a new latch. */
export function deriveScene(calls: Call[], userText: string, patientId: number, atMs = Date.now()): { scene: Scene | null; ttl_s: number | null } {
  const d = decide(calls, userText, context(patientId, atMs));
  if (d.latch) latches.set(patientId, d.latch);
  return { scene: d.scene, ttl_s: d.ttl_s };
}

export function baselineScene(patientId: number): Scene {
  return baselineFromSchedule(care.todaySchedule(patientId));
}

/** What /api/state reports: the latched scene while there is one, else the baseline. */
export function currentScene(patientId: number, atMs = Date.now()): Scene {
  return activeLatch(patientId, atMs)?.scene ?? baselineScene(patientId);
}
