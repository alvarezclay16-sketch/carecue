// Sample data for the demo households only (sandboxes and the local demo): medicines with times relative
// to the clock, 14 days of deterministic SAMPLE history, and the week view built from it.
// Real households never get any of this. Everywhere it is shown it is labelled "Sample history (demo)".

import { db, demoSeedHooks } from "./db.ts";
import * as care from "./care.ts";
import { atLocal, localDate, localTime, now } from "./clock.ts";

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const nowMinutes = () => minutesOf(localTime(now()));

export const SAMPLE_LABEL = { en: "Sample history (demo)", es: "Historial de ejemplo (demo)" };

/** Local date `n` days before `from` ("YYYY-MM-DD"). */
function daysBefore(from: Date, n: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return localDate(d);
}

// ---------- medicines relative to now ----------

/**
 * Rosa's three medicines. The morning pair (Metformin + Losartan) was due `lateBy` minutes ago; the evening
 * and night doses sit later today when they still can, so a fresh scenario shows exactly one thing due.
 */
export function relativeMeds(nowMin: number, lateBy: number) {
  const due = hhmm(Math.max(0, nowMin - lateBy));
  const later = (preferred: string, gap: number, extra: number) =>
    minutesOf(preferred) >= nowMin + gap ? preferred : nowMin + extra <= 23 * 60 + 30 ? hhmm(nowMin + extra) : null;
  const evening = later("20:00", 30, 90);
  const night = later("21:00", 30, 120);
  return [
    { name: "Metformin", dose: "850 mg, 1 tablet", instructions: "with breakfast and dinner", times: evening ? [due, evening] : [due], units: 22 },
    { name: "Losartan", dose: "50 mg, 1 tablet", instructions: "in the morning", times: [due], units: 9 },
    { name: "Atorvastatin", dose: "20 mg, 1 tablet", instructions: "at night", times: night ? [night] : [], units: 30 },
  ];
}

/**
 * Wipes a demo household's medicines, doses, alerts and check-ins and seeds it again for "now":
 * the three medicines with times relative to the clock, then the sample history. People, caregivers and links stay.
 */
export function resetHouseholdData(patientId: number, opts: { lateBy?: number; nowMin?: number } = {}): void {
  const nowMin = opts.nowMin ?? nowMinutes();
  db.exec("BEGIN");
  try {
    for (const t of ["alerts", "doses", "checkins", "medications"]) db.prepare(`DELETE FROM ${t} WHERE patient_id = ?`).run(patientId);
    const insert = db.prepare(
      `INSERT INTO medications (patient_id, name, dose, instructions, times, units_per_dose, units_on_hand, refill_threshold_days)
       VALUES (?, ?, ?, ?, ?, 1, ?, 5)`,
    );
    for (const m of relativeMeds(nowMin, opts.lateBy ?? 3)) insert.run(patientId, m.name, m.dose, m.instructions, JSON.stringify(m.times), m.units);
    care.ensureDoses(patientId, localDate(now()));
    addSampleHistory(patientId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------- 14 days of sample history ----------

const SLOTS = [
  { med: "Metformin", time: "08:00" },
  { med: "Losartan", time: "08:00" },
  { med: "Metformin", time: "20:00" },
  { med: "Atorvastatin", time: "21:00" },
];
// Evening Metformin confirmed late (minutes after the scheduled time) on 4 of the last 7 days.
const EVENING_LATE: Record<number, number> = { 1: 52, 2: 68, 4: 47, 6: 75 };
const MISSED: Array<[number, string, string]> = [[5, "Losartan", "08:00"]]; // [days ago, medicine, time]

/**
 * Inserts the sample history for the 14 days before today: most doses taken within a few minutes, the evening
 * Metformin confirmed late on 4 of the last 7 days, one missed Losartan 5 days ago, and 3 check-ins.
 * Deterministic and idempotent. No alerts are seeded.
 */
export function addSampleHistory(patientId: number): void {
  const today = now();
  const medId = new Map(care.medicationsOf(patientId).map((m) => [m.name, m.id]));
  const insert = db.prepare(
    "INSERT OR IGNORE INTO doses (medication_id, patient_id, date, time, status, reminded_at, resolved_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, '')",
  );
  for (let d = 1; d <= 14; d++) {
    const date = daysBefore(today, d);
    SLOTS.forEach((slot, i) => {
      const id = medId.get(slot.med);
      if (!id) return;
      const due = atLocal(date, slot.time);
      const iso = (offsetMin: number) => new Date(due.getTime() + offsetMin * 60_000).toISOString();
      if (MISSED.some(([ago, med, time]) => ago === d && med === slot.med && time === slot.time)) {
        insert.run(id, patientId, date, slot.time, "missed", iso(1), null);
        return;
      }
      const eveningMetformin = slot.med === "Metformin" && slot.time === "20:00";
      const late = eveningMetformin && d <= 7 ? EVENING_LATE[d] : undefined;
      const minutes = late ?? ((d * 7 + i * 3) % 9) + 1;
      insert.run(id, patientId, date, slot.time, "taken", iso(1), iso(minutes));
    });
  }
  const checkin = db.prepare("INSERT INTO checkins (patient_id, created_at, mood, note) VALUES (?, ?, ?, ?)");
  if (!db.prepare("SELECT 1 FROM checkins WHERE patient_id = ?").get(patientId))
    for (const [ago, mood, note] of [[2, "good", "slept well"], [4, "tired", "short night"], [6, "good", ""]] as const)
      checkin.run(patientId, atLocal(daysBefore(today, ago), "10:00").toISOString(), mood, note);
}

/** The local demo household gets the history when it is created, and once at boot for an older database. */
demoSeedHooks.push((patientId) => addSampleHistory(patientId));
export function ensureDemoHistory(patientId: number): void {
  const past = db.prepare("SELECT 1 FROM doses WHERE patient_id = ? AND date < ?").get(patientId, localDate(now()));
  if (!past) addSampleHistory(patientId);
}

// ---------- the week view ----------

type WeekDose = { date: string; med: string; time: string; status: string; minutes_late: number | null };

/**
 * The last 7 completed days by dose, and plain counts about them. Counts only: no thresholds, no judgement, no advice.
 * "Late" means confirmed more than the household's grace period after the scheduled time.
 */
export function weekView(patientId: number) {
  const t = now();
  const today = localDate(t);
  const from = daysBefore(t, 7);
  const to = daysBefore(t, 1);
  const patient = care.getPatient(patientId);
  const es = patient.preferred_language === "es";
  const rows = db
    .prepare(
      `SELECT d.date, d.time, d.status, d.resolved_at, m.name AS med
       FROM doses d JOIN medications m ON m.id = d.medication_id
       WHERE d.patient_id = ? AND d.date BETWEEN ? AND ? AND m.active = 1 ORDER BY d.date, d.time, m.name`,
    )
    .all(patientId, from, to) as Array<{ date: string; time: string; status: string; resolved_at: string | null; med: string }>;
  const doses: WeekDose[] = rows.map((r) => ({
    date: r.date,
    med: r.med,
    time: r.time,
    status: r.status,
    minutes_late:
      r.status === "taken" && r.resolved_at ? Math.max(0, Math.round((new Date(r.resolved_at).getTime() - atLocal(r.date, r.time).getTime()) / 60_000)) : null,
  }));
  const isLate = (d: WeekDose) => d.minutes_late !== null && d.minutes_late > patient.grace_minutes;
  const period = (time: string) => {
    const h = Number(time.slice(0, 2));
    return h < 12 ? (es ? "de la mañana" : "Morning") : h < 17 ? (es ? "de la tarde" : "Afternoon") : es ? "de la noche" : "Evening";
  };
  const callouts: string[] = [];
  const groups = new Map<string, WeekDose[]>();
  for (const d of doses) groups.set(`${d.med}|${d.time}`, [...(groups.get(`${d.med}|${d.time}`) ?? []), d]);
  for (const [key, list] of groups) {
    const [med, time] = key.split("|");
    const n = list.filter(isLate).length;
    if (!n) continue;
    callouts.push(
      es
        ? `${med} ${period(time)}: confirmada con retraso ${n} de los últimos ${list.length} días`
        : `${period(time)} ${med}: confirmed late ${n} of the last ${list.length} days`,
    );
  }
  const missedBy = new Map<string, number>();
  for (const d of doses) if (d.status === "missed") missedBy.set(d.med, (missedBy.get(d.med) ?? 0) + 1);
  for (const [med, n] of missedBy)
    callouts.push(es ? `${med}: ${n} ${n === 1 ? "toma sin confirmar" : "tomas sin confirmar"} en los últimos 7 días` : `${med}: ${n} ${n === 1 ? "dose" : "doses"} not confirmed in the last 7 days`);

  return {
    sample: true,
    label: SAMPLE_LABEL[es ? "es" : "en"],
    window: { from, to, today },
    grace_minutes: patient.grace_minutes,
    doses,
    callouts,
    adherence: care.adherence(patientId, 7),
    refills: care.refillForecast(patientId),
  };
}
