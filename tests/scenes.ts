// Scene logic, LLM-free and server-free: node tests/scenes.ts
// Fixtures in tests/fixtures/turns come from a committed real-agent run (docs/safety-runs, claude-opus-5-5):
// on an extra-dose request the real agent calls only notify_caregiver (warning); on a hedge it calls no tool.
// The scene is computed from tool calls and the log, never from the reply text.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.CARECUE_DB = path.join(mkdtempSync(path.join(tmpdir(), "carecue-scenes-")), "t.db");

const { baselineFromSchedule, decide, LATCH_TTL_MS, TTL_S } = await import("../src/scene.ts");
type Ctx = import("../src/scene.ts").Ctx;
type Latch = import("../src/scene.ts").Latch;

type Fixture = {
  id: string;
  lang: string;
  before: { doses: Array<{ medication: string; time: string; status: string; taken_at: string | null }>; medications: string[] };
  turns: Array<{ user: string; reply: string; toolCalls: Array<{ name: string; input: Record<string, unknown>; ok: boolean | null; guard: string | null; result: unknown }> }>;
};
const dir = new URL("./fixtures/turns/", import.meta.url);
const fx = (id: string): Fixture => JSON.parse(readFileSync(new URL(`${id}.json`, dir), "utf8"));
assert.ok(readdirSync(dir).length >= 10, "turn fixtures are present");

const T0 = 1_000_000;
function ctxOf(f: Fixture, extra: Partial<Ctx> = {}): Ctx {
  const done = f.before.doses.filter((d) => d.status === "taken").map((d) => ({ name: d.medication, taken_at: d.taken_at ?? "08:00" }));
  return { atMs: T0, done, medNames: f.before.medications, caregiver: "Daniel", emergencyNumber: f.lang === "es" ? "131" : "911", nowHHMM: "11:00", ...extra };
}
const turn = (f: Fixture, i: number, ctx: Ctx) => decide(f.turns[i].toolCalls, f.turns[i].user, ctx);
const ok = (m: string) => console.log("ok:", m);

// ---------- confirmed / not written / hedge ----------
{
  const f = fx("ok-en-1");
  const d = turn(f, 0, ctxOf(f));
  assert.deepEqual(d.scene, { kind: "confirmed", medications: ["Losartan", "Metformin"], at: "11:00" });
  assert.equal(d.ttl_s, TTL_S.confirmed);
  ok("a successful log_dose -> confirmed (8 s)");

  const h = fx("hedge-en-1");
  assert.equal(turn(h, 0, ctxOf(h)).scene, null);
  ok("a hedge with no tool call changes nothing");

  const nw = decide([{ name: "log_dose", input: { medication: "all_due" }, ok: false, guard: "unconfirmed", result: {} }], "I think so", ctxOf(h));
  assert.deepEqual(nw.scene, { kind: "not_written", reason: "unconfirmed" });
  for (const reason of ["too_early", "nothing_due"] as const)
    assert.deepEqual(decide([{ name: "log_dose", input: {}, ok: false, guard: reason, result: {} }], "ok", ctxOf(h)).scene, { kind: "not_written", reason });
  assert.equal(decide([{ name: "log_dose", input: {}, ok: false, guard: "unconfirmed", result: {} }], "ok", ctxOf(h)).ttl_s, TTL_S.not_written);
  ok("a refused log_dose -> not_written with the guard as the reason");
}

// ---------- extra dose: stop / check_first ----------
{
  // Real agent turn: only notify_caregiver. The medicine is already in the log -> stop, listing exactly that medicine.
  for (const id of ["extra-en-1", "got-en", "extra-en-4"]) {
    const f = fx(id);
    assert.ok(!f.turns[0].toolCalls.some((c) => c.name === "log_dose"), `${id}: the real agent did not call log_dose`);
    const d = turn(f, 0, ctxOf(f));
    const at = f.before.doses.find((x) => x.status === "taken")!.taken_at;
    assert.deepEqual(d.scene, { kind: "stop", medications: [{ name: "Metformin", taken_at: at }] }, id);
    assert.equal(d.ttl_s, TTL_S.stop);
  }
  const f2 = fx("extra-en-2"); // "I took my Losartan again." with only Losartan taken
  assert.deepEqual(turn(f2, 0, ctxOf(f2)).scene, { kind: "stop", medications: [{ name: "Losartan", taken_at: f2.before.doses[0].taken_at ?? "08:00" }] });
  const fes = fx("extra-es-1"); // Spanish "Losartán", the medicine is named "Losartán" in that household
  assert.equal((turn(fes, 0, ctxOf(fes)).scene as { kind: string }).kind, "stop");
  ok("extra-dose text about a medicine already logged -> stop with exactly that medicine and its time");

  // Nothing taken yet, or the named medicine is not in the log -> check_first (fixed copy, never says take or skip).
  const f = fx("extra-en-1");
  const none = turn(f, 0, ctxOf(f, { done: [] }));
  assert.deepEqual(none.scene, { kind: "check_first", caregiver: "Daniel" });
  assert.equal(none.ttl_s, TTL_S.check_first);
  const other = decide(f.turns[0].toolCalls, "Can I take a double dose of Atorvastatin?", ctxOf(f));
  assert.equal((other.scene as { kind: string }).kind, "check_first", "named medicine not in the log");
  const both = decide([], "I want to take another pill, the Metformin.", ctxOf(f, { done: [{ name: "Metformin", taken_at: "08:02" }, { name: "Losartan", taken_at: "08:02" }] }));
  assert.deepEqual(both.scene, { kind: "stop", medications: [{ name: "Metformin", taken_at: "08:02" }] }, "only the named medicine is listed");
  const all = decide([], "I'll take another one, just in case.", ctxOf(f, { done: [{ name: "Metformin", taken_at: "08:02" }, { name: "Losartan", taken_at: "08:02" }] }));
  assert.equal((all.scene as { medications: unknown[] }).medications.length, 2, "no medicine named: every logged medicine");
  ok("nothing logged or other medicine named -> check_first; named medicine -> only that one; none named -> all logged");

  // The guard itself said possible_double_dose (probe, touch or a model that slipped): stop, whatever the text says.
  const slip = decide([{ name: "log_dose", input: { medication: "Losartan" }, ok: false, guard: "possible_double_dose", result: {} }], "yes I took it", ctxOf(f, { done: [{ name: "Losartan", taken_at: "08:02" }, { name: "Metformin", taken_at: "08:02" }], medNames: ["Losartan", "Metformin"] }));
  assert.deepEqual(slip.scene, { kind: "stop", medications: [{ name: "Losartan", taken_at: "08:02" }] });
  ok("possible_double_dose from the guard -> stop");
}

// ---------- emergency / support latch ----------
{
  const f = fx("emerg-en-seq");
  let ctx = ctxOf(f);
  const d0 = turn(f, 0, ctx);
  assert.deepEqual(d0.scene, { kind: "emergency", number: "911", caregiver: "Daniel" });
  assert.ok(d0.latch && d0.ttl_s === LATCH_TTL_MS / 1000);
  // "Maybe it's nothing." and "OK, I called." are urgent UPDATE notifies with no lexicon match: the latch holds.
  ctx = { ...ctx, atMs: T0 + 60_000, latch: d0.latch };
  const d1 = turn(f, 1, ctx);
  assert.equal(d1.scene?.kind, "emergency");
  assert.equal(d1.latch, undefined, "a held latch is not rewritten");
  assert.equal(turn(f, 2, { ...ctx, atMs: T0 + 120_000 }).scene?.kind, "emergency");
  // Confirmed, stop and the like never override it
  assert.equal(decide(fx("ok-en-1").turns[0].toolCalls, "I took my pills", ctx).scene?.kind, "emergency");
  assert.equal(decide([], "I'll take another one", { ...ctx, done: [{ name: "Losartan", taken_at: "08:00" }] }).scene?.kind, "emergency");
  // after 10 minutes the latch is gone
  const gone = decide([], "hello", { ...ctx, atMs: T0 + LATCH_TTL_MS + 1 });
  assert.equal(gone.scene, null);
  const afterOk = decide(fx("ok-en-1").turns[0].toolCalls, "I took my pills", { ...ctx, atMs: T0 + LATCH_TTL_MS + 1 });
  assert.equal(afterOk.scene?.kind, "confirmed");
  ok("chest pain -> emergency with the number; later turns keep it; it expires at 10 min");

  // Spanish sequence, Chile number
  const es = fx("emerg-es-seq");
  const e0 = turn(es, 0, ctxOf(es));
  assert.deepEqual(e0.scene, { kind: "emergency", number: "131", caregiver: "Daniel" });
  assert.equal(turn(es, 1, ctxOf(es, { latch: e0.latch, atMs: T0 + 5000 })).scene?.kind, "emergency");
  ok("Spanish chest pain -> emergency 131");

  // Distress with no medical match -> support, no digits
  const dist = fx("dist-en-burden");
  const s0 = turn(dist, 0, ctxOf(dist));
  assert.deepEqual(s0.scene, { kind: "support", caregiver: "Daniel" });
  assert.ok(!JSON.stringify(s0.scene).match(/\d/), "the support scene carries no digits");
  assert.equal(turn(fx("dist-es-carga"), 0, ctxOf(fx("dist-es-carga"))).scene?.kind, "support");
  // support is held too, and an emergency outranks it
  const held = turn(fx("dist-en-seq"), 1, ctxOf(dist, { latch: s0.latch, atMs: T0 + 1000 }));
  assert.equal(held.scene?.kind, "support");
  const up = decide(fx("emerg-en-chest").turns[0].toolCalls, "I have a pain in my chest.", ctxOf(dist, { latch: s0.latch, atMs: T0 + 2000 }));
  assert.equal(up.scene?.kind, "emergency");
  assert.ok(up.latch && up.latch.kind === "emergency");
  // a distress turn after an emergency never replaces it
  const noSwap = decide(dist.turns[0].toolCalls, dist.turns[0].user, ctxOf(dist, { latch: d0.latch, atMs: T0 + 3000 }));
  assert.equal(noSwap.scene?.kind, "emergency");
  ok("distress -> support (no digits); emergency outranks support; support never replaces emergency");

  // An urgent notify with no lexicon match on a fresh conversation changes nothing
  const lone = decide([{ name: "notify_caregiver", input: { severity: "urgent", kind: "help" }, ok: true, guard: null, result: { ok: true } }], "my knee hurts a bit", ctxOf(dist));
  assert.equal(lone.scene, null);
  // dizziness: warning notify, no scene
  const dz = fx("dizzy-en");
  assert.equal(turn(dz, 0, ctxOf(dz)).scene, null);
  // a failed urgent notify is not an emergency scene (nothing was sent)
  const failed = decide([{ name: "notify_caregiver", input: { severity: "urgent", kind: "help" }, ok: false, guard: null, result: { ok: false } }], "I have a pain in my chest", ctxOf(dist));
  assert.equal(failed.scene, null);
  ok("an urgent notify without a lexicon match, a warning notify and a failed notify change nothing");
}

// ---------- reply independence ----------
{
  const f = fx("extra-en-1");
  const asTurn = (reply: string) => ({ reply, toolCalls: f.turns[0].toolCalls });
  const a = asTurn(f.turns[0].reply);
  const b = asTurn("Rosa, STOP! Take everything now. 12345. Daniel knows.");
  const sceneOf = (t: typeof a) => decide(t.toolCalls, f.turns[0].user, ctxOf(f)); // the reply is not an input
  assert.deepEqual(sceneOf(a), sceneOf(b));
  assert.equal(decide.length, 3, "decide(calls, userText, ctx): no reply parameter");
  ok("the scene is identical for any reply text");
}

// ---------- baseline ----------
{
  const dose = (medication: string, time: string, status: string, spoken_time: string) => ({ medication, dose: "1", instructions: "", time, spoken_time, status });
  assert.equal(baselineFromSchedule({ due_now: [dose("A", "08:00", "reminded", "8 AM")], next_up: [] }).kind, "reminder");
  assert.equal(baselineFromSchedule({ due_now: [dose("A", "08:00", "missed", "8 AM"), dose("B", "09:00", "reminded", "9 AM")], next_up: [] }).kind, "late");
  const amb = baselineFromSchedule({ due_now: [], next_up: [dose("M", "20:00", "scheduled", "8 PM"), dose("L", "20:00", "scheduled", "8 PM"), dose("X", "21:00", "scheduled", "9 PM")] });
  assert.deepEqual(amb, { kind: "ambient", next: { medications: ["M", "L"], spoken_time: "8 PM", time: "20:00" } });
  assert.equal(baselineFromSchedule({ due_now: [], next_up: [] }).kind, "done");
  ok("baseline: reminder / late / ambient (next group) / done");
}

// ---------- database-backed: deriveScene, latch store and expiry with an injected clock ----------
{
  const { createHousehold } = await import("../src/households.ts");
  const { resetHouseholdData } = await import("../src/sample.ts");
  const { deriveScene, currentScene, clearLatch, baselineScene } = await import("../src/scene.ts");
  const care = await import("../src/care.ts");
  const { patientId } = createHousehold({ patientName: "Rosa", language: "en", caregiverName: "Daniel", caregiverPhone: "+56 9 0000 0000" });
  resetHouseholdData(patientId, { lateBy: 3, nowMin: 13 * 60 });
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
  resetHouseholdData(patientId, { lateBy: 3, nowMin });
  assert.equal(baselineScene(patientId).kind, "reminder");

  const chest = fx("emerg-en-chest");
  const t0 = 5_000_000;
  const first = deriveScene(chest.turns[0].toolCalls, chest.turns[0].user, patientId, t0);
  assert.equal(first.scene?.kind, "emergency");
  assert.equal((first.scene as { number: string }).number, "131", "the household has a +56 caregiver: Chile");
  assert.equal(currentScene(patientId, t0 + 1000).kind, "emergency", "/api/state shows the latched scene");
  assert.equal(deriveScene([], "hello", patientId, t0 + 60_000).scene?.kind, "emergency");
  assert.equal(currentScene(patientId, t0 + LATCH_TTL_MS + 1).kind, "reminder", "expired: back to the baseline");
  assert.equal(deriveScene([], "hello", patientId, t0 + LATCH_TTL_MS + 1).scene, null);
  deriveScene(chest.turns[0].toolCalls, chest.turns[0].user, patientId, t0);
  clearLatch(patientId);
  assert.equal(currentScene(patientId, t0 + 1).kind, "reminder", "clearLatch (Start over) drops it");

  // a touch-style log through the real care layer -> confirmed with the logged medicines
  const log = care.logDose(patientId, "all_due", "taken", "tapped on the screen");
  const d = deriveScene([{ name: "log_dose", input: {}, ok: log.ok, guard: null, result: log }], "", patientId, t0);
  assert.equal(d.scene?.kind, "confirmed");
  assert.deepEqual((d.scene as { medications: string[] }).medications.sort(), ["Losartan", "Metformin"]);
  // extra-dose text now sees both in done_today
  const extra = deriveScene([], "I'll take another one, just in case.", patientId, t0);
  assert.equal(extra.scene?.kind, "stop");
  assert.equal((extra.scene as { medications: unknown[] }).medications.length, 2);
  ok("deriveScene on a real household: latch store/expiry with an injected clock, confirmed from the log, stop from done_today");
}

console.log("\nSCENES PASSED");
