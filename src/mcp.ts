// CareCue MCP server: the tools Alexa+ (or any MCP client) calls.
// Transport: Streamable HTTP, stateless, MCP spec 2025-11-25.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { z } from "zod";
import * as care from "./care.ts";
import { linkFromAppToken } from "./households.ts";
import { demoPatientId } from "./db.ts";
import { verifyAgentToken } from "./agent-token.ts";

export const SERVER_INSTRUCTIONS = `CareCue is a medication companion for an older adult living at home, used by voice.
- Always check the log (check_what_i_took / get_today_schedule) before answering "did I take my pills?". Never guess.
- If log_dose returns a possible_double_dose warning, clearly tell the person not to take another dose.
- CareCue only follows the prescribed schedule. Never suggest changing, doubling, or skipping a dose; for any dosing or side-effect question, say to ask their doctor or pharmacist.
- If the person reports chest pain, trouble breathing, a fall, confusion, or anything that sounds like an emergency: tell them to call emergency services now, and use notify_caregiver with severity "urgent".
- Keep spoken answers short, warm, and concrete: say times as "8 AM", one idea per sentence.`;

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

const patientId = z
  .number()
  .int()
  .optional()
  .describe("Only needed when the device is shared by more than one person. Defaults to the household's main patient.");

export function buildServer(householdPatientId?: number): McpServer {
  // A household-scoped connection ignores patient_id from the model: it can only see its own home.
  const pid = (requested?: number) => care.getPatient(householdPatientId ?? requested ?? demoPatientId()).id;
  const server = new McpServer(
    { name: "carecue", title: "CareCue medication companion", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "get_today_schedule",
    {
      title: "Today's medication schedule",
      description:
        "What medicine is due right now, what's coming up next, and what has already been taken today. Use for 'what do I take now?', 'what's next?', 'what's left today?'.",
      inputSchema: { patient_id: patientId },
      annotations: { readOnlyHint: true },
    },
    async ({ patient_id }) => json(care.todaySchedule(pid(patient_id))),
  );

  server.registerTool(
    "log_dose",
    {
      title: "Log a dose",
      description:
        "Record that the person took (or chose to skip) a medication. Use medication='all_due' when they say 'I took my pills' without naming one. Returns a warning instead of logging if that dose was already taken (double-dose guard) or is too early.",
      inputSchema: {
        medication: z.string().describe("Medication name as on the schedule, e.g. 'Metformin', or 'all_due' for everything due now."),
        status: z.enum(["taken", "skipped"]).default("taken"),
        note: z.string().optional().describe("Anything the person mentioned, e.g. 'took it with lunch'."),
        patient_id: patientId,
      },
    },
    async ({ medication, status, note, patient_id }) =>
      json(care.logDose(pid(patient_id), medication, status, note ?? "")),
  );

  server.registerTool(
    "check_what_i_took",
    {
      title: "Did I take it?",
      description:
        "Answers 'did I already take my pills?' from the dose log: what was taken today and when, what is still due, and what comes later. Always use this instead of guessing.",
      inputSchema: {
        medication: z.string().optional().describe("Limit to one medication."),
        patient_id: patientId,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ medication, patient_id }) => json(care.whatHaveITaken(pid(patient_id), medication)),
  );

  server.registerTool(
    "list_medications",
    {
      title: "List medications",
      description: "All active medications with dose, instructions, and scheduled times.",
      inputSchema: { patient_id: patientId },
      annotations: { readOnlyHint: true },
    },
    async ({ patient_id }) =>
      json(
        care.medicationsOf(pid(patient_id)).map((m) => ({
          name: m.name,
          dose: m.dose,
          instructions: m.instructions,
          times: JSON.parse(m.times),
        })),
      ),
  );

  server.registerTool(
    "get_refill_status",
    {
      title: "Refill status",
      description: "How many days of each medication are left, and which ones need a refill soon.",
      inputSchema: { patient_id: patientId },
      annotations: { readOnlyHint: true },
    },
    async ({ patient_id }) => json(care.refillForecast(pid(patient_id))),
  );

  server.registerTool(
    "record_refill",
    {
      title: "Record a refill",
      description: "Add tablets to the supply after picking up a refill, e.g. 'I got 30 more Losartan'.",
      inputSchema: {
        medication: z.string(),
        units: z.number().positive().describe("Number of tablets/units added."),
        patient_id: patientId,
      },
    },
    async ({ medication, units, patient_id }) => json(care.recordRefill(pid(patient_id), medication, units)),
  );

  server.registerTool(
    "notify_caregiver",
    {
      title: "Message the caregiver",
      description:
        "Send a message to the person's caregivers (family). Use when they ask ('tell my son I'm OK'), when they report not feeling well, or with severity 'urgent' for anything that sounds like an emergency.",
      inputSchema: {
        message: z.string().describe("Plain-language message for the caregiver, in third person."),
        severity: z.enum(["info", "warning", "urgent"]).default("info"),
        kind: z.enum(["help", "wellbeing", "info"]).default("info"),
        patient_id: patientId,
      },
    },
    async ({ message, severity, kind, patient_id }) =>
      json(await care.alertCaregivers(pid(patient_id), kind, severity, message)),
  );

  server.registerTool(
    "record_checkin",
    {
      title: "Daily check-in",
      description: "Save how the person says they feel today (mood and any symptoms they mention), for the caregiver's daily summary.",
      inputSchema: {
        mood: z.string().describe("One or two words, e.g. 'good', 'tired', 'dizzy'."),
        note: z.string().optional(),
        patient_id: patientId,
      },
    },
    async ({ mood, note, patient_id }) => json(care.recordCheckin(pid(patient_id), mood, note ?? "")),
  );

  server.registerTool(
    "get_adherence",
    {
      title: "Adherence summary",
      description: "How many scheduled doses were taken, missed, or skipped over the last N days.",
      inputSchema: { days: z.number().int().min(1).max(90).default(7), patient_id: patientId },
      annotations: { readOnlyHint: true },
    },
    async ({ days, patient_id }) => json(care.adherence(pid(patient_id), days)),
  );

  server.registerTool(
    "caregiver_briefing",
    {
      title: "Caregiver briefing",
      description: "One-shot summary for a family member: today's doses, 7-day adherence, refills needed, open alerts, and recent check-ins. Use for 'how is Mom doing?'.",
      inputSchema: { patient_id: patientId },
      annotations: { readOnlyHint: true },
    },
    async ({ patient_id }) => json(care.caregiverBriefing(pid(patient_id))),
  );

  server.registerTool(
    "add_medication",
    {
      title: "Add a medication (caregiver setup)",
      description:
        "Add a prescribed medication to the schedule. Only use with details from the prescription label; confirm the name, dose and times back to the user before calling.",
      inputSchema: {
        name: z.string(),
        dose: z.string().describe("As written on the label, e.g. '10 mg, 1 tablet'."),
        times: z.array(z.string()).min(1).describe("Local times, e.g. ['08:00', '8:30 PM']."),
        instructions: z.string().optional(),
        units_on_hand: z.number().min(0).optional(),
        units_per_dose: z.number().positive().optional(),
        patient_id: patientId,
      },
    },
    async ({ patient_id, ...input }) => json(care.addMedication(pid(patient_id), input)),
  );

  server.registerTool(
    "stop_medication",
    {
      title: "Remove a medication (caregiver setup)",
      description: "Remove a medication from the schedule when the doctor has stopped it. Confirm with the user before calling.",
      inputSchema: { medication: z.string(), patient_id: patientId },
      annotations: { destructiveHint: true },
    },
    async ({ medication, patient_id }) => json(care.stopMedication(pid(patient_id), medication)),
  );

  server.registerResource(
    "today",
    "carecue://schedule/today",
    { title: "Today's schedule", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(care.todaySchedule(pid())) }],
    }),
  );

  server.registerPrompt(
    "morning_checkin",
    { title: "Morning check-in", description: "Start the day: greet, ask how they feel, go over the morning medicines." },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Good morning. Ask me how I'm feeling, save it with record_checkin, then tell me which medicines are due this morning.",
          },
        },
      ],
    }),
  );

  return server;
}

/** Express handler for POST /mcp. Stateless: a fresh server + transport per request. */
export async function handleMcp(req: Request, res: Response) {
  const scope = resolveScope(req.headers.authorization);
  if (scope === "denied") {
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    return;
  }
  const server = buildServer(scope);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

/**
 * Who is calling /mcp:
 * - "Bearer <app token>"               -> that household only (caregiver app, a household's own agent)
 * - "Bearer <internal agent token>"    -> the household the voice agent is serving
 * - "Bearer <CARECUE_MCP_TOKEN>"       -> the default household (single-home Alexa+ setup)
 * - no CARECUE_MCP_TOKEN configured    -> open, default household (local demo)
 */
function resolveScope(authorization?: string): number | undefined | "denied" {
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (bearer) {
    const internal = verifyAgentToken(bearer);
    if (internal) return internal;
    const link = linkFromAppToken(bearer);
    if (link) return link.patient_id;
  }
  const shared = process.env.CARECUE_MCP_TOKEN;
  if (!shared) return undefined;
  return bearer === shared ? undefined : "denied";
}
