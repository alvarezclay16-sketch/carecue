// LLM-free check of the page strings (web/strings.js and the device table in web/app.js): node tests/i18n.ts
// Every English string has a Spanish one of the same shape (same keys, same function arity), the Spanish strings really are
// Spanish (no stray English words from the visitor-facing labels), and the wire formatter speaks both languages.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore: plain browser modules, no types
import { STR } from "../web/strings.js";
// @ts-ignore
import { badgeFor, lastToolText, unchangedText } from "../web/wire-format.js";

type Tree = { [k: string]: unknown };
function shape(node: unknown, path: string, out: string[]) {
  if (typeof node === "function") out.push(`${path}:fn${(node as (...a: unknown[]) => unknown).length}`);
  else if (typeof node === "string") out.push(`${path}:str`);
  else if (node && typeof node === "object") for (const k of Object.keys(node as Tree).sort()) shape((node as Tree)[k], `${path}.${k}`, out);
}
const en: string[] = [];
const es: string[] = [];
shape(STR.en, "STR", en);
shape(STR.es, "STR", es);
assert.deepEqual(es, en, "strings.js: Spanish has the same keys and function arities as English");
assert.ok(en.length > 120, `${en.length} strings`);

// The functions give text in both languages and never "undefined".
const sample = { pass2: 60, n: 60, pass1: 59, unsafe_replies: 0, provider: "Claude API", model: "claude-opus-5-5", date: "2026-10-12" };
for (const lang of ["en", "es"] as const) {
  const s = STR[lang];
  const texts = [
    s.rest.line(s.rest.why.noPrivate), s.rest.why.server("HTTP 503"), s.tour.modeLiveRun(3), s.tour.modeLiveRun(1), s.tour.stepOf(2, 6), s.tour.done(40, 3, 9, true), s.tour.done(40, 0, 2, false),
    s.tour.notAvailable("say", "timeout"), s.tour.notAvailable("setup", "HTTP 500"), s.tour.backToLang(s.tour.langName), s.phone.taken("8:02"), s.phone.subToday("Rosa", "8:02"),
    s.wire.safety(sample), s.wire.safetyTitle(sample), s.wire.whoNote("<code>x</code>"), s.wire.notePossible("busy", "wait"), s.wire.lastTool("log_dose", "WROTE", 42, "MODEL", true),
    s.wire.refusedHttp(403, "insufficient_scope", "care:admin"), s.wire.refusedNothing("too_early"), s.wire.notified("urgent"),
  ];
  for (const t of texts) assert.ok(typeof t === "string" && t.length > 3 && !/undefined|NaN|\[object/.test(t), `${lang}: ${t}`);
  for (const id of ["morning", "hedged", "took", "extra", "missed", "chest"]) assert.ok(s.tour.watch[id].length > 20, `${lang} tour watch ${id}`);
}

// Spanish visitor-facing labels carry no English function words.
const ENGLISH = /\b(the|and|with|your|Copy|Who sees|If the model|resting|Replay|real run|no model|tool call|Safety suite|Dose log|set-up|Step|watch for|alerts?|today)\b/i;
const walk = (node: unknown, path: string) => {
  if (typeof node === "string") {
    // tool names and protocol words stay as they are; strip them before looking for English
    const t = node.replace(/<[^>]+>/g, " ").replace(/\b(log_dose|stop_medication|person_was_certain|insufficient_scope|care:admin|MCP|Inspector|HTTP|JSON|npm run safety|Streamable|Claude|API)\b/g, " ");
    assert.ok(!ENGLISH.test(t), `Spanish string looks English at ${path}: ${node}`);
  } else if (node && typeof node === "object") for (const [k, v] of Object.entries(node as Tree)) walk(v, `${path}.${k}`);
};
walk(STR.es.replay, "replay");
walk(STR.es.noRecording, "noRecording");
for (const part of ["page", "rest", "tour", "phone", "wire"] as const) walk((STR.es as unknown as Tree)[part], part);

// The wire formatter takes the language table.
const ES = STR.es.wire;
const tr = (effect: string, input: unknown = {}, extra: Tree = {}) => ({ name: "log_dose", input, result: { ok: true }, ok: true, guard: null, ms: 42, source: "model", effect, ...extra });
assert.equal(badgeFor(tr("read"), ES).text, "LECTURA");
assert.equal(badgeFor(tr("wrote"), ES).text, "ESCRITURA");
assert.equal(badgeFor(tr("notified", { severity: "urgent" }), ES).text, "FAMILIA AVISADA - urgente");
assert.equal(badgeFor(tr("refused", {}, { guard: "too_early" }), ES).text, "RECHAZADO POR EL SERVIDOR - NADA ANOTADO - too_early");
assert.equal(badgeFor(tr("read")).text, "READ", "English is the default");
assert.equal(unchangedText(2, 2, true, ES), "Registro de dosis sin cambios");
assert.equal(lastToolText({ tag: "model", calls: [] }, ES), "última herramienta: ninguna (el modelo no llamó a ninguna)");
assert.equal(lastToolText({ tag: "touch", calls: [tr("wrote", {}, { source: "touch" })], replay: true }, ES), "última herramienta: log_dose - ESCRITURA - 42 ms - TOQUE (repetición)");

// The page applies the strings: every visitor-facing file reads them through ui.t() / T() and no stale English constants remain.
const web = (f: string) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
for (const f of ["tour.js", "wire.js"]) assert.ok(web(f).includes("ui.t()"), `${f} reads the language table`);
assert.ok(!/carecue:turn-end/.test(web("app.js") + web("wire.js")), "the unused turn-end event is gone");
assert.ok(!/clockState \?\? FX_CLOCK/.test(web("app.js")), "a live page never falls back to the fixture clock (no made-up 08:02)");
const html = web("index.html");
for (const key of ["page.tagline", "page.deviceNote", "phone.title", "phone.adherence", "phone.today", "phone.alerts", "page.tabWire", "tabPhone"]) assert.ok(html.includes(`"${key}"`), `index.html labels ${key}`);

// Replayed non-model steps say "no model"; the who-sees-what view has a title for every tool in both languages; speech synthesis is optional.
assert.equal(STR.en.replayNoModel, "no model");
assert.equal(STR.es.replayNoModel, "sin modelo");
assert.equal(STR.en.wire.replayNoModel, "no model");
assert.equal(STR.es.wire.replayNoModel, "sin modelo");
const TOOLS = ["get_today_schedule", "log_dose", "check_what_i_took", "list_medications", "get_refill_status", "record_refill", "notify_caregiver", "record_checkin", "get_adherence", "caregiver_briefing", "add_medication", "stop_medication"];
const mcpSrc = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
for (const name of TOOLS) {
  assert.ok(mcpSrc.includes(`"${name}"`), `${name} is a real tool`);
  assert.ok(STR.es.wire.toolTitles[name] && STR.es.wire.toolTitles[name] !== STR.en.wire.toolTitles[name], `ES title for ${name}`);
  assert.ok(mcpSrc.includes(`title: "${STR.en.wire.toolTitles[name]}"`), `EN title for ${name} matches the server's`);
}
assert.ok(web("tour.js").includes("replayNoModel") && web("app.js").includes("replayNoModel") && web("wire.js").includes("replayNoModel"), "tour strip, device badge and wire label append it");
// The ES phone shows one time format (24 h, two digits), also for the alert timestamps.
assert.ok(!/toLocaleTimeString\(P\.locale/.test(web("app.js")), "the alert time is not formatted by the browser locale (12 h next to a 24 h timeline)");
// No bare speechSynthesis (a webview without it must not break the page): every use goes through `synth` or window.speechSynthesis in a try.
for (const f of ["app.js", "tour.js", "chips.js", "wire.js"]) assert.ok(!/(^|[^.\w])speechSynthesis[.?]/m.test(web(f).replace(/\/\/.*$/gm, "")), `${f}: no bare speechSynthesis`);
assert.ok(web("app.js").includes('"speechSynthesis" in window'), "app.js guards speechSynthesis");

console.log("I18N CHECKS PASSED");
