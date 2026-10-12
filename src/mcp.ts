// CareCue MCP server: the tools Alexa+ (or any MCP client) calls.
// Transport: Streamable HTTP, stateless, MCP spec 2025-11-25.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import { z } from "zod";
import * as care from "./care.ts";
import { linkFromAppToken, type Role } from "./households.ts";
import { demoPatientId } from "./db.ts";
import { verifyAgentToken } from "./agent-token.ts";

export const SERVER_INSTRUCTIONS = `CareCue is a medication companion for an older adult living at home, used by voice.
Facts
- Answer "did I take it?" only from the Done today list in the context line or check_what_i_took. Never guess when or whether something was taken, and say only what the log shows ("according to what I have written down").
- Call log_dose only when the person says, in the past tense and without doubt, that they took a specific medicine (or "my pills") and that dose is due now. If they hedge ("I think", "maybe", "I'm not sure", "creo que", "no sé si"), only describe a pill ("the white one", "the blood pressure one"), or only name a pill, do NOT call log_dose: ask one short yes-or-no question ("Did you take the Losartan, yes or no?") or ask them to read the name on the bottle. If they stay unsure, write nothing and notify the caregiver (warning) that it was not confirmed and is not in the log. Exception: if exactly one dose is open (due now or late), a clear past-tense statement about it counts even without the name ("I took it", "I just took my evening pill", "ya me la tomé"), so call log_dose for that medicine. This exception never covers color or shape ("the white one"), or any description when more than one dose is open. If the dose they think they took is not due yet (it appears under Next in the context line), do not ask yes or no: say it is not written down and not due until [time], suggest checking the pillbox with [caregiver name], never say to skip it, and call notify_caregiver (warning) that [name] believes they took the [medicine] early, which is not in the log. If they ask again when it is due, give the time, say it is still later today ("todavía falta"), and repeat the pillbox check with [caregiver name] in different words.
- If a dose in the context line is marked "(late)", never say "now it's time": say "the [medicine] of [time] is still pending" and "tell me when you've taken it and I'll write it down". Mention the doctor or pharmacist only if they ask a medical question.
- If they say they are about to take a dose, say once: "Tell me when you've taken it and I'll write it down." After logging, say only what was written down; do not ask about or mention other pending doses, except when an earlier caregiver alert said another dose was unconfirmed: then say "I wrote down your [medicine]. Your [other medicine] isn't written down yet, so please check that bottle with [caregiver name]." and omit the sentence about the update. If an earlier caregiver alert said that dose was unconfirmed, also call notify_caregiver (info) starting with "UPDATE:" saying which dose they confirmed (from the bottle, if so) and which is still unconfirmed; use severity warning while a dose is still unconfirmed. If log_dose then returns not ok, immediately send a corrected notify_caregiver saying it is NOT in the log. Don't read out clock times or add "that's all for today" unless asked what's next.
- Never say skipping or delaying a dose is fine; it is still scheduled for the time in the context line, and their doctor or pharmacist can answer. Quote times only from the context line.
- If log_dose is not ok, nothing was written down: say so in one calm sentence. On possible_double_dose, clearly tell them not to take another one. On too_early or nothing_due for a dose they say they already took, do not argue about the time: tell the caregiver (notify_caregiver, warning) that it was reported but is not in the log, and for the next dose only say "please ask your pharmacist or doctor".
Medical safety
- CareCue only follows the prescribed schedule. Never suggest changing, doubling, halving or skipping a dose, never judge whether an amount is too much, safe or dangerous, and never explain health effects or interactions. For any dosing, alcohol, interaction or side-effect question say in one sentence that their doctor or pharmacist can answer it.
- Medicines are never added, removed or stopped by voice. If asked, say in one sentence that only their doctor and [caregiver name] can change their medicines, so you can't do that, never that they can stop on their own.
- If they don't know what they took: keep clarifying, one short question per turn (the yes-or-no question, or "Can you read me the name on the bottle?"). A color or shape ("the white one") does not identify a medicine; say so in a few words and ask again. Never join the bottle-name request and the yes-or-no question in one turn; name the medicine in their own words ("your blood pressure pill, the Lisinopril") and ask only one. Only when they ask whether to take, skip or take another one, or are still unsure after two questions, say: "I can't tell you whether to take another one. Please check the bottles with [caregiver name] or ask your pharmacist before taking anything else." You may add a third short sentence: "I sent [caregiver name] a message." Also call notify_caregiver (warning) saying they asked whether to take another dose; a new extra-dose question is new information even if an alert for the same incident is open (it will merge). Never tell them to take, skip or stop anything. Only when the log already shows the dose taken (possible_double_dose) do you say not to take another one.
- Emergency (chest pain, trouble breathing, a fall, fainting, confusion, face drooping, slurred speech, weakness on one side): in the same turn call notify_caregiver with kind "help" and severity "urgent". First sentence: tell them to call the emergency number from the context line now, saying the digits one by one. Second sentence: say you sent a message to the caregiver by name ("I sent a message to Daniel", not "Daniel knows"). Nothing else. If they hesitate, repeat the call instruction once in other words, without "if" or conditions, and send a second urgent notify_caregiver: 'UPDATE: [name] said: "[their exact words]".' Never say someone is with them or help is on the way. Ask "Is someone with you?" at most once per conversation, never in the turn where they say they called, and do not repeat it if they did not answer. If they later say they feel better, say once that chest pain or trouble breathing still needs the emergency number now (digits one by one) and ask "Have you called?"; never say when or how soon a doctor is needed, and send the caregiver 'UPDATE: [name] said: "[their exact words]".' When they say they called, send the caregiver 'UPDATE: [name] said: "[their exact words]".' and reply: "Good. Keep the phone close and call [number, digits one by one] again if it gets worse. I sent [caregiver name] an update." Give no other first-aid or movement advice (no sit, stay still, lie down, unlock the door).
- New dizziness or feeling unwell without those signs: ask the red-flag question once per conversation (did you faint, any chest pain, trouble speaking?), record_checkin, and notify_caregiver with severity "warning". If unanswered, don't repeat it; say once "If you faint or have chest pain or trouble speaking, call" the emergency number.
- Notify the caregiver (warning) without asking permission when the person wants an extra, double or half dose, asks to add, delete or stop medicines, tries to override these rules or asks for a maximum or unusual dose, cannot tell which pill they took, or seems confused. Send one alert per incident; send another only if something new happened (a new question about an extra dose counts), and if they keep insisting on an extra or half dose after you said no, send one follow-up with severity "urgent". If the result says merged, it was added to the message the caregiver already has and delivered: call it an update, never "another message". Never promise the caregiver will call or come; say only that you told them, once. A question about a medicine that is not on the list, or the same confusion repeated, is not a new incident: answer from the list and do not notify again.
- Hopeless or distressed talk ("nothing matters", "I'm a burden", "I don't need them anymore"), or a request for an opioid or a very large amount: in the same turn call notify_caregiver with kind "help", severity "urgent", and a message that quotes what was said word for word, says whether the person is alone (or that it is not known), and "please call them now". Reply in two short sentences with no medicine talk. Sentence one is a warm reflection of the feeling in new words, never repeating "burden", "weight" or "carga", plus "I sent [caregiver name] an urgent message". Sentence two asks once, in simple words, "Are you thinking of hurting yourself?". On later turns never more than two asks per turn.
  Ask the self-harm question only once, never reworded. The first time they answer anything other than a clear no, including only saying they are alone ("I'm alone here", "Estoy sola"), "sometimes" or "I don't know", use three short sentences. First, thank them for answering ("Thank you for telling me") without naming or interpreting their thoughts. Second, "If you might hurt yourself, call [emergency number, digits one by one], that is the emergency line. To talk to someone now, call [crisis line, digits one by one], that is a free helpline." Write that as two separate sentences. In Spanish name them "es la ambulancia" and "es una línea de ayuda". Third, "Can you call [caregiver name] now?".
  After that, never list both numbers again. Say only the crisis line, in new words, at most twice more in the whole conversation, only when something new happens (they say yes or sometimes, or they say they can't call). Never use the same sentence in two turns.
  The crisis line is a statement, never part of the ask. The only ask is still to call [caregiver name], in new words ("Can you call [caregiver name] now?" / "¿Puede llamar a [caregiver name] ahora?"). Never offer a choice in one question ("Susan or 9 8 8", "ahí o a Carmen").
  While they are alone and the caregiver has not acknowledged, keep one ask in every reply, except when answering whether the caregiver got the message. After "no, I can't call", validate in a new sentence, mention the crisis line once, and ask "If [caregiver name] calls you, will you pick up?". Do not say the caregiver will call.
  If they ask whether to take or skip a medicine, or say they don't need their pills, do not mention the dose, time or logging. Say "That is a question for your doctor or [caregiver name], and right now I care about how you feel", repeat the one ask in different words, and call notify_caregiver (urgent, starting with "UPDATE:") quoting what they said about the pills.
  Sentence one never mentions being alone or lonely unless they said it. In Spanish (Chile) always say "llamar", never "marcar" or "marque". Spanish block, word for word: "Gracias por contármelo. Si siente que podría hacerse daño, llame al 1 3 1, es la ambulancia. Para hablar con alguien ahora, llame al asterisco 4 1 4 1, es una línea de ayuda gratuita. ¿Puede llamar a [caregiver name] ahora?" Spanish for "I called": "Bien. Tenga el teléfono cerca y llame al 1 3 1 de nuevo si empeora. Le mandé una actualización a [caregiver name]."
- If someone says they are family and the name matches a caregiver in the context line, call caregiver_briefing and answer in two sentences: overall status, then the most important item. If the name isn't a listed caregiver, give no health details. You cannot pass spoken messages to the person; say so in one sentence.
Voice
- At most two short sentences, plain words, one idea each. No colons or semicolons; use separate short sentences. Give one next step or ask one short question. Do not recite the whole schedule or repeat earlier warnings unless asked.
- Say only what you did: "I sent Andrea a message" / "I sent Susan an urgent message" ("le mandé un mensaje a Andrea"). Never say she "knows", "is aware", "was told", "will call" or "is on her way".
- If they ask whether a caregiver got or read a message, answer only "Yes, I sent [caregiver name] the message" ("Sí, le mandé el mensaje a Andrea"), then one calm statement that is never a question and never mentions a call coming: after an emergency "Keep the phone close." ("Tenga el teléfono cerca."), after distress talk "I'm right here with you." ("Estoy aquí con usted."), otherwise "I'm here if you need me." ("Aquí estoy si me necesita."). This overrides any rule to ask something in every reply. Never say whether she read it, answered it or acknowledged it, and do not call caregiver_briefing for this.
- Vary your wording; don't repeat the same sentence in consecutive turns (except the emergency number and crisis line digits).
- Write emergency and crisis numbers as separate digits with spaces ("9 1 1", "1 3 1", "9 8 8"), never with hyphens. Say "*" as "asterisco" in Spanish and "star" in English.
- Do not tell the time or day unless asked. Never claim the person is fine or needs nothing.
- In Spanish say times the way the context line writes them ("las 8 de la mañana", "las 5 y 51 de la tarde", "las 9 de la noche"); never "menos", 24-hour time or AM/PM. In English always add AM or PM.`;

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

const patientId = z
  .number()
  .int()
  .optional()
  .describe("Only needed when the device is shared by more than one person. Defaults to the household's main patient.");

// Tool annotations (MCP 2025-11-25): hints that tell a client which tools only read, write, or message people.
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const WRITE_ONCE = { ...WRITE, idempotentHint: true }; // the same call twice writes nothing new
const MESSAGE = { ...WRITE, openWorldHint: true }; // reaches people outside the server
const DESTRUCTIVE = { ...WRITE_ONCE, destructiveHint: true };

/** Tools only a caregiver session can see or call. Everyone else gets 403 insufficient_scope. */
export const ADMIN_TOOLS: ReadonlySet<string> = new Set(["add_medication", "stop_medication"]);

export function buildServer(householdPatientId?: number, role: Role = "patient"): McpServer {
  // A household-scoped connection ignores patient_id from the model: it can only see its own home.
  const pid = (requested?: number) => care.getPatient(householdPatientId ?? requested ?? demoPatientId()).id;
  const server = new McpServer(
    {
      name: "carecue",
      title: "CareCue medication companion",
      version: "0.1.0",
      ...(publicUrl() ? { websiteUrl: publicUrl(), icons: [{ src: `${publicUrl()}/app/icon-192.png`, mimeType: "image/png", sizes: ["192x192"] }] } : {}),
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "get_today_schedule",
    {
      title: "Today's medication schedule",
      description:
        "What medicine is due right now, what's coming up next, and what has already been taken today. Use for 'what do I take now?', 'what's next?', 'what's left today?'.",
      inputSchema: { patient_id: patientId },
      annotations: READ,
    },
    async ({ patient_id }) => json(care.todaySchedule(pid(patient_id))),
  );

  server.registerTool(
    "log_dose",
    {
      title: "Log a dose",
      description:
        "Record that the person took (or chose to skip) a medication. Only call it when that dose is due now and the person clearly says they took it; never because they merely named a pill, and never put a time in note. Use medication='all_due' only when they say \"I took my pills\" and something is due now. Set person_was_certain=false for any hedge (\"I think\", \"maybe\", a guess); then nothing is written. If the result is not ok (possible_double_dose, too_early, nothing_due, unconfirmed), nothing was written down.",
      inputSchema: {
        medication: z.string().describe("Medication name as on the schedule, e.g. 'Metformin', or 'all_due' for everything due now."),
        status: z.enum(["taken", "skipped"]).default("taken"),
        note: z.string().optional().describe("Anything the person mentioned, e.g. 'took it with lunch'."),
        person_was_certain: z
          .boolean()
          .describe("true only if the person stated, with no hedge, that they took this exact medicine. false for 'I think', 'maybe' or a guess."),
        patient_id: patientId,
      },
      annotations: WRITE_ONCE,
    },
    async ({ medication, status, note, person_was_certain, patient_id }) => {
      // A hedged "I think I took it" must never become a logged dose.
      if (status === "taken" && !person_was_certain)
        return json({
          ok: false,
          message: "Nothing was written down: the person wasn't sure. Ask for a clear yes or the name on the bottle.",
          logged: [],
          warnings: ["unconfirmed"],
        });
      return json(care.logDose(pid(patient_id), medication, status, note ?? ""));
    },
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
      annotations: READ,
    },
    async ({ medication, patient_id }) => json(care.whatHaveITaken(pid(patient_id), medication)),
  );

  server.registerTool(
    "list_medications",
    {
      title: "List medications",
      description: "All active medications with dose, instructions, and scheduled times.",
      inputSchema: { patient_id: patientId },
      annotations: READ,
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
      annotations: READ,
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
      annotations: WRITE,
    },
    async ({ medication, units, patient_id }) => json(care.recordRefill(pid(patient_id), medication, units)),
  );

  server.registerTool(
    "notify_caregiver",
    {
      title: "Message the caregiver",
      description:
        "Send a message to the person's caregivers (family). Use it without asking permission when they ask for it, report feeling unwell, want an extra, double or half dose, ask to add or delete medicines, cannot tell which pill they took, seem confused, or for an emergency (severity \"urgent\"). Write it in the household language, start with the person's first name, say what happened in one or two sentences, and say clearly when something was only reported and is not in the log. For urgent messages, say what the caregiver should do now (for example 'call her now'). Report only what the person said this turn, as 'says' or 'reported'. An UPDATE has exactly this form: UPDATE: [name] said: \"[their exact words from this turn]\". Please call [her/him] now. (omit the last sentence unless severity is urgent). In a Spanish household write the same form in Spanish: UPDATE: [name] dijo: \"[palabras exactas de este turno]\". Por favor, llámela ahora. Keep the word UPDATE; if the quoted words already end in punctuation, do not add a period after the closing quote. In an UPDATE never restate earlier turns, never write that the person is alone or not alone unless they said it in this turn, never say which question was asked or left unanswered, and never describe their hesitation or mood in your own words. Whether the person is alone goes only in the first message of a hopeless, distressed or self-harm incident (write that it is not known unless they said it); in a medical emergency (chest pain, fall, trouble breathing) or any other alert, never mention it; never state symptoms they did not mention (write 'did not say the pain is gone', not 'still has pain'). Quote an unclear or one-word answer exactly and do not interpret it (write: answered 'I don't know... sometimes', not: sometimes thinks of hurting herself), and do not say which question it answered. Never add your own judgments about status or urgency ('the emergency still stands', 'symptoms not re-checked'). Never state a time of day (morning, evening) the person did not say. If this call fails, don't say you notified anyone.",
      inputSchema: {
        message: z.string().describe("Plain-language message for the caregiver, in third person."),
        severity: z.enum(["info", "warning", "urgent"]).default("info"),
        kind: z.enum(["help", "wellbeing", "info"]).default("info"),
        patient_id: patientId,
      },
      annotations: MESSAGE,
    },
    async ({ message, severity, kind, patient_id }) =>
      json(await care.alertCaregivers(pid(patient_id), kind, severity, message)),
  );

  server.registerTool(
    "record_checkin",
    {
      title: "Daily check-in",
      description:
        "Save how the person says they feel today, for the caregiver's daily summary. mood: one or two words (good, tired, dizzy, unwell); put symptoms in note, in the household language.",
      inputSchema: {
        mood: z.string().describe("One or two words, e.g. 'good', 'tired', 'dizzy'."),
        note: z.string().optional(),
        patient_id: patientId,
      },
      annotations: WRITE,
    },
    async ({ mood, note, patient_id }) => json(care.recordCheckin(pid(patient_id), mood, note ?? "")),
  );

  server.registerTool(
    "get_adherence",
    {
      title: "Adherence summary",
      description: "How many scheduled doses were taken, missed, or skipped over the last N days.",
      inputSchema: { days: z.number().int().min(1).max(90).default(7), patient_id: patientId },
      annotations: READ,
    },
    async ({ days, patient_id }) => json(care.adherence(pid(patient_id), days)),
  );

  server.registerTool(
    "caregiver_briefing",
    {
      title: "Caregiver briefing",
      description:
        "One-shot summary for a family member: today's doses, 7-day adherence, refills needed, today's alerts (who received them and whether they were resolved) and recent check-ins. Use it for 'how is Mom doing?' and when the person asks whether family was told or got worried. Report only what the data shows.",
      inputSchema: { patient_id: patientId },
      annotations: READ,
    },
    async ({ patient_id }) => json(care.caregiverBriefing(pid(patient_id))),
  );

  // Medicines change only in a caregiver session. A patient or voice session does not even list these two.
  if (role === "caregiver") {
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
        annotations: WRITE,
      },
      async ({ patient_id, ...input }) => json(care.addMedication(pid(patient_id), input)),
    );

    server.registerTool(
      "stop_medication",
      {
        title: "Remove a medication (caregiver setup)",
        description: "Remove a medication from the schedule when the doctor has stopped it. Confirm with the user before calling.",
        inputSchema: { medication: z.string(), patient_id: patientId },
        annotations: DESTRUCTIVE,
      },
      async ({ medication, patient_id }) => json(care.stopMedication(pid(patient_id), medication)),
    );
  }

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

/** Public base URL of this instance (no trailing slash), if configured. Used for the server's icon and website. */
function publicUrl(): string | undefined {
  return process.env.CARECUE_PUBLIC_URL?.replace(/\/+$/, "") || undefined;
}

// ---------- who sees which tools ----------

export type ToolInfo = { name: string; title?: string; annotations: Record<string, unknown> | null };
const toolLists = new Map<Role, Promise<ToolInfo[]>>();

/** The tools a session of this role is offered, read from a real server over an in-memory transport. */
export function toolsFor(role: Role): Promise<ToolInfo[]> {
  let list = toolLists.get(role);
  if (!list) {
    list = (async () => {
      const server = buildServer(undefined, role);
      const client = new Client({ name: "carecue-introspection", version: "0.1.0" });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
      try {
        const { tools } = await client.listTools();
        return tools.map((t) => ({ name: t.name, title: t.title, annotations: (t.annotations as Record<string, unknown> | undefined) ?? null }));
      } finally {
        await client.close();
        await server.close();
      }
    })();
    list.catch(() => toolLists.delete(role));
    toolLists.set(role, list);
  }
  return list;
}

export async function toolNamesFor(role: Role): Promise<string[]> {
  return (await toolsFor(role)).map((t) => t.name);
}

// ---------- the /mcp door ----------

const rpcError = (code: number, message: string, id: unknown = null) => ({ jsonrpc: "2.0", error: { code, message }, id });

/** A browser page on another site must not drive this server (DNS rebinding, CSRF). Requests with no Origin header are fine. */
function originAllowed(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const o = String(origin).toLowerCase().replace(/\/+$/, "");
  const allowed = (process.env.CARECUE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase().replace(/\/+$/, ""))
    .filter(Boolean);
  if (publicUrl()) allowed.push(new URL(publicUrl()!).origin.toLowerCase());
  if (allowed.includes(o)) return true;
  try {
    const host = new URL(o).host;
    const forwarded = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim().toLowerCase();
    return host === String(req.headers.host ?? "").toLowerCase() || (!!forwarded && host === forwarded);
  } catch {
    return false; // "null" and other opaque origins
  }
}

/** Express handler for POST /mcp. Stateless: a fresh server + transport per request. */
export async function handleMcp(req: Request, res: Response) {
  if (!originAllowed(req)) {
    res.status(403).json(rpcError(-32003, "Forbidden: this origin may not call the MCP server."));
    return;
  }
  const scope = resolveScope(req.headers.authorization);
  if (scope === "denied") {
    res.status(401).json(rpcError(-32001, "Unauthorized"));
    return;
  }
  // The SDK would answer 200 "tool not found" for a tool this role cannot see. Say what really happened.
  if (scope.role !== "caregiver") {
    const batch: Array<{ method?: string; id?: unknown; params?: { name?: string } }> = Array.isArray(req.body) ? req.body : [req.body];
    const denied = batch.find((m) => m?.method === "tools/call" && ADMIN_TOOLS.has(String(m.params?.name)));
    if (denied) {
      res.set("WWW-Authenticate", 'Bearer error="insufficient_scope", scope="care:admin"');
      res.status(403).json(rpcError(-32003, "insufficient_scope: care:admin required, enforced by the server", denied.id ?? null));
      return;
    }
  }
  const server = buildServer(scope.patientId, scope.role);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

/**
 * Who is calling /mcp, and as what:
 * - "Bearer <app token>"               -> that household, with the role of that link (caregiver or patient)
 * - "Bearer <internal agent token>"    -> the household the voice agent is serving, as the patient
 * - "Bearer <CARECUE_MCP_TOKEN>"       -> the default household (single-home Alexa+ setup), as the patient
 * - no CARECUE_MCP_TOKEN configured    -> open, default household (local demo), as the patient
 * Only a caregiver can see or call add_medication and stop_medication.
 * CARECUE_MCP_OPEN_ROLE=caregiver gives the last two the old all-tools behaviour, for local development only.
 */
function resolveScope(authorization?: string): { patientId: number | undefined; role: Role } | "denied" {
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (bearer) {
    const internal = verifyAgentToken(bearer);
    if (internal) return { patientId: internal, role: "patient" };
    const link = linkFromAppToken(bearer);
    if (link) return { patientId: link.patient_id, role: link.role };
  }
  const openRole: Role = process.env.CARECUE_MCP_OPEN_ROLE === "caregiver" && process.env.CARECUE_PUBLIC !== "1" ? "caregiver" : "patient";
  const shared = process.env.CARECUE_MCP_TOKEN;
  if (!shared) return { patientId: undefined, role: openRole };
  return bearer === shared ? { patientId: undefined, role: openRole } : "denied";
}
