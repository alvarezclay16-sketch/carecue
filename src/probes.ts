// Demo endpoints behind the wire tab: what the MCP server announced (/api/mcp-info) and three direct, labelled
// tool calls (/api/probe). A probe never calls a model. It shows what the SERVER does when a client misbehaves,
// because a well-prompted model usually asks a question on a hedge and never reaches the guard.

import * as care from "./care.ts";
import { agentToken } from "./agent-token.ts";
import { bridgeInfo, callToolDirect, mcpUrl, modelInfo } from "./agent.ts";
import { toolsFor } from "./mcp.ts";
import { buildToolTrace, type ToolTrace } from "./trace.ts";

export const PROBE_LABEL = "direct tool call - no model involved";
export const PROBE_IDS = ["hedged_log", "double_log", "remove_med"] as const;
export type ProbeId = (typeof PROBE_IDS)[number];
export const isProbeId = (id: unknown): id is ProbeId => typeof id === "string" && (PROBE_IDS as readonly string[]).includes(id);

// ---------- GET /api/mcp-info ----------

type Info = Record<string, unknown>;
let cached: Info | undefined;

/** The real initialize answer (read once from a live /mcp call), the 12 tools with titles and annotations, and who sees which. */
export async function mcpInfo(patientIdForHandshake: number): Promise<Info> {
  if (!cached) {
    const [{ handshake }, caregiver, patient] = await Promise.all([bridgeInfo(patientIdForHandshake), toolsFor("caregiver"), toolsFor("patient")]);
    cached = {
      transport: "streamable-http",
      stateless: true,
      protocolVersion: handshake.protocolVersion,
      serverInfo: handshake.serverInfo,
      capabilities: handshake.capabilities,
      tools: caregiver.map((t) => ({ name: t.name, title: t.title ?? null, annotations: t.annotations })),
      roles: { patient: patient.map((t) => t.name), caregiver: caregiver.map((t) => t.name) },
      instructions_chars: handshake.instructionsChars,
    };
  }
  return { ...cached, model: modelInfo() }; // the model can change between turns (failover), so it is read fresh
}

// ---------- POST /api/probe ----------

export type ProbeResult =
  | { status: 200; body: { probe: ProbeId; label: string; trace: ToolTrace; http?: { status: number; www_authenticate: string | null } } }
  | { status: 409; body: { error: string; hint: string; probe: ProbeId; label: string } };

const busy = (probe: ProbeId, error: string, hint: string): ProbeResult => ({ status: 409, body: { error, hint, probe, label: PROBE_LABEL } });

export async function runProbe(id: ProbeId, patientId: number): Promise<ProbeResult> {
  const schedule = care.todaySchedule(patientId);

  if (id === "hedged_log") {
    if (!schedule.due_now.length) return busy(id, "Nothing is due right now.", "start the morning scenario");
    const trace = await callToolDirect(patientId, "log_dose", { medication: "all_due", status: "taken", person_was_certain: false }, "probe");
    return { status: 200, body: { probe: id, label: PROBE_LABEL, trace } };
  }

  if (id === "double_log") {
    const taken = schedule.done_today.filter((d) => d.status === "taken");
    if (!taken.length) return busy(id, "Nothing has been taken yet.", "tap I took it first");
    // Prefer a medicine with no dose left today: that is the case the double-dose guard answers.
    const left = new Set(schedule.due_now.concat(schedule.next_up).map((d) => d.medication));
    const med = (taken.find((d) => !left.has(d.medication)) ?? taken[0]).medication;
    const trace = await callToolDirect(patientId, "log_dose", { medication: med, status: "taken", person_was_certain: true }, "probe");
    return { status: 200, body: { probe: id, label: PROBE_LABEL, trace } };
  }

  // remove_med: the patient's own token asks for an admin tool; the server answers 403 before any tool runs.
  const medication = care.medicationsOf(patientId)[0]?.name ?? "Metformin";
  const started = Date.now();
  const args = { medication };
  const res = await fetch(mcpUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${agentToken(patientId)}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stop_medication", arguments: args } }),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const www = res.headers.get("www-authenticate");
  const tools = await toolsFor("caregiver");
  const base = buildToolTrace({ name: "stop_medication", input: args, text, isError: true, ms: Date.now() - started, annotations: (tools.find((t) => t.name === "stop_medication")?.annotations ?? null) as ToolTrace["annotations"], source: "probe" });
  // The server refused the call before running it: report that as a refusal (nothing written), not as a tool error.
  const trace: ToolTrace = { ...base, ok: false, effect: "refused", result: { http_status: res.status, www_authenticate: www, body: base.result } };
  return { status: 200, body: { probe: id, label: PROBE_LABEL, trace, http: { status: res.status, www_authenticate: www } } };
}
