import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.CARECUE_DATA_DIR ?? path.join(import.meta.dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.CARECUE_DB ?? path.join(DATA_DIR, "carecue.db"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  grace_minutes INTEGER NOT NULL DEFAULT 30,      -- how long a dose can wait before it counts as missed
  escalate_after_minutes INTEGER NOT NULL DEFAULT 45, -- when a missed dose alerts the caregiver
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS caregivers (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT ''                 -- phone or email; delivery is simulated unless a webhook is set
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT NOT NULL,                              -- free text from the prescription, e.g. "850 mg, 1 tablet"
  instructions TEXT NOT NULL DEFAULT '',           -- e.g. "with food"
  times TEXT NOT NULL,                             -- JSON array of "HH:MM" local times
  units_per_dose REAL NOT NULL DEFAULT 1,
  units_on_hand REAL NOT NULL DEFAULT 0,
  refill_threshold_days INTEGER NOT NULL DEFAULT 5,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS doses (
  id INTEGER PRIMARY KEY,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                              -- local date "YYYY-MM-DD"
  time TEXT NOT NULL,                              -- local time "HH:MM"
  status TEXT NOT NULL DEFAULT 'scheduled',        -- scheduled | reminded | taken | skipped | missed
  reminded_at TEXT,
  resolved_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (medication_id, date, time)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  dose_id INTEGER REFERENCES doses(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,                              -- missed_dose | refill | wellbeing | help
  severity TEXT NOT NULL DEFAULT 'info',           -- info | warning | urgent
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_to TEXT NOT NULL DEFAULT '',
  acknowledged INTEGER NOT NULL DEFAULT 0
);

-- Who can reach a household: an Alexa account, or an install of the mobile app.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                              -- alexa | app
  role TEXT NOT NULL,                              -- patient | caregiver
  secret_hash TEXT NOT NULL UNIQUE,                -- sha256 of the Alexa userId or of the app token
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- Short-lived 4-digit codes to connect Alexa or another phone to a household.
CREATE TABLE IF NOT EXISTS pair_codes (
  code TEXT PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  target TEXT NOT NULL,                            -- alexa | app_patient | app_caregiver
  expires_at TEXT NOT NULL
);

-- Alexa reminders created for a household, so they can be replaced when the schedule changes.
CREATE TABLE IF NOT EXISTS alexa_reminders (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  alert_token TEXT NOT NULL,
  time TEXT NOT NULL,
  schedule_hash TEXT NOT NULL
);

-- A private demo household per visitor (additive). The id travels in the x-carecue-sandbox header.
CREATE TABLE IF NOT EXISTS sandboxes (
  id TEXT PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
`);

export type Patient = {
  id: number;
  name: string;
  preferred_language: string;
  grace_minutes: number;
  escalate_after_minutes: number;
  is_demo: number;
};

export type Medication = {
  id: number;
  patient_id: number;
  name: string;
  dose: string;
  instructions: string;
  times: string;
  units_per_dose: number;
  units_on_hand: number;
  refill_threshold_days: number;
  active: number;
};

export type Dose = {
  id: number;
  medication_id: number;
  patient_id: number;
  date: string;
  time: string;
  status: "scheduled" | "reminded" | "taken" | "skipped" | "missed";
  reminded_at: string | null;
  resolved_at: string | null;
  note: string;
};

export type Alert = {
  id: number;
  patient_id: number;
  dose_id: number | null;
  kind: string;
  severity: string;
  message: string;
  created_at: string;
  delivered_to: string;
  acknowledged: number;
};

export type Caregiver = {
  id: number;
  patient_id: number;
  name: string;
  relationship: string;
  contact: string;
};

/** Called with the demo patient id each time seedDemo creates the household (src/sample.ts adds the sample history). */
export const demoSeedHooks: Array<(patientId: number) => void> = [];

/** Demo household: Rosa (78) and her son Daniel, who gets the alerts. */
export function seedDemo(): void {
  if (db.prepare("SELECT 1 FROM patients WHERE is_demo = 1").get()) return;

  const p = db
    .prepare("INSERT INTO patients (name, preferred_language, is_demo) VALUES (?, ?, 1)")
    .run("Rosa", "en");
  const patientId = Number(p.lastInsertRowid);

  db.prepare("INSERT INTO caregivers (patient_id, name, relationship, contact) VALUES (?, ?, ?, ?)").run(
    patientId,
    "Daniel",
    "son",
    "+56 9 0000 0000",
  );

  const addMed = db.prepare(
    `INSERT INTO medications (patient_id, name, dose, instructions, times, units_per_dose, units_on_hand, refill_threshold_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  addMed.run(patientId, "Metformin", "850 mg, 1 tablet", "with breakfast and dinner", JSON.stringify(["08:00", "20:00"]), 1, 22, 5);
  addMed.run(patientId, "Losartan", "50 mg, 1 tablet", "in the morning", JSON.stringify(["08:00"]), 1, 4, 5);
  addMed.run(patientId, "Atorvastatin", "20 mg, 1 tablet", "at night", JSON.stringify(["21:00"]), 1, 30, 5);
  for (const hook of demoSeedHooks) hook(patientId);
}

/** Resets only the demo household; real households are never touched. */
export function resetDemo(): void {
  db.exec("DELETE FROM patients WHERE is_demo = 1;");
  seedDemo();
}

export function demoPatientId(): number {
  seedDemo();
  return (db.prepare("SELECT id FROM patients WHERE is_demo = 1").get() as { id: number }).id;
}
