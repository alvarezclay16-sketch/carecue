// Pure formatting for the MCP wire tab (no DOM): what a tool call looks like as a chip.
// Kept separate so tests/wire.ts can run it under Node.

import { STR } from "./strings.js";

const JSON_CAP = 2048; // bytes of pretty JSON shown when a chip is expanded
export const PROBE_LABEL = "direct tool call - no model involved";

// ---------- never show a secret ----------
const SECRET_KEY = /authorization|token|secret|api[_-]?key|password|cookie/i;
export function redact(value) {
  if (typeof value === "string") return value.replace(/(Bearer\s+)(?![A-Za-z_]+=)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]"); // not a challenge like: Bearer error="..."
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]));
  }
  return value;
}

export function prettyJson(value, cap = JSON_CAP, w = STR.en.wire) {
  const text = JSON.stringify(redact(value), null, 2) ?? "";
  return text.length > cap ? `${text.slice(0, cap)}\n${w.moreChars(text.length - cap)}` : text;
}

// ---------- chip text and badges (always text plus color, never color alone) ----------
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function argsSummary(input) {
  if (!input || typeof input !== "object") return "";
  const parts = Object.entries(input).map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`);
  return short(parts.join(", "), 40);
}

/** Parses `error="insufficient_scope", scope="care:admin"` out of a WWW-Authenticate header. */
function wwwParts(header) {
  const get = (k) => new RegExp(`${k}="?([^",\\s]+)"?`).exec(header ?? "")?.[1] ?? null;
  return { error: get("error"), scope: get("scope") };
}

/** {text, tone, note?} for one trace. Tones: green read, amber wrote, red refused, blue notified, grey error. `w`: STR[lang].wire. */
export function badgeFor(t, w = STR.en.wire) {
  if (t.effect === "refused") {
    const r = t.result;
    if (r && typeof r === "object" && "http_status" in r) {
      const p = wwwParts(r.www_authenticate);
      return { text: w.refusedHttp(r.http_status, p.error, p.scope), tone: "red", note: w.refusedNote };
    }
    return { text: w.refusedNothing(t.guard), tone: "red" };
  }
  if (t.effect === "notified") {
    const sev = t.input && typeof t.input === "object" ? t.input.severity : null;
    return { text: w.notified(sev), tone: "blue" };
  }
  if (t.effect === "read") return { text: w.read, tone: "green" };
  if (t.effect === "wrote") return { text: w.wrote, tone: "amber" };
  return { text: w.error, tone: "grey" };
}

// English names of the tags (the recorder and the tests read these); the page shows STR[lang].wire.tags.
export const TAGS = { model: "MODEL", touch: "TOUCH", probe: "PROBE" };

/** The text of the one-line "last tool" chip under the device caption. */
export function lastToolText(turn, w = STR.en.wire) {
  if (!turn.calls.length) return turn.tag === "model" ? w.lastToolNone : "";
  const t = turn.calls[turn.calls.length - 1];
  return w.lastTool(t.name, badgeFor(t, w).text, t.ms, w.tags[t.source] ?? w.tags.model, !!turn.replay);
}

/** The grey chip after a turn: only when the number of doses taken/skipped today is the same before and after. */
export function unchangedText(before, after, calledTools, w = STR.en.wire) {
  if (before == null || after == null || before !== after) return null;
  return calledTools ? w.unchangedCalled : w.unchangedNone;
}
