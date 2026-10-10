// Households, the mobile app's tokens, and the 4-digit codes that connect Alexa or a second phone.

import { createHash, randomBytes, randomInt } from "node:crypto";
import { db, type Patient } from "./db.ts";
import { now } from "./clock.ts";

export type Role = "patient" | "caregiver";
export type Link = { id: number; patient_id: number; kind: "alexa" | "app"; role: Role; label: string };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function createHousehold(input: {
  patientName: string;
  language?: string;
  caregiverName: string;
  caregiverRelationship?: string;
  caregiverPhone?: string;
}) {
  const p = db
    .prepare("INSERT INTO patients (name, preferred_language) VALUES (?, ?)")
    .run(input.patientName.trim(), input.language === "es" ? "es" : "en");
  const patientId = Number(p.lastInsertRowid);
  db.prepare("INSERT INTO caregivers (patient_id, name, relationship, contact) VALUES (?, ?, ?, ?)").run(
    patientId,
    input.caregiverName.trim(),
    input.caregiverRelationship?.trim() ?? "",
    input.caregiverPhone?.trim() ?? "",
  );
  const token = issueAppToken(patientId, "caregiver", input.caregiverName);
  return { patientId, token };
}

export function issueAppToken(patientId: number, role: Role, label = ""): string {
  const token = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO links (patient_id, kind, role, secret_hash, label, created_at) VALUES (?, 'app', ?, ?, ?, ?)").run(
    patientId,
    role,
    sha(token),
    label,
    now().toISOString(),
  );
  return token;
}

export function linkFromAppToken(token: string | undefined): Link | undefined {
  if (!token) return undefined;
  return db.prepare("SELECT id, patient_id, kind, role, label FROM links WHERE kind = 'app' AND secret_hash = ?").get(sha(token)) as
    | Link
    | undefined;
}

export function linkFromAlexaUser(userId: string): Link | undefined {
  return db.prepare("SELECT id, patient_id, kind, role, label FROM links WHERE kind = 'alexa' AND secret_hash = ?").get(sha(userId)) as
    | Link
    | undefined;
}

export function newPairCode(patientId: number, target: "alexa" | "app_patient" | "app_caregiver") {
  db.prepare("DELETE FROM pair_codes WHERE expires_at < ?").run(now().toISOString());
  let code = "";
  for (let i = 0; i < 20; i++) {
    code = String(randomInt(1000, 10000));
    if (!db.prepare("SELECT 1 FROM pair_codes WHERE code = ?").get(code)) break;
  }
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  db.prepare("INSERT OR REPLACE INTO pair_codes (code, patient_id, target, expires_at) VALUES (?, ?, ?, ?)").run(
    code,
    patientId,
    target,
    expires.toISOString(),
  );
  return { code, expires_at: expires.toISOString() };
}

function takeCode(raw: string, target: string) {
  const code = String(raw).replace(/\D/g, "").padStart(4, "0");
  const row = db
    .prepare("SELECT * FROM pair_codes WHERE code = ? AND target = ? AND expires_at >= ?")
    .get(code, target, new Date().toISOString()) as { patient_id: number } | undefined;
  if (row) db.prepare("DELETE FROM pair_codes WHERE code = ?").run(code);
  return row;
}

/** "Alexa, my code is 4821" → this Alexa account now belongs to that household. */
export function linkAlexa(userId: string, code: string): Link | undefined {
  const row = takeCode(code, "alexa");
  if (!row) return undefined;
  db.prepare("DELETE FROM links WHERE kind = 'alexa' AND secret_hash = ?").run(sha(userId));
  const r = db
    .prepare("INSERT INTO links (patient_id, kind, role, secret_hash, label, created_at) VALUES (?, 'alexa', 'patient', ?, 'Alexa', ?)")
    .run(row.patient_id, sha(userId), now().toISOString());
  return { id: Number(r.lastInsertRowid), patient_id: row.patient_id, kind: "alexa", role: "patient", label: "Alexa" };
}

/** A second phone joins with a code from the caregiver's app. */
export function joinWithCode(code: string): { token: string; role: Role; patientId: number } | undefined {
  for (const target of ["app_patient", "app_caregiver"] as const) {
    const row = takeCode(code, target);
    if (row) {
      const role: Role = target === "app_patient" ? "patient" : "caregiver";
      return { token: issueAppToken(row.patient_id, role), role, patientId: row.patient_id };
    }
  }
  return undefined;
}

export function alexaLinked(patientId: number): boolean {
  return !!db.prepare("SELECT 1 FROM links WHERE patient_id = ? AND kind = 'alexa'").get(patientId);
}

export function patientLanguage(patient: Patient): "en" | "es" {
  return patient.preferred_language === "es" ? "es" : "en";
}
