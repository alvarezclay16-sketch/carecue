// A clock that can be shifted forward for demos ("it's now 8:40 PM").
// Everything in CareCue asks this module for the time, never Date.now() directly.

// Schedules are wall-clock times in the household timezone (one region per deployment).
process.env.TZ ??= process.env.CARECUE_TZ ?? "America/Santiago";

let offsetMs = 0;

export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

export function setNow(target: Date): void {
  offsetMs = target.getTime() - Date.now();
}

export function resetClock(): void {
  offsetMs = 0;
}

export function isShifted(): boolean {
  return Math.abs(offsetMs) > 1000;
}

/** Local calendar date, e.g. "2026-10-11". */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local wall-clock time, e.g. "08:00". */
export function localTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Builds a Date for a local date ("2026-10-11") and time ("08:00"). */
export function atLocal(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/** "las 5 y 51 de la tarde" style for Spanish speech (never "menos" or AM/PM). */
export function spokenTimeEs(time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const part = hh === 12 ? "del día" : hh < 6 ? "de la madrugada" : hh < 12 ? "de la mañana" : hh < 20 ? "de la tarde" : "de la noche";
  const min = mm === 0 ? "" : mm === 30 ? " y media" : ` y ${mm}`;
  return `${h12 === 1 ? "la" : "las"} ${h12}${min} ${part}`;
}

/** "8:00 AM" style for speech. */
export function spokenTime(time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  const suffix = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}
