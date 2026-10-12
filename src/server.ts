// One process serves everything CareCue needs:
//   /mcp        MCP server for Alexa+ and any MCP client (Streamable HTTP, spec 2025-11-25)
//   /alexa      Alexa custom skill endpoint (works on any Echo today)
//   /api/app/*  the mobile app (caregiver + senior modes), one household per token
//   /api/*      the web simulator used for the demo video
//   /           the simulator itself; /app the mobile web app

import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { handleMcp } from "./mcp.ts";
import { alexaHandlers } from "./alexa.ts";
import * as care from "./care.ts";
import { demoPatientId, resetDemo, seedDemo } from "./db.ts";
import {
  alexaLinked,
  createHousehold,
  joinWithCode,
  linkFromAppToken,
  newPairCode,
  type Link,
} from "./households.ts";
import { atLocal, isShifted, localDate, localTime, now, resetClock, setNow, spokenTime } from "./clock.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const DEMO = process.env.CARECUE_DEMO !== "0";

seedDemo();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Alexa needs the raw body for signature checks, so it goes before the JSON parser.
app.post("/alexa", ...alexaHandlers());

app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- MCP ----------
app.post("/mcp", (req, res) => {
  handleMcp(req, res).catch((err) => {
    console.error("[mcp]", err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  });
});
app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());
app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());

// ---------- model availability ----------
const hasModelCredentials = () =>
  !!(
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN
  );

async function agentReply(res: Response, patientId: number, conversationId: string, text: string) {
  if (!text) return void res.status(400).json({ error: "Say something first." });
  if (!hasModelCredentials()) return void res.status(503).json({ error: "The voice assistant isn't configured yet." });
  try {
    const { chat } = await import("./agent.ts");
    res.json(await chat(conversationId, text, patientId));
  } catch (err) {
    // Never leave a voice device silent: answer with a safe spoken sentence instead of an error body.
    console.error("[agent]", err);
    const { fallbackReply } = await import("./agent.ts");
    const es = /[¿¡ñáéíóú]|\b(qué|me|mi|tomé|pastilla|remedio)\b/i.test(text) || care.getPatient(patientId).preferred_language === "es";
    res.json({ reply: fallbackReply("unavailable", es, care.emergencyNumber(patientId)), toolCalls: [], degraded: true });
  }
}

// ---------- mobile app API ----------
const appApi = express.Router();

appApi.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "authorization, content-type");
  res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return void res.status(204).end();
  next();
});

type Authed = Request & { link: Link };

function auth(role?: "caregiver") {
  return (req: Request, res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    const link = linkFromAppToken(h?.startsWith("Bearer ") ? h.slice(7) : undefined);
    if (!link) return void res.status(401).json({ error: "Please sign in again." });
    if (role && link.role !== role) return void res.status(403).json({ error: "Only family members can do this." });
    (req as Authed).link = link;
    next();
  };
}

const wrap = (fn: (req: Authed, res: Response) => unknown) => (req: Request, res: Response) => {
  Promise.resolve(fn(req as Authed, res)).catch((err) => {
    console.error("[app]", err);
    res.status(400).json({ error: (err as Error).message });
  });
};

appApi.post(
  "/households",
  wrap((req, res) => {
    const b = req.body ?? {};
    if (!b.patientName || !b.caregiverName) return void res.status(400).json({ error: "Names are required." });
    const { patientId, token } = createHousehold({
      patientName: String(b.patientName),
      language: String(b.language ?? "es"),
      caregiverName: String(b.caregiverName),
      caregiverRelationship: b.relationship ? String(b.relationship) : "",
      caregiverPhone: b.phone ? String(b.phone) : "",
    });
    res.json({ token, role: "caregiver", patient_id: patientId });
  }),
);

appApi.post(
  "/join",
  wrap((req, res) => {
    const r = joinWithCode(String(req.body?.code ?? ""));
    if (!r) return void res.status(404).json({ error: "That code didn't work. Codes last 15 minutes." });
    res.json({ token: r.token, role: r.role, patient_id: r.patientId });
  }),
);

appApi.get(
  "/state",
  auth(),
  wrap((req, res) => {
    const id = req.link.patient_id;
    const p = care.getPatient(id);
    res.json({
      role: req.link.role,
      patient: { id: p.id, name: p.name, language: p.preferred_language },
      caregivers: care.caregiversOf(id),
      alexa_linked: alexaLinked(id),
      assistant_ready: hasModelCredentials(),
      clock: { time: localTime(now()), date: localDate(now()) },
      today: care.todaySchedule(id),
      adherence: care.adherence(id, 7),
      refills: care.refillForecast(id),
      medications: care.medicationsOf(id).map((m) => ({
        name: m.name,
        dose: m.dose,
        instructions: m.instructions,
        times: JSON.parse(m.times),
        units_on_hand: m.units_on_hand,
      })),
      alerts: care.recentAlerts(id, 20),
      checkins: care.recentCheckins(id, 5),
    });
  }),
);

appApi.get(
  "/events",
  auth(),
  wrap((req, res) => res.json(care.eventsSince(Number(req.query.since ?? 0), req.link.patient_id))),
);

appApi.post(
  "/doses",
  auth(),
  wrap((req, res) => {
    const status = req.body?.status === "skipped" ? "skipped" : "taken";
    res.json(care.logDose(req.link.patient_id, String(req.body?.medication ?? "all_due"), status, String(req.body?.note ?? "")));
  }),
);

appApi.post(
  "/medications",
  auth("caregiver"),
  wrap((req, res) => {
    const b = req.body ?? {};
    if (!b.name || !b.dose || !Array.isArray(b.times) || !b.times.length) {
      return void res.status(400).json({ error: "Name, dose and at least one time are required." });
    }
    res.json(
      care.addMedication(req.link.patient_id, {
        name: String(b.name),
        dose: String(b.dose),
        times: b.times.map(String),
        instructions: b.instructions ? String(b.instructions) : "",
        units_on_hand: Number(b.units_on_hand ?? 0),
        units_per_dose: Number(b.units_per_dose ?? 1),
      }),
    );
  }),
);

appApi.delete(
  "/medications/:name",
  auth("caregiver"),
  wrap((req, res) => res.json(care.stopMedication(req.link.patient_id, String(req.params.name)))),
);

appApi.post(
  "/refills",
  auth(),
  wrap((req, res) => res.json(care.recordRefill(req.link.patient_id, String(req.body?.medication ?? ""), Number(req.body?.units ?? 0)))),
);

appApi.post(
  "/checkins",
  auth(),
  wrap(async (req, res) => {
    const mood = String(req.body?.mood ?? "");
    const id = req.link.patient_id;
    care.recordCheckin(id, mood, String(req.body?.note ?? "from the app"));
    if (mood === "bad") {
      await care.alertCaregivers(id, "wellbeing", "warning", `${care.getPatient(id).name} said in the app that they don't feel well.`);
    }
    res.json({ ok: true });
  }),
);

appApi.post(
  "/help",
  auth(),
  wrap(async (req, res) => {
    const id = req.link.patient_id;
    const msg = req.body?.message
      ? `${care.getPatient(id).name}: "${String(req.body.message)}"`
      : `${care.getPatient(id).name} pressed "I need help" in the app. Please call now.`;
    res.json(await care.alertCaregivers(id, "help", "urgent", msg));
  }),
);

appApi.post(
  "/alerts/:id/ack",
  auth("caregiver"),
  wrap((req, res) => {
    const alert = care.recentAlerts(req.link.patient_id, 200).find((a) => a.id === Number(req.params.id));
    if (!alert) return void res.status(404).json({ error: "Alert not found." });
    res.json(care.acknowledgeAlert(alert.id));
  }),
);

appApi.post(
  "/pair-codes",
  auth("caregiver"),
  wrap((req, res) => {
    const target = ["alexa", "app_patient", "app_caregiver"].includes(req.body?.target) ? req.body.target : "alexa";
    res.json(newPairCode(req.link.patient_id, target));
  }),
);

appApi.post(
  "/chat",
  auth(),
  wrap((req, res) => agentReply(res, req.link.patient_id, `app-${req.link.id}`, String(req.body?.text ?? "").trim())),
);

app.use("/api/app", appApi);

// ---------- web simulator (demo household only) ----------
app.post("/api/chat", (req, res) =>
  agentReply(res, demoPatientId(), String(req.body?.conversationId ?? "device"), String(req.body?.text ?? "").trim()),
);

app.post("/api/chat/reset", async (req, res) => {
  const { resetConversation } = await import("./agent.ts");
  resetConversation(`${demoPatientId()}:${String(req.body?.conversationId ?? "device")}`);
  res.json({ ok: true });
});

app.get("/api/state", (_req, res) => {
  const id = demoPatientId();
  const p = care.getPatient(id);
  const t = now();
  res.json({
    patient: p.name,
    caregivers: care.caregiversOf(id),
    clock: { time: localTime(t), spoken: spokenTime(localTime(t)), date: localDate(t), shifted: isShifted() },
    model_ready: hasModelCredentials(),
    today: care.todaySchedule(id),
    adherence: care.adherence(id, 7),
    refills: care.refillForecast(id),
    alerts: care.recentAlerts(id, 15),
    checkins: care.recentCheckins(id, 5),
  });
});

app.get("/api/events", (req, res) => res.json(care.eventsSince(Number(req.query.since ?? 0), demoPatientId())));

app.post("/api/clock", async (req, res) => {
  if (!DEMO) return void res.status(403).json({ error: "Demo controls are off." });
  if (req.body?.reset) resetClock();
  else if (typeof req.body?.time === "string" && /^\d{2}:\d{2}$/.test(req.body.time)) {
    setNow(atLocal(localDate(now()), req.body.time));
  } else return void res.status(400).json({ error: "Send {time: 'HH:MM'} or {reset: true}." });
  await care.tick();
  res.json({ ok: true, time: localTime(now()) });
});

app.post("/api/alerts/:id/ack", (req, res) => res.json(care.acknowledgeAlert(Number(req.params.id))));

app.post("/api/reset", async (_req, res) => {
  if (!DEMO) return void res.status(403).json({ error: "Demo controls are off." });
  resetDemo();
  resetClock();
  res.json({ ok: true });
});

// ---------- static ----------
app.use("/app", express.static(path.join(import.meta.dirname, "..", "mobile", "www")));
app.use(express.static(path.join(import.meta.dirname, "..", "web")));

// ---------- background tick ----------
setInterval(() => care.tick().catch((e) => console.error("[tick]", e)), 5000);

app.listen(PORT, HOST, () => {
  console.log(`CareCue running on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`  MCP endpoint:    /mcp   (Streamable HTTP, spec 2025-11-25)`);
  console.log(`  Alexa skill:     /alexa (signature checks ${process.env.ALEXA_SKIP_VERIFY === "1" ? "OFF" : "on"})`);
  console.log(`  Mobile app:      /app`);
  console.log(`  Simulator:       /`);
  console.log(`  Model:           ${hasModelCredentials() ? "credentials found" : "no credentials (assistant disabled)"}`);
  if (hasModelCredentials() && process.env.CARECUE_DEMO !== "0")
    import("./agent.ts").then((a) => a.warmUp(demoPatientId())).catch((e) => console.error("[warm-up]", (e as Error).message));
});
