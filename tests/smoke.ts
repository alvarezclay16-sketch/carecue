// End-to-end check against a running server: node tests/smoke.ts [baseUrl]
// Drives the MCP server like Alexa+ would, and moves the demo clock through a day.
// The server must be local and started with CARECUE_CLOCK_CONTROL=1 (the clock and /api/reset are 403 otherwise),
// a temp CARECUE_DB, and CARECUE_EVAL=1 if the model should not be limited. No model call is made here.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:8787";
const post = (p: string, body: unknown) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

const client = new Client({ name: "smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(base + "/mcp"));
await client.connect(transport);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse((r.content as Array<{ text: string }>)[0].text);
};

// The two safety prompts are byte-frozen (7 QA rounds). Import them with a throwaway DB so nothing real is touched.
{
  process.env.CARECUE_DB = path.join(mkdtempSync(path.join(tmpdir(), "carecue-frozen-")), "t.db");
  const frozen = JSON.parse(readFileSync(new URL("./frozen.json", import.meta.url), "utf8"));
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const { SERVER_INSTRUCTIONS, ADMIN_TOOLS, toolNamesFor } = await import("../src/mcp.ts");
  const patientTools = await toolNamesFor("patient");
  const caregiverTools = await toolNamesFor("caregiver");
  assert.equal(patientTools.length, 10);
  assert.equal(caregiverTools.length, 12);
  assert.deepEqual(caregiverTools.filter((n) => !patientTools.includes(n)).sort(), [...ADMIN_TOOLS].sort());
  const { SYSTEM } = await import("../src/agent.ts");
  assert.equal(sha(SERVER_INSTRUCTIONS), frozen.SERVER_INSTRUCTIONS, "SERVER_INSTRUCTIONS changed: it is frozen");
  assert.equal(sha(SYSTEM), frozen.SYSTEM, "SYSTEM changed: it is frozen");
  console.log("frozen prompts: hashes match");
}

await post("/api/reset", {});
console.log("protocol:", transport.protocolVersion ?? "(negotiated)");

// Roles are enforced by the server: an anonymous (patient) session lists 10 tools, a caregiver token lists 12.
const ADMIN = ["add_medication", "stop_medication"];
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const rpc = (id: number, method: string, params: unknown, headers: Record<string, string> = {}) =>
  fetch(base + "/mcp", { method: "POST", headers: { ...MCP_HEADERS, ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
const clientWith = async (token: string) => {
  const c = new Client({ name: "smoke-" + token.slice(0, 4), version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
};

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
assert.equal(tools.length, 10, "an anonymous session lists the 10 daily tools");
assert.ok(!tools.some((t) => ADMIN.includes(t.name)), "no admin tools without a caregiver token");

// A caregiver app token (from creating a household) lists all 12, with a title and annotations on every one.
const created = await post("/api/app/households", { patientName: "Smoke Test", caregiverName: "Caro", language: "en" });
assert.ok(created.token, "household created");
const caregiver = await clientWith(created.token);
const all = (await caregiver.listTools()).tools;
assert.equal(all.length, 12);
for (const t of all) {
  assert.ok(t.title, `${t.name} has a title`);
  assert.ok(t.annotations && typeof t.annotations.readOnlyHint === "boolean", `${t.name} has annotations`);
}
const ann = (n: string) => all.find((t) => t.name === n)!.annotations!;
assert.equal(ann("stop_medication").destructiveHint, true);
assert.equal(ann("log_dose").destructiveHint, false);
assert.equal(ann("log_dose").idempotentHint, true);
assert.equal(ann("get_today_schedule").readOnlyHint, true);
assert.equal(ann("notify_caregiver").openWorldHint, true);
assert.equal(ann("record_refill").idempotentHint, false);
console.log("annotations: 12/12 tools have a title and annotations");

// The caregiver can change medicines; a patient-role token and an anonymous call get 403 insufficient_scope.
const added = JSON.parse(((await caregiver.callTool({ name: "add_medication", arguments: { name: "Smokezol", dose: "5 mg", times: ["09:00"] } })).content as Array<{ text: string }>)[0].text);
assert.notEqual(added.ok, false, "caregiver add_medication works");
const paired = await fetch(base + "/api/app/pair-codes", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${created.token}` },
  body: JSON.stringify({ target: "app_patient" }),
}).then((r) => r.json());
const joined = await post("/api/app/join", { code: paired.code });
assert.equal(joined.role, "patient");
const patientApp = await clientWith(joined.token);
assert.equal((await patientApp.listTools()).tools.length, 10, "a patient app token lists 10 tools");
for (const headers of [{}, { Authorization: `Bearer ${joined.token}` }] as Array<Record<string, string>>) {
  const r = await rpc(9, "tools/call", { name: "stop_medication", arguments: { medication: "Smokezol" } }, headers);
  assert.equal(r.status, 403, "stop_medication from a non-caregiver is 403");
  const www = r.headers.get("www-authenticate") ?? "";
  assert.ok(www.includes("insufficient_scope") && www.includes("care:admin"), "WWW-Authenticate names the scope");
  assert.equal((await r.json()).error.code, -32003);
}
// a batch with an admin call hidden inside is refused as a whole
const batch = await fetch(base + "/mcp", {
  method: "POST",
  headers: MCP_HEADERS,
  body: JSON.stringify([
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add_medication", arguments: { name: "Sneaky", dose: "1", times: ["10:00"] } } },
  ]),
});
assert.equal(batch.status, 403);
const meds = JSON.parse(((await caregiver.callTool({ name: "list_medications", arguments: {} })).content as Array<{ text: string }>)[0].text);
assert.deepEqual(meds.map((m: { name: string }) => m.name), ["Smokezol"], "refused admin calls changed nothing");
await caregiver.callTool({ name: "stop_medication", arguments: { medication: "Smokezol" } });
assert.equal(JSON.parse(((await caregiver.callTool({ name: "list_medications", arguments: {} })).content as Array<{ text: string }>)[0].text).length, 0);
console.log("roles: patient 10 / caregiver 12, admin calls from others -> 403 insufficient_scope, data unchanged");

// The voice agent's own token is a patient token too (needs the server's CARECUE_SECRET to mint one here).
if (process.env.CARECUE_SECRET) {
  const { agentToken } = await import("../src/agent-token.ts");
  const demoMeds = await call("list_medications");
  const agent = await clientWith(agentToken(1));
  assert.equal((await agent.listTools()).tools.length, 10, "the agent token lists 10 tools");
  const r = await rpc(10, "tools/call", { name: "stop_medication", arguments: { medication: demoMeds[0].name } }, { Authorization: `Bearer ${agentToken(1)}` });
  assert.equal(r.status, 403);
  assert.ok((r.headers.get("www-authenticate") ?? "").includes("insufficient_scope"));
  assert.equal((await call("list_medications")).length, demoMeds.length, "the agent token could not remove a medicine");
  await agent.close();
  console.log("agent token: 10 tools, stop_medication -> 403, medicine still active");
}
await patientApp.close();
await caregiver.close();

// Origin check: a browser page from another site is refused; no Origin (SDK, Alexa+, curl) and the same origin are fine.
const init = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "1" } };
assert.equal((await rpc(11, "initialize", init, { Origin: "https://evil.example" })).status, 403, "foreign Origin is refused");
assert.equal((await rpc(12, "initialize", init, { Origin: "null" })).status, 403, "opaque Origin is refused");
assert.equal((await rpc(13, "initialize", init)).status, 200, "no Origin is fine");
assert.equal((await rpc(14, "initialize", init, { Origin: new URL(base).origin })).status, 200, "same-origin is fine");
const initBody = await (await rpc(15, "initialize", init)).text();
assert.ok(initBody.includes("2025-11-25"), "initialize answers protocol 2025-11-25");
console.log("origin check: evil.example -> 403, no Origin -> 200");

// Sandbox households, scenes, touch, probes and the MCP handshake: no model involved.
{
  const get = (p: string, id?: string) => fetch(base + p, { headers: id ? { "x-carecue-sandbox": id } : {} });
  const sbPost = (p: string, id: string | undefined, body: unknown) =>
    fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(id ? { "x-carecue-sandbox": id } : {}) }, body: JSON.stringify(body) });
  const state = async (id?: string) => (await get("/api/state", id)).json();

  const demo0 = await state();
  assert.ok(demo0.scene && demo0.device, "the shared demo state carries scene and device");
  assert.equal(demo0.device.clock_control, true, "this server controls its clock");
  assert.equal(demo0.device.emergency_number, "131");

  const info = await (await get("/api/mcp-info")).json();
  assert.equal(info.protocolVersion, "2025-11-25", "read from a real initialize response");
  assert.equal(info.tools.length, 12);
  assert.deepEqual([info.roles.patient.length, info.roles.caregiver.length], [10, 12]);
  assert.ok(info.tools.every((t: { annotations: unknown }) => t.annotations), "annotations on every tool");
  assert.ok(info.model?.id, "the model is named");

  const a = (await (await sbPost("/api/sandbox", undefined, { scenario: "morning" })).json()).sandbox_id as string;
  const b = (await (await sbPost("/api/sandbox", undefined, {})).json()).sandbox_id as string;
  assert.ok(a && b && a !== b);
  let st = await state(a);
  assert.equal(st.scene.kind, "reminder", "a fresh sandbox starts with a due reminder");
  assert.equal(st.alerts.length, 0);
  assert.equal(st.today.due_now.length, 2);
  assert.equal(st.sandbox, true);
  assert.equal((await get("/api/state", "sb_doesnotexist1")).status, 404);
  assert.equal((await (await get("/api/state", "sb_doesnotexist1")).json()).error, "sandbox_expired");

  // probes: labelled direct calls, no model
  const probe = async (id: string, sb = a) => sbPost("/api/probe", sb, { id });
  let r = await probe("hedged_log");
  let pj = await r.json();
  assert.equal(r.status, 200);
  assert.equal(pj.label, "direct tool call - no model involved");
  assert.equal(pj.trace.guard, "unconfirmed");
  assert.equal(pj.trace.effect, "refused");
  assert.equal(pj.trace.source, "probe");
  assert.equal((await state(a)).today.due_now.length, 2, "the refused hedge wrote nothing");
  assert.equal((await probe("double_log")).status, 409, "double_log before anything is taken");
  pj = await (await probe("remove_med")).json();
  assert.equal(pj.http.status, 403);
  assert.ok(pj.http.www_authenticate.includes("insufficient_scope"));
  assert.equal((await probe("nope")).status, 400);
  assert.equal((await state(a)).today.all_today.length, st.today.all_today.length, "remove_med removed nothing");

  // touch: the button goes through MCP log_dose with source 'touch'
  assert.equal((await sbPost("/api/device/touch", a, { action: "not_yet" })).status, 200);
  assert.equal((await state(a)).today.due_now.length, 2, "Not yet writes nothing");
  assert.equal((await sbPost("/api/device/touch", a, { action: "dance" })).status, 400);
  const took = await (await sbPost("/api/device/touch", a, { action: "took" })).json();
  assert.equal(took.trace.source, "touch");
  assert.equal(took.trace.name, "log_dose");
  assert.equal(took.scene.kind, "confirmed");
  assert.equal(took.ttl_s, 8);
  assert.equal(took.result.ok, true);
  const again = await (await sbPost("/api/device/touch", a, { action: "took" })).json();
  assert.deepEqual(again.scene, { kind: "not_written", reason: "nothing_due" });
  pj = await (await probe("double_log")).json();
  assert.equal(pj.trace.guard, "possible_double_dose");
  assert.equal((await probe("hedged_log")).status, 409, "hedged_log needs a dose due now");
  assert.equal((await state(b)).today.due_now.length, 2, "the other sandbox is untouched");

  // scenarios: deterministic states, isolated per sandbox
  const sc = async (id: string, sb: string) => (await sbPost(`/api/scenario/${id}`, sb, {})).json();
  assert.equal((await sc("hedged", a)).utterance, "I think I took it, maybe.");
  assert.equal((await state(a)).today.due_now.length, 2, "re-seeded: due again");
  assert.equal((await sc("extra", a)).utterance, "I'll take another one, just in case.");
  st = await state(a);
  assert.equal(st.today.done_today.length, 2);
  assert.equal(st.today.due_now.length, 0);
  const missed = await sc("missed", b);
  if (!missed.replay) {
    st = await state(b);
    assert.ok(st.alerts.some((x: { kind: string }) => x.kind === "missed_dose"), "missed: the family alert exists");
    assert.equal((await state(a)).alerts.length, 0, "the alert is private to its sandbox");
    assert.equal(st.scene.kind, "late");
  }
  const es = await sc("spanish", a);
  assert.equal(es.lang, "es");
  assert.equal((await state(a)).device.language, "es");
  assert.equal((await sc("chest", a)).utterance, "I don't feel good. I have a pain in my chest.");
  assert.equal((await state(a)).device.language, "en");
  assert.equal((await sbPost("/api/scenario/nope", a, {})).status, 404);

  // sample history, labelled; a real household never has it
  const week = await (await get("/api/week", a)).json();
  assert.equal(week.label, "Sample history (demo)");
  assert.ok(week.callouts.includes("Evening Metformin: confirmed late 4 of the last 7 days"));
  assert.ok(week.adherence.adherence_percent > 80);
  assert.ok(week.callouts.every((c: string) => !/should|recommend|poor|advice|consider/i.test(c)), "callouts are counts only");
  assert.equal(week.doses.length, 28);
  const real = await (await fetch(base + "/api/app/state", { headers: { authorization: `Bearer ${created.token}` } })).json();
  assert.equal(real.adherence.doses_due, 0, "a real household has no history");
  assert.equal(real.checkins.length, 0);
  console.log("sandbox: private morning, scenes, touch via MCP, labelled probes, isolation, sample week");
}

// 7:50 AM — nothing due yet.
await post("/api/clock", { time: "07:50" });
let s = await call("get_today_schedule");
assert.equal(s.due_now.length, 0);
assert.equal(s.next_up[0].time, "08:00");
// A bare MCP host has no context line: the household facts it needs travel in the tool result (additive; the text is unchanged).
assert.deepEqual(Object.keys(s.household).sort(), ["caregivers", "crisis_line", "emergency_number", "language"]);
assert.equal(s.household.language, "en");
assert.equal(s.household.emergency_number, "131", "the demo caregiver has a +56 number: Chile");
assert.equal(s.household.crisis_line, "*4141");
assert.deepEqual(s.household.caregivers, ["Daniel"]);

// 8:02 AM — reminder fires for Metformin + Losartan.
await post("/api/clock", { time: "08:02" });
const events = await fetch(base + "/api/events?since=0").then((r) => r.json());
const reminder = events.find((e: { kind: string }) => e.kind === "reminder");
assert.ok(reminder, "expected a spoken reminder");
console.log("reminder:", reminder.text);

// "I think I took them" -> nothing is written.
const hedged = await call("log_dose", { medication: "all_due", status: "taken", person_was_certain: false });
assert.equal(hedged.ok, false);
assert.deepEqual(hedged.warnings, ["unconfirmed"]);

// "I took my pills" -> logs both.
let log = await call("log_dose", { medication: "all_due", status: "taken", person_was_certain: true });
assert.equal(log.ok, true);
assert.equal(log.logged.length, 2);
console.log("log:", log.message);

// "Did I take my Losartan?" then the double-dose guard.
const took = await call("check_what_i_took", { medication: "losartan" });
assert.equal(took.taken.length, 1);
log = await call("log_dose", { medication: "Losartan", status: "taken", person_was_certain: true });
assert.equal(log.ok, false);
assert.ok(log.warnings.includes("possible_double_dose"));
console.log("double-dose guard:", log.message);

// Too early for the evening Metformin at 8 AM... it's 12 hours away.
log = await call("log_dose", { medication: "Metformin", status: "taken", person_was_certain: true });
assert.equal(log.ok, false);
assert.ok(log.warnings.includes("too_early"));

// Losartan started with 4 tablets -> refill alert.
const refills = await call("get_refill_status");
const losartan = refills.find((r: { medication: string }) => r.medication === "Losartan");
assert.equal(losartan.needs_refill, true);

// 8:00 PM reminder, nobody answers; 8:50 PM -> missed + caregiver alert.
await post("/api/clock", { time: "20:01" });
await post("/api/clock", { time: "20:50" });
const state = await fetch(base + "/api/state").then((r) => r.json());
const missed = state.alerts.find((a: { kind: string }) => a.kind === "missed_dose");
assert.ok(missed, "expected a missed-dose alert to the caregiver");
console.log("caregiver alert:", missed.message);

// Late confirmation clears the alert.
log = await call("log_dose", { medication: "Metformin", status: "taken", person_was_certain: true, note: "took it late" });
assert.equal(log.ok, true);
const after = await fetch(base + "/api/state").then((r) => r.json());
assert.equal(after.alerts.find((a: { id: number }) => a.id === missed.id).acknowledged, 1);

const brief = await call("caregiver_briefing");
console.log("briefing adherence:", brief.adherence_7d);

const urgent = await call("notify_caregiver", { message: "Rosa says she feels dizzy.", severity: "warning", kind: "wellbeing" });
assert.equal(urgent.ok, true);
assert.deepEqual(urgent.household.caregivers, ["Daniel"], "notify_caregiver also returns the household facts");
assert.equal(urgent.household.emergency_number, "131");

await post("/api/reset", {});
await client.close();
console.log("\nALL CHECKS PASSED");
