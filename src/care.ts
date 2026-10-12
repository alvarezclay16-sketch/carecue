// CareCue domain logic: schedules, dose log, double-dose guard, refills, caregiver escalation.
// No medical decisions live here: CareCue only follows the schedule the prescription gives it.

import { db, type Alert, type Caregiver, type Dose, type Medication, type Patient } from "./db.ts";
import { fold } from "./fold.ts";
import { atLocal, localDate, localTime, now, spokenTime, spokenTimeEs } from "./clock.ts";

// ---------- lookups ----------

export function getPatient(patientId?: number): Patient {
  const row = patientId
    ? db.prepare("SELECT * FROM patients WHERE id = ?").get(patientId)
    : db.prepare("SELECT * FROM patients ORDER BY id LIMIT 1").get();
  if (!row) throw new Error("No patient is set up on this device yet.");
  return row as Patient;
}

export function listPatients(): Patient[] {
  return db.prepare("SELECT * FROM patients ORDER BY id").all() as Patient[];
}

/** Local emergency number: Chile (Spanish household or a +56 caregiver phone) gets 131, otherwise 911. */
function isChile(patientId: number): boolean {
  return (
    getPatient(patientId).preferred_language === "es" ||
    caregiversOf(patientId).some((c) => (c.contact ?? "").replace(/\s/g, "").startsWith("+56"))
  );
}

export function emergencyNumber(patientId: number): string {
  return process.env.CARECUE_EMERGENCY_NUMBER ?? (isChile(patientId) ? "131" : "911");
}

/** Suicide-prevention line: *4141 (MINSAL, Chile) or 988 (US). */
export function crisisLine(patientId: number): string {
  return process.env.CARECUE_CRISIS_LINE ?? (isChile(patientId) ? "*4141" : "988");
}

export function caregiversOf(patientId: number): Caregiver[] {
  return db.prepare("SELECT * FROM caregivers WHERE patient_id = ? ORDER BY id").all(patientId) as Caregiver[];
}

export function medicationsOf(patientId: number): Medication[] {
  return db
    .prepare("SELECT * FROM medications WHERE patient_id = ? AND active = 1 ORDER BY id")
    .all(patientId) as Medication[];
}

function timesOf(med: Medication): string[] {
  return (JSON.parse(med.times) as string[]).slice().sort();
}

/** Finds a medication by a spoken name ("metformin", "my diabetes pill" won't match: the agent resolves those). */
export function findMedication(patientId: number, name: string): Medication | undefined {
  const needle = fold(name);
  if (!needle) return undefined;
  const meds = medicationsOf(patientId);
  return (
    meds.find((m) => fold(m.name) === needle) ??
    meds.find((m) => fold(m.name).includes(needle) || needle.includes(fold(m.name))) ??
    // "metformina" vs "Metformin", "losartán" vs "Losartan": compare the first 6 letters.
    meds.find((m) => fold(m.name).slice(0, 6) === needle.slice(0, 6))
  );
}

export { fold };

// ---------- schedule ----------

/** Makes sure a dose row exists for every scheduled time on `date`. Idempotent. */
export function ensureDoses(patientId: number, date: string): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO doses (medication_id, patient_id, date, time) VALUES (?, ?, ?, ?)",
  );
  for (const med of medicationsOf(patientId)) {
    for (const t of timesOf(med)) insert.run(med.id, patientId, date, t);
  }
}

type DoseView = Dose & { medication: string; dose_text: string; instructions: string };

function dosesOn(patientId: number, date: string): DoseView[] {
  ensureDoses(patientId, date);
  return db
    .prepare(
      `SELECT d.*, m.name AS medication, m.dose AS dose_text, m.instructions
       FROM doses d JOIN medications m ON m.id = d.medication_id
       WHERE d.patient_id = ? AND d.date = ? AND m.active = 1
       ORDER BY d.time, m.name`,
    )
    .all(patientId, date) as DoseView[];
}

const OPEN = new Set(["scheduled", "reminded", "missed"]);

export function todaySchedule(patientId: number) {
  const t = now();
  const date = localDate(t);
  const clock = localTime(t);
  const doses = dosesOn(patientId, date);
  const describe = (d: DoseView) => ({
    dose_id: d.id,
    medication: d.medication,
    dose: d.dose_text,
    instructions: d.instructions,
    time: d.time,
    spoken_time: spokenTime(d.time),
    status: d.status,
    taken_at: d.status === "taken" && d.resolved_at ? localTime(new Date(d.resolved_at)) : null,
  });
  const dueNow = doses.filter((d) => OPEN.has(d.status) && d.time <= clock).map(describe);
  const upcoming = doses.filter((d) => d.status === "scheduled" && d.time > clock).map(describe);
  const done = doses.filter((d) => d.status === "taken" || d.status === "skipped").map(describe);
  return {
    now: clock,
    spoken_now: spokenTime(clock),
    date,
    due_now: dueNow,
    next_up: upcoming.slice(0, 3),
    done_today: done,
    all_today: doses.map(describe),
  };
}

// ---------- dose log ----------

export type LogResult = {
  ok: boolean;
  message: string;
  logged: Array<{ medication: string; time: string; status: string }>;
  warnings: string[];
};

/**
 * Logs that the patient took (or skipped) a medication.
 * Picks the open dose closest to now; refuses to log a second "taken" for a dose
 * that is already taken (the double-dose guard).
 */
export function logDose(
  patientId: number,
  medicationName: string | "all_due",
  status: "taken" | "skipped",
  note = "",
): LogResult {
  const t = now();
  const date = localDate(t);
  const clock = localTime(t);
  const doses = dosesOn(patientId, date);
  const warnings: string[] = [];

  let targets: DoseView[];
  if (medicationName === "all_due") {
    targets = doses.filter((d) => OPEN.has(d.status) && d.time <= clock);
    if (targets.length === 0) {
      return { ok: false, message: "Nothing is due right now, so nothing was written down.", logged: [], warnings: ["nothing_due"] };
    }
  } else {
    const med = findMedication(patientId, medicationName);
    if (!med) {
      const names = medicationsOf(patientId).map((m) => m.name).join(", ");
      return { ok: false, message: `I couldn't find "${medicationName}". This device tracks: ${names}.`, logged: [], warnings };
    }
    const mine = doses.filter((d) => d.medication_id === med.id);
    const open = mine.filter((d) => OPEN.has(d.status));
    if (open.length === 0) {
      const last = mine.filter((d) => d.status === "taken").pop();
      const msg = last
        ? `${med.name} is already logged as taken today at ${spokenTime(localTime(new Date(last.resolved_at!)))}. ` +
          `There are no more ${med.name} doses scheduled today, so please don't take another one.`
        : `There are no ${med.name} doses left to log today.`;
      return { ok: false, message: msg, logged: [], warnings: ["possible_double_dose"] };
    }
    // Closest open dose to the current time; allow taking up to 60 minutes early.
    const nowMin = toMinutes(clock);
    const eligible = open.filter((d) => toMinutes(d.time) <= nowMin + 60);
    if (eligible.length === 0) {
      const next = open[0];
      return {
        ok: false,
        message: `Your next ${med.name} isn't until ${spokenTime(next.time)}, so nothing was written down.`,
        logged: [],
        warnings: ["too_early"],
      };
    }
    eligible.sort((a, b) => Math.abs(toMinutes(a.time) - nowMin) - Math.abs(toMinutes(b.time) - nowMin));
    targets = [eligible[0]];
  }

  const update = db.prepare("UPDATE doses SET status = ?, resolved_at = ?, note = ? WHERE id = ?");
  const decrement = db.prepare(
    "UPDATE medications SET units_on_hand = MAX(0, units_on_hand - units_per_dose) WHERE id = ?",
  );
  const iso = t.toISOString();
  for (const d of targets) {
    update.run(status, iso, note, d.id);
    if (status === "taken") decrement.run(d.medication_id);
    if (d.status === "missed") warnings.push(`late_${d.medication}`);
  }
  // A late "taken" clears the caregiver alert for that dose.
  db.prepare(
    `UPDATE alerts SET acknowledged = 1 WHERE dose_id IN (${targets.map(() => "?").join(",")}) AND kind = 'missed_dose'`,
  ).run(...targets.map((d) => d.id));

  const names = targets.map((d) => `${d.medication} (${spokenTime(d.time)})`).join(" and ");
  const late = targets.filter((d) => d.status === "missed");
  if (late.length && status === "taken") {
    // Close the loop with the family: the missed-dose alert they got is now resolved.
    const p = getPatient(patientId);
    const list = late.map((d) => d.medication).join(", ");
    void alertCaregivers(
      patientId,
      "info",
      "info",
      p.preferred_language === "es"
        ? `${p.name} dijo que se tomó ${list} con retraso; lo confirmó a ${spokenTimeEs(localTime(t))}. La alerta anterior quedó resuelta.`
        : `${p.name} reported taking ${list} late, confirmed at ${spokenTime(localTime(t))}. The earlier alert is resolved.`,
    );
  }
  return {
    ok: true,
    message:
      (status === "taken" ? `Logged: ${names} taken.` : `Logged: ${names} skipped.`) +
      (late.length ? " That dose had been marked missed; the caregiver has been told it is now taken." : ""),
    logged: targets.map((d) => ({ medication: d.medication, time: d.time, status })),
    warnings,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Answers "did I already take my pills?" from the log, never from memory. */
export function whatHaveITaken(patientId: number, medicationName?: string) {
  const s = todaySchedule(patientId);
  const med = medicationName ? findMedication(patientId, medicationName) : undefined;
  const pick = (list: typeof s.all_today) => (med ? list.filter((d) => d.medication === med.name) : list);
  return {
    now: s.spoken_now,
    taken: pick(s.all_today.filter((d) => d.status === "taken")).map((d) => ({
      medication: d.medication,
      scheduled: d.spoken_time,
      taken_at: d.taken_at ? spokenTime(d.taken_at) : null,
    })),
    still_due: pick(s.due_now).map((d) => ({ medication: d.medication, scheduled: d.spoken_time, status: d.status })),
    later_today: pick(s.next_up).map((d) => ({ medication: d.medication, scheduled: d.spoken_time })),
  };
}

// ---------- adherence & refills ----------

export function adherence(patientId: number, days = 7) {
  const end = now();
  const from = new Date(end);
  from.setDate(from.getDate() - (days - 1));
  const rows = db
    .prepare(
      `SELECT d.status, m.name AS medication FROM doses d JOIN medications m ON m.id = d.medication_id
       WHERE d.patient_id = ? AND d.date BETWEEN ? AND ? AND (d.date < ? OR d.time <= ?)`,
    )
    .all(patientId, localDate(from), localDate(end), localDate(end), localTime(end)) as Array<{
    status: string;
    medication: string;
  }>;
  // Doses still waiting inside their grace period aren't counted yet.
  const settled = rows.filter((r) => r.status !== "scheduled" && r.status !== "reminded");
  rows.length = 0;
  rows.push(...settled);
  const total = rows.length;
  const taken = rows.filter((r) => r.status === "taken").length;
  const missed = rows.filter((r) => r.status === "missed").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const byMed: Record<string, { taken: number; total: number }> = {};
  for (const r of rows) {
    byMed[r.medication] ??= { taken: 0, total: 0 };
    byMed[r.medication].total++;
    if (r.status === "taken") byMed[r.medication].taken++;
  }
  return {
    days,
    doses_due: total,
    taken,
    missed,
    skipped,
    adherence_percent: total ? Math.round((taken / total) * 100) : null,
    by_medication: byMed,
  };
}

export function refillForecast(patientId: number) {
  return medicationsOf(patientId).map((m) => {
    const perDay = timesOf(m).length * m.units_per_dose;
    const daysLeft = perDay > 0 ? Math.floor(m.units_on_hand / perDay) : null;
    return {
      medication: m.name,
      units_on_hand: m.units_on_hand,
      per_day: perDay,
      days_left: daysLeft,
      needs_refill: daysLeft !== null && daysLeft <= m.refill_threshold_days,
    };
  });
}

export function recordRefill(patientId: number, medicationName: string, units: number) {
  const med = findMedication(patientId, medicationName);
  if (!med) return { ok: false, message: `I couldn't find "${medicationName}".` };
  db.prepare("UPDATE medications SET units_on_hand = units_on_hand + ? WHERE id = ?").run(units, med.id);
  db.prepare("UPDATE alerts SET acknowledged = 1 WHERE patient_id = ? AND kind = 'refill' AND message LIKE ?").run(
    patientId,
    `%${med.name}%`,
  );
  const f = refillForecast(patientId).find((r) => r.medication === med.name)!;
  const p = getPatient(patientId);
  void alertCaregivers(
    patientId,
    "refill",
    "info",
    p.preferred_language === "es"
      ? `${p.name} repuso ${units} de ${med.name}. Ahora tiene ${f.units_on_hand} (unos ${f.days_left} días).`
      : `${p.name} restocked ${units} ${med.name}. Now ${f.units_on_hand} on hand (about ${f.days_left} days).`,
  ).then(() =>
    db.prepare("UPDATE alerts SET acknowledged = 1 WHERE patient_id = ? AND kind = 'refill' AND message LIKE ?").run(patientId, `%${med.name}%`),
  );
  return { ok: true, message: `Added ${units} to ${med.name}. That's about ${f.days_left} days of supply.`, forecast: f };
}

// ---------- medications (caregiver setup) ----------

export function addMedication(
  patientId: number,
  input: { name: string; dose: string; times: string[]; instructions?: string; units_on_hand?: number; units_per_dose?: number },
) {
  const times = input.times.map(normalizeTime);
  const r = db
    .prepare(
      `INSERT INTO medications (patient_id, name, dose, instructions, times, units_per_dose, units_on_hand)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      patientId,
      input.name.trim(),
      input.dose.trim(),
      input.instructions?.trim() ?? "",
      JSON.stringify(times),
      input.units_per_dose ?? 1,
      input.units_on_hand ?? 0,
    );
  ensureDoses(patientId, localDate(now()));
  return { ok: true, medication_id: Number(r.lastInsertRowid), times };
}

export function stopMedication(patientId: number, medicationName: string) {
  const med = findMedication(patientId, medicationName);
  if (!med) return { ok: false, message: `I couldn't find "${medicationName}".` };
  db.prepare("UPDATE medications SET active = 0 WHERE id = ?").run(med.id);
  return { ok: true, message: `${med.name} removed from the schedule.` };
}

function normalizeTime(t: string): string {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
  if (!m) throw new Error(`Invalid time "${t}". Use HH:MM, e.g. 08:00 or 8:30 PM.`);
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase().replace(/\./g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) throw new Error(`Invalid time "${t}".`);
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

// ---------- caregivers & alerts ----------

export type CareEvent = { id: number; at: string; kind: "reminder" | "alert"; text: string; patient_id: number };

const events: CareEvent[] = [];
let eventSeq = 0;

function pushEvent(e: Omit<CareEvent, "id" | "at">) {
  events.push({ ...e, id: ++eventSeq, at: now().toISOString() });
  if (events.length > 200) events.shift();
}

export function eventsSince(id: number, patientId?: number): CareEvent[] {
  return events.filter((e) => e.id > id && (patientId === undefined || e.patient_id === patientId));
}

export async function alertCaregivers(
  patientId: number,
  kind: Alert["kind"],
  severity: "info" | "warning" | "urgent",
  message: string,
  doseId: number | null = null,
) {
  const caregivers = caregiversOf(patientId);
  const to = caregivers.map((c) => `${c.name} (${c.relationship})`).join(", ") || "no caregiver configured";
  // One open message per incident: a repeat within 10 minutes is appended to the open alert instead,
  // unless it is more serious than that alert (an escalation gets its own row).
  if (doseId == null && kind !== "refill" && kind !== "missed_dose") {
    const prev = db
      .prepare(
        "SELECT id, severity FROM alerts WHERE patient_id = ? AND kind NOT IN ('refill','missed_dose') AND acknowledged = 0 AND dose_id IS NULL AND created_at > ? ORDER BY id DESC LIMIT 1",
      )
      .get(patientId, new Date(now().getTime() - 10 * 60_000).toISOString()) as { id: number; severity: string } | undefined;
    const rank: Record<string, number> = { info: 0, warning: 1, urgent: 2 };
    if (prev && rank[severity] <= rank[prev.severity]) {
      db.prepare("UPDATE alerts SET message = message || ' | [' || ? || '] ' || ? WHERE id = ?").run(getPatient(patientId).preferred_language === "es" ? spokenTimeEs(localTime(now())) : spokenTime(localTime(now())), message, prev.id);
      pushEvent({ kind: "alert", text: `To ${to}: ${message}`, patient_id: patientId });
      void deliver({ patient: getPatient(patientId).name, kind, severity, message, to });
      return { ok: true, merged: true, alert_id: prev.id, delivered_to: to };
    }
  }
  const r = db
    .prepare(
      "INSERT INTO alerts (patient_id, dose_id, kind, severity, message, created_at, delivered_to) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(patientId, doseId, kind, severity, message, now().toISOString(), to);
  pushEvent({ kind: "alert", text: `To ${to}: ${message}`, patient_id: patientId });
  void deliver({ patient: getPatient(patientId).name, kind, severity, message, to });
  return { ok: true, alert_id: Number(r.lastInsertRowid), delivered_to: to };
}

/** Real delivery is optional: set CARECUE_ALERT_WEBHOOK (e.g. an ntfy.sh topic URL) to push to a phone. */
async function deliver(payload: { patient: string; kind: string; severity: string; message: string; to: string }) {
  const url = process.env.CARECUE_ALERT_WEBHOOK;
  console.log(`[alert] ${payload.severity.toUpperCase()} ${payload.kind} -> ${payload.to}: ${payload.message}`);
  if (!url) return;
  try {
    const isNtfy = url.includes("ntfy.sh");
    await fetch(url, isNtfy
      ? {
          method: "POST",
          body: payload.message,
          headers: { Title: `CareCue: ${payload.patient}`, Priority: payload.severity === "urgent" ? "5" : "3", Tags: "pill" },
        }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch (err) {
    console.error("[alert] webhook delivery failed:", (err as Error).message);
  }
}

export function openAlerts(patientId: number): Alert[] {
  return db
    .prepare("SELECT * FROM alerts WHERE patient_id = ? AND acknowledged = 0 ORDER BY id DESC LIMIT 20")
    .all(patientId) as Alert[];
}

export function recentAlerts(patientId: number, limit = 20): Alert[] {
  return db.prepare("SELECT * FROM alerts WHERE patient_id = ? ORDER BY id DESC LIMIT ?").all(patientId, limit) as Alert[];
}

export function acknowledgeAlert(alertId: number) {
  db.prepare("UPDATE alerts SET acknowledged = 1 WHERE id = ?").run(alertId);
  return { ok: true };
}

export function recordCheckin(patientId: number, mood: string, note: string) {
  db.prepare("INSERT INTO checkins (patient_id, created_at, mood, note) VALUES (?, ?, ?, ?)").run(
    patientId,
    now().toISOString(),
    mood,
    note,
  );
  return { ok: true };
}

export function recentCheckins(patientId: number, limit = 5) {
  return db.prepare("SELECT * FROM checkins WHERE patient_id = ? ORDER BY id DESC LIMIT ?").all(patientId, limit);
}

/** Summary a caregiver would ask for: "How is Mom doing today?" */
export function caregiverBriefing(patientId: number) {
  const p = getPatient(patientId);
  return {
    patient: p.name,
    today: todaySchedule(patientId),
    adherence_7d: adherence(patientId, 7),
    refills: refillForecast(patientId).filter((r) => r.needs_refill),
    open_alerts: openAlerts(patientId).map((a) => ({ kind: a.kind, severity: a.severity, message: a.message, at: a.created_at })),
    alerts_today: recentAlerts(patientId, 30)
      .filter((a) => localDate(new Date(a.created_at)) === localDate(now()))
      .map((a) => ({
        kind: a.kind,
        severity: a.severity,
        sent_to: a.delivered_to,
        at: localTime(new Date(a.created_at)),
        status: a.acknowledged ? "resolved" : "open",
        message: a.message,
      })),
    recent_checkins: recentCheckins(patientId, 3),
  };
}

// ---------- the background tick ----------

/**
 * Runs every few seconds. Moves doses along: scheduled -> reminded (spoken reminder)
 * -> missed (after the grace period) -> caregiver alert (after escalate_after_minutes).
 * Also raises one refill alert per medication per day.
 */
export async function tick(): Promise<void> {
  const t = now();
  const date = localDate(t);
  for (const p of listPatients()) {
    const doses = dosesOn(p.id, date);
    const nowMin = toMinutes(localTime(t));

    // Group reminders by time so "8 AM: Metformin and Losartan" is one announcement.
    const toRemind = doses.filter((d) => d.status === "scheduled" && toMinutes(d.time) <= nowMin && nowMin - toMinutes(d.time) < p.grace_minutes);
    if (toRemind.length) {
      const stamp = t.toISOString();
      for (const d of toRemind) db.prepare("UPDATE doses SET status = 'reminded', reminded_at = ? WHERE id = ?").run(stamp, d.id);
      // Spoken out loud: name and amount only ("Losartan, 1 tablet"); strength and instructions stay on screen.
      const es = p.preferred_language === "es";
      const items = toRemind.map((d) => `${d.medication}, ${d.dose_text.split(",").pop()!.trim()}`);
      const list = items.length > 1 ? `${items.slice(0, -1).join(", ")}${es ? " y " : ", and "}${items.at(-1)}` : items[0];
      const many = items.length > 1;
      const text = es
        ? `${p.name}, es hora de tu remedio: ${list}. Avísame cuando ${many ? "te los tomes" : "te lo tomes"}.`
        : `${p.name}, it's time for your medicine: ${list}. Tell me when you've taken ${many ? "them" : "it"}.`;
      pushEvent({ kind: "reminder", text, patient_id: p.id });
    }

    for (const d of doses) {
      const late = nowMin - toMinutes(d.time);
      if ((d.status === "scheduled" || d.status === "reminded") && late >= p.grace_minutes) {
        db.prepare("UPDATE doses SET status = 'missed' WHERE id = ?").run(d.id);
        d.status = "missed";
      }
      if (d.status === "missed" && late >= p.escalate_after_minutes) {
        const already = db.prepare("SELECT 1 FROM alerts WHERE dose_id = ? AND kind = 'missed_dose'").get(d.id);
        if (!already) {
          await alertCaregivers(
            p.id,
            "missed_dose",
            "warning",
            p.preferred_language === "es"
              ? `${p.name} no ha confirmado ${d.medication} (${d.dose_text}) de ${spokenTimeEs(d.time)}. ${spokenTimeEs(localTime(t)).startsWith("la ") ? "Ya es" : "Ya son"} ${spokenTimeEs(localTime(t))}. Quizás convenga llamar.`
              : `${p.name} hasn't confirmed the ${spokenTime(d.time)} ${d.medication} (${d.dose_text}). It's now ${spokenTime(localTime(t))}. You may want to give ${p.name} a call.`,
            d.id,
          );
        }
      }
    }

    for (const r of refillForecast(p.id)) {
      if (!r.needs_refill) continue;
      const already = db
        .prepare("SELECT 1 FROM alerts WHERE patient_id = ? AND kind = 'refill' AND message LIKE ? AND created_at >= ?")
        .get(p.id, `%${r.medication}%`, atLocal(date, "00:00").toISOString());
      if (!already) {
        await alertCaregivers(
          p.id,
          "refill",
          "info",
          p.preferred_language === "es"
            ? `A ${p.name} le quedan unos ${r.days_left} días de ${r.medication} (${r.units_on_hand} pastillas). Hay que comprar más.`
            : `${p.name} has about ${r.days_left} day${r.days_left === 1 ? "" : "s"} of ${r.medication} left (${r.units_on_hand} tablets). Time to order a refill.`,
        );
      }
    }
  }
}
