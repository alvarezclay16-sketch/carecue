// Pure formatting for the MCP wire tab (no DOM): what a tool call looks like as a chip.
// Kept separate so tests/wire.ts can run it under Node.

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

export function prettyJson(value, cap = JSON_CAP) {
  const text = JSON.stringify(redact(value), null, 2) ?? "";
  return text.length > cap ? `${text.slice(0, cap)}\n... (${text.length - cap} more characters not shown)` : text;
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

/** {text, tone, note?} for one trace. Tones: green read, amber wrote, red refused, blue notified, grey error. */
export function badgeFor(t) {
  if (t.effect === "refused") {
    const r = t.result;
    if (r && typeof r === "object" && "http_status" in r) {
      const w = wwwParts(r.www_authenticate);
      return {
        text: `REFUSED BY SERVER - HTTP ${r.http_status}${w.error ? ` ${w.error}` : ""}${w.scope ? ` ${w.scope}` : ""}`,
        tone: "red",
        note: "Enforced by the server, not the prompt. Nothing ran.",
      };
    }
    return { text: `REFUSED BY SERVER - NOTHING WRITTEN${t.guard ? ` - ${t.guard}` : ""}`, tone: "red" };
  }
  if (t.effect === "notified") {
    const sev = t.input && typeof t.input === "object" ? t.input.severity : null;
    return { text: `FAMILY NOTIFIED${sev ? ` - ${sev}` : ""}`, tone: "blue" };
  }
  if (t.effect === "read") return { text: "READ", tone: "green" };
  if (t.effect === "wrote") return { text: "WROTE", tone: "amber" };
  return { text: "ERROR", tone: "grey" };
}



export const TAGS = { model: "MODEL", touch: "TOUCH", probe: "PROBE" };

/** The text of the one-line "last tool" chip under the device caption. */
export function lastToolText(turn) {
  if (!turn.calls.length) return turn.tag === "model" ? "last tool: none (the model called no tool)" : "";
  const t = turn.calls[turn.calls.length - 1];
  return `last tool: ${t.name} - ${badgeFor(t).text} - ${t.ms} ms - ${TAGS[t.source] ?? "MODEL"}${turn.replay ? " (replay)" : ""}`;
}

/** The grey chip after a turn: only when the number of doses taken/skipped today is the same before and after. */
export function unchangedText(before, after, calledTools) {
  if (before == null || after == null || before !== after) return null;
  return calledTools ? "Dose log unchanged" : "No tool called - dose log unchanged";
}
