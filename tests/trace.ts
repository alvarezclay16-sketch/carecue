// LLM-free unit test of the ToolTrace builder (src/trace.ts): node tests/trace.ts
// Fixture tool results for each effect, guard and source. No server and no database.

import assert from "node:assert/strict";
import { buildToolTrace, capStrings, effectOf, guardOf, type ToolAnnotations } from "../src/trace.ts";

const READ: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MESSAGE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const t = (name: string, result: unknown, o: { isError?: boolean; ann?: ToolAnnotations | null; source?: "model" | "probe" | "touch"; raw?: string } = {}) =>
  buildToolTrace({
    name,
    input: { x: 1 },
    text: o.raw ?? JSON.stringify(result),
    isError: o.isError ?? false,
    ms: 12.4,
    annotations: o.ann === undefined ? null : o.ann,
    source: o.source,
  });

// read
let tr = t("get_today_schedule", { due_now: [], next_up: [] }, { ann: READ });
assert.equal(tr.effect, "read");
assert.equal(tr.ok, null);
assert.equal(tr.guard, null);
assert.equal(tr.ms, 12);
assert.equal(tr.source, "model", "source defaults to model");
assert.deepEqual(tr.input, { x: 1 });
assert.deepEqual(tr.annotations, READ);

// wrote
tr = t("log_dose", { ok: true, logged: [{ medication: "Metformin" }], warnings: [] }, { ann: WRITE, source: "touch" });
assert.equal(tr.effect, "wrote");
assert.equal(tr.ok, true);
assert.equal(tr.source, "touch");

// refused, one per guard code
for (const g of ["unconfirmed", "possible_double_dose", "too_early", "nothing_due", "not_found"] as const) {
  tr = t("log_dose", { ok: false, message: "Nothing was written down", logged: [], warnings: [g] }, { ann: WRITE, source: "probe" });
  assert.equal(tr.effect, "refused", g);
  assert.equal(tr.guard, g);
  assert.equal(tr.ok, false);
  assert.equal(tr.source, "probe");
}
assert.equal(guardOf({ warnings: ["something_else", "too_early"] }), "too_early", "first known code wins");
assert.equal(guardOf({ warnings: ["something_else"] }), null);
assert.equal(guardOf({ warnings: "nope" }), null);
assert.equal(guardOf("plain text"), null);

// notified
tr = t("notify_caregiver", { ok: true, delivered: 1 }, { ann: MESSAGE });
assert.equal(tr.effect, "notified");
assert.equal(t("notify_caregiver", { ok: false }, { ann: MESSAGE }).effect, "error", "a message that did not go out is not 'notified'");

// error: a failed call is an error whatever the tool is, and non-JSON text is kept as text
tr = t("get_today_schedule", null, { isError: true, ann: READ, raw: "Tool error: boom" });
assert.equal(tr.effect, "error");
assert.equal(tr.isError, true);
assert.equal(tr.result, "Tool error: boom");
assert.equal(tr.ok, null);
assert.equal(t("stop_medication", null, { isError: true, raw: "x" }).effect, "error");

// no annotations known yet: falls back to what the result says
assert.equal(t("record_refill", { ok: true }).effect, "wrote");
assert.equal(t("record_refill", { ok: false, message: "unknown medicine" }).effect, "refused");
assert.equal(effectOf("anything", null, false, null), "wrote");

// parsed result is capped at 4000 chars per string, arrays and objects are copied
const big = "x".repeat(9000);
tr = t("check_what_i_took", { taken: [{ note: big }], short: "ok" }, { ann: READ });
const res = tr.result as { taken: Array<{ note: string }>; short: string };
assert.equal(res.taken[0].note.length, 4001);
assert.ok(res.taken[0].note.endsWith("…"));
assert.equal(res.short, "ok");
const src = { a: [big] };
assert.notEqual(capStrings(src), src);
assert.equal(src.a[0].length, 9000, "input untouched");

// the trace is plain JSON (it goes straight into the /api/chat response)
assert.deepEqual(JSON.parse(JSON.stringify(tr)).effect, "read");
console.log("TRACE CHECKS PASSED");
