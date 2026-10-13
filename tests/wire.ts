// LLM-free unit test of the wire tab's formatting (web/wire-format.js): node tests/wire.ts
// A trace from the server becomes a chip with badge text AND a color (never color alone); secrets never render.
// Also checks that the web files keep the hooks the recorder and the tour rely on.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildToolTrace, type ToolAnnotations } from "../src/trace.ts";
// @ts-ignore: plain browser module, no types
import { PROBE_LABEL, TAGS, argsSummary, badgeFor, lastToolText, prettyJson, redact, unchangedText } from "../web/wire-format.js";

const READ: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const MESSAGE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const trace = (name: string, input: unknown, result: unknown, ann: ToolAnnotations, source: "model" | "probe" | "touch" = "model", isError = false) =>
  buildToolTrace({ name, input, text: JSON.stringify(result), isError, ms: 42, annotations: ann, source });

// ---------- badges: text + tone for every effect ----------
let b = badgeFor(trace("get_today_schedule", {}, { due_now: [] }, READ));
assert.deepEqual([b.text, b.tone], ["READ", "green"]);
b = badgeFor(trace("log_dose", { medication: "all_due" }, { ok: true, warnings: [] }, WRITE, "touch"));
assert.deepEqual([b.text, b.tone], ["WROTE", "amber"]);
b = badgeFor(trace("notify_caregiver", { severity: "warning", message: "x" }, { ok: true }, MESSAGE));
assert.deepEqual([b.text, b.tone], ["FAMILY NOTIFIED - warning", "blue"]);
b = badgeFor(trace("notify_caregiver", { severity: "urgent", message: "x" }, { ok: true }, MESSAGE));
assert.equal(b.text, "FAMILY NOTIFIED - urgent");
for (const g of ["unconfirmed", "possible_double_dose", "too_early", "nothing_due", "not_found"]) {
  b = badgeFor(trace("log_dose", {}, { ok: false, warnings: [g] }, WRITE, "probe"));
  assert.equal(b.text, `REFUSED BY SERVER - NOTHING WRITTEN - ${g}`);
  assert.equal(b.tone, "red");
}
b = badgeFor(trace("log_dose", {}, "Something broke", WRITE, "model", true));
assert.deepEqual([b.text, b.tone], ["ERROR", "grey"]);

// the 403 probe: the refusal is read from the real WWW-Authenticate header, not hard-coded
const http403 = { ...trace("stop_medication", { medication: "Metformin" }, {}, WRITE, "probe"), effect: "refused", result: { http_status: 403, www_authenticate: 'Bearer error="insufficient_scope", scope="care:admin"', body: {} } };
b = badgeFor(http403 as never);
assert.equal(b.text, "REFUSED BY SERVER - HTTP 403 insufficient_scope care:admin");
assert.equal(b.tone, "red");
assert.match(b.note ?? "", /server, not the prompt/);

// ---------- args summary: 40 characters at most ----------
assert.equal(argsSummary({ medication: "all_due", status: "taken" }), 'medication="all_due", status="taken"');
const long = argsSummary({ message: "Rosa says she does not feel good and has a pain in her chest right now" });
assert.equal(long.length, 40);
assert.ok(long.endsWith("…"));
assert.equal(argsSummary(null), "");

// ---------- expandable JSON: 2 KB cap, no secrets ----------
const big = prettyJson({ result: "x".repeat(5000) });
assert.ok(big.length < 2048 + 80, `capped (${big.length})`);
assert.match(big, /more characters not shown/);
assert.ok(prettyJson({ a: 1 }).length < 30);
const dirty = redact({ authorization: "Bearer abc.def", headers: { "x-api-key": "k", Cookie: "c" }, text: "sent Bearer abc123XYZ", ok: 1, nested: [{ token: "t" }] });
assert.equal(dirty.authorization, "[redacted]");
assert.equal(dirty.headers["x-api-key"], "[redacted]");
assert.equal(dirty.headers.Cookie, "[redacted]");
assert.equal(dirty.text, "sent Bearer [redacted]");
assert.equal(dirty.nested[0].token, "[redacted]");
assert.equal(dirty.ok, 1);
assert.equal(redact('Bearer error="insufficient_scope", scope="care:admin"'), 'Bearer error="insufficient_scope", scope="care:admin"', "a WWW-Authenticate challenge is not a secret");
assert.doesNotMatch(prettyJson({ input: { medication: "x" }, result: { www_authenticate: "Bearer error=\"insufficient_scope\"", note: "Bearer eyJhbGciOi.secret" } }), /eyJhbGciOi/);

// ---------- "dose log unchanged" chip (client diff of done_today) ----------
assert.equal(unchangedText(2, 2, false), "No tool called - dose log unchanged");
assert.equal(unchangedText(2, 2, true), "Dose log unchanged");
assert.equal(unchangedText(1, 2, true), null, "a dose was written: no chip");
assert.equal(unchangedText(null, 2, false), null, "unknown before: no chip");

// ---------- the last-tool chip ----------
const notified = trace("notify_caregiver", { severity: "warning", message: "x" }, { ok: true }, MESSAGE);
assert.equal(lastToolText({ tag: "model", calls: [notified] }), "last tool: notify_caregiver - FAMILY NOTIFIED - warning - 42 ms - MODEL");
assert.equal(lastToolText({ tag: "model", calls: [] }), "last tool: none (the model called no tool)");
assert.equal(lastToolText({ tag: "touch", calls: [] }), "");
assert.match(lastToolText({ tag: "model", calls: [notified], replay: true }), /\(replay\)$/);
assert.deepEqual(TAGS, { model: "MODEL", touch: "TOUCH", probe: "PROBE" });
assert.equal(PROBE_LABEL, "direct tool call - no model involved");

// ---------- the web files keep their hooks ----------
const web = (f: string) => readFileSync(path.join(import.meta.dirname, "..", "web", f), "utf8");
const html = web("index.html");
for (const id of ["caption-user", "caption-reply", "wire-mount", "tour-play", "tour-strip", "try-chips", "last-tool"]) assert.ok(html.includes(`id="${id}"`), `#${id}`);
for (const t of ["07:58", "08:01", "13:00", "20:01", "20:50", "21:01"]) assert.ok(html.includes(`data-time="${t}"`), `data-time ${t}`);
assert.ok(html.includes('data-lang="es-CL"') && html.includes('data-lang="en-US"'));
const app = web("app.js");
for (const hook of ["ask,", "ring,", "refresh,", "pollEvents,", "highlightOver,", "carecueDemo", "carecueUI"]) assert.ok(app.includes(hook), `app.js hook ${hook}`);
assert.ok(app.includes('Q.get("wire") === "1"') && app.includes('Q.get("clean") === "1"'), "?wire=1 and ?clean=1");
assert.ok(/key\.toLowerCase\(\) === "x"/.test(app), "key X toggles the wire tab");
const wire = web("wire.js");
assert.ok(wire.includes("/api/mcp-info") && wire.includes("/api/model") && wire.includes("/api/safety") && wire.includes("/api/probe"));
assert.ok(wire.includes("--cli") && wire.includes("--transport http"), "inspector command");
assert.ok(!/localStorage|sessionStorage/.test(wire), "the wire view stores nothing");
const tour = web("tour.js");
assert.ok(tour.includes("STEP_TIMEOUT_MS = 25_000"), "25 s step timeout");
assert.equal(tour.match(/\{ id: "\w+", kind: "say"/g)?.length, 3, "exactly three model turns in the tour");
assert.equal(tour.match(/\{ id: "\w+", kind: "(setup|touch|say)"/g)?.length, 6, "six steps");
assert.ok(tour.includes("Replay of a real run"), "replay label");

// The judge-proof page (static checks; the browser checks live in video/judge-check.mjs).
for (const id of ["scenario-chips", "start-over", "sandbox-note", "rest-note", "replay-badge", "nomic-banner", "week-strip", "week-callouts", "week-sample"]) assert.ok(html.includes(`id="${id}"`), `#${id}`);
assert.ok(html.includes('<body class="no-clock">'), "the demo bar starts hidden until the server says the clock may move");
assert.ok(html.includes("Try it in 60 seconds"), "'Try it in 60 seconds' panel");
assert.ok(app.includes("x-carecue-sandbox") && app.includes("sandbox_expired") && app.includes("clock_control"), "sandbox header, silent re-creation, clock_control");
assert.ok(app.includes("!SR") && app.includes("no speech recognition") && app.includes("disabled = true"), "typed fallback when SpeechRecognition is missing");
const chips = web("chips.js");
for (const id of ["extra", "hedged", "missed", "chest", "spanish"]) assert.ok(chips.includes(`id: "${id}"`), `chip ${id}`);
assert.ok(chips.includes("STEP_TIMEOUT_MS = 25_000") && chips.includes("playRecorded"), "chips replay when the model cannot be used");
const replay = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "web", "replay", "tour.json"), "utf8"));
assert.equal(replay.version, 1);
for (const id of ["morning", "hedged", "took", "extra", "missed", "chest", "spanish"]) assert.ok(replay.steps.some((x: { id: string }) => x.id === id), `replay step ${id}`);
assert.ok(replay.steps.every((x: { replay?: unknown }) => !x.replay), "a recording never contains a replay");

console.log("WIRE CHECKS PASSED");
