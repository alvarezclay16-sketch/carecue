// End-to-end check against a running server: node tests/smoke.ts [baseUrl]
// Drives the MCP server like Alexa+ would, and moves the demo clock through a day.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";

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

await post("/api/reset", {});
console.log("protocol:", transport.protocolVersion ?? "(negotiated)");

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
assert.ok(tools.length >= 12);

// 7:50 AM — nothing due yet.
await post("/api/clock", { time: "07:50" });
let s = await call("get_today_schedule");
assert.equal(s.due_now.length, 0);
assert.equal(s.next_up[0].time, "08:00");

// 8:02 AM — reminder fires for Metformin + Losartan.
await post("/api/clock", { time: "08:02" });
const events = await fetch(base + "/api/events?since=0").then((r) => r.json());
const reminder = events.find((e: { kind: string }) => e.kind === "reminder");
assert.ok(reminder, "expected a spoken reminder");
console.log("reminder:", reminder.text);

// "I took my pills" -> logs both.
let log = await call("log_dose", { medication: "all_due", status: "taken" });
assert.equal(log.ok, true);
assert.equal(log.logged.length, 2);
console.log("log:", log.message);

// "Did I take my Losartan?" then the double-dose guard.
const took = await call("check_what_i_took", { medication: "losartan" });
assert.equal(took.taken.length, 1);
log = await call("log_dose", { medication: "Losartan", status: "taken" });
assert.equal(log.ok, false);
assert.ok(log.warnings.includes("possible_double_dose"));
console.log("double-dose guard:", log.message);

// Too early for the evening Metformin at 8 AM... it's 12 hours away.
log = await call("log_dose", { medication: "Metformin", status: "taken" });
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
log = await call("log_dose", { medication: "Metformin", status: "taken", note: "took it late" });
assert.equal(log.ok, true);
const after = await fetch(base + "/api/state").then((r) => r.json());
assert.equal(after.alerts.find((a: { id: number }) => a.id === missed.id).acknowledged, 1);

const brief = await call("caregiver_briefing");
console.log("briefing adherence:", brief.adherence_7d);

const urgent = await call("notify_caregiver", { message: "Rosa says she feels dizzy.", severity: "warning", kind: "wellbeing" });
assert.equal(urgent.ok, true);

await post("/api/reset", {});
await client.close();
console.log("\nALL CHECKS PASSED");
