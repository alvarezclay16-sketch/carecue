// One process serves everything CareCue needs:
//   /mcp        MCP server for Alexa+ and any MCP client (Streamable HTTP, spec 2025-11-25)
//   /alexa      Alexa custom skill endpoint (works on any Echo today)
//   /api/app/*  the mobile app (caregiver + senior modes), one household per token
//   /api/*      the web simulator used for the demo video
//   /           the simulator itself; /app the mobile web app

import express, { type NextFunction, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
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
import { assertBootSafe, CANNED, describe, evalHookAllowed, gateCreate, gateMcp, gateModelTurn, isPaused } from "./limits.ts";
import { atLocal, clockControlEnabled, isShifted, localDate, localTime, now, resetClock, setNow, spokenTime } from "./clock.ts";
import { speaksSpanish } from "./lang.ts";
import { clearAllLatches, currentScene, deriveScene } from "./scene.ts";
import { applyScenario, isScenarioId, scenarioList, type Lang } from "./scenarios.ts";
import { createSandbox, pidFor, restartHousehold, sandboxIdOf, startSandboxJobs, touchPlayground } from "./sandbox.ts";
import { ensureDemoHistory, weekView, SAMPLE_LABEL } from "./sample.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const DEMO = process.env.CARECUE_DEMO !== "0";

assertBootSafe(); // CARECUE_EVAL or CARECUE_CLOCK_CONTROL together with CARECUE_PUBLIC refuses to start
seedDemo();
ensureDemoHistory(demoPatientId()); // sample history for the shared demo household (labelled "Sample history (demo)")
startSandboxJobs(); // purge idle sandboxes, re-seed a dirty idle playground

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

// Alexa needs the raw body for signature checks, so it goes before the JSON parser.
app.post("/alexa", ...alexaHandlers());

app.use(express.json({ limit: "100kb" }));

// Health check for the proxy and the tests. `model` names the provider and model that answer (or will answer first).
app.get("/health", async (_req, res) => {
  try {
    res.json({ ok: true, model: (await import("./agent.ts")).modelInfo() });
  } catch {
    res.json({ ok: true });
  }
});

// Any visit to the demo or a call to /mcp counts as activity: the model warm-up below runs only while someone is around.
let lastActivity = Date.now();
app.use((req, _res, next) => {
  if ((req.path.startsWith("/api/") && req.path !== "/api/limits") || req.path === "/mcp") lastActivity = Date.now();
  next();
});

// ---------- MCP ----------
app.post("/mcp", (req, res) => {
  if (!req.headers.authorization) touchPlayground(); // an anonymous client is using the shared playground
  const wait = gateMcp(req);
  if (wait) {
    res.set("Retry-After", String(wait));
    return void res.status(429).json({ jsonrpc: "2.0", error: { code: -32029, message: "Too many requests. Please slow down." }, id: null });
  }
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

/** Was this turn spoken in Spanish? (Only picks the language of the few canned sentences; unclear text takes the household's language.) */
const wantsSpanish = (text: string, patientId: number) => speaksSpanish(text, care.getPatient(patientId).preferred_language === "es");

/**
 * The only door to the model for chat. Every route that can reach a paid model goes through here,
 * so the spend guard (src/limits.ts) sees it first. tokenKey: the app token's id, for the per-token cap.
 */
async function agentReply(req: Request, res: Response, patientId: number, conversationId: string, text: string, tokenKey?: string) {
  // Bare-client mode (the safety suite): only for a loopback caller on a server started with CARECUE_EVAL=1.
  const bare = req.body?.mode === "bare" && evalHookAllowed(req);
  if (!text) return void res.status(400).json({ error: "Say something first." });
  const es = wantsSpanish(text, patientId);
  const verdict = gateModelTurn(req, text, tokenKey);
  if (!verdict.ok) {
    // Over a limit or paused: answer at once, no model call. A person in trouble still gets the emergency number.
    const reply = verdict.urgent
      ? (await import("./agent.ts")).fallbackReply("unavailable", es, care.emergencyNumber(patientId))
      : CANNED[es ? "es" : "en"];
    return void res.json({ reply, toolCalls: [], limited: true, scene: null, ttl_s: null, ...(verdict.urgent ? { degraded: true } : {}) });
  }
  if (process.env.CARECUE_FAKE_AGENT === "1") return void res.json({ reply: "[fake agent] ok", toolCalls: [], ...deriveScene([], text, patientId) }); // tests only
  if (!hasModelCredentials()) return void res.status(503).json({ error: "The voice assistant isn't configured yet." });
  try {
    const { chat } = await import("./agent.ts");
    const turn = await chat(conversationId, text, patientId, bare ? { mode: "bare" } : undefined);
    // The scene comes from the tool calls and the log, never from the reply text.
    res.json({ ...turn, ...deriveScene(turn.toolCalls, text, patientId) });
  } catch (err) {
    // Never leave a voice device silent: answer with a safe spoken sentence instead of an error body.
    console.error("[agent]", err);
    const { fallbackReply } = await import("./agent.ts");
    res.json({ reply: fallbackReply("unavailable", es, care.emergencyNumber(patientId)), toolCalls: [], degraded: true, scene: null, ttl_s: null });
  }
}

// Which model answered last, how often the fallback had to, and the last real request id. No secrets, nothing mocked.
app.get("/api/model", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json((await import("./agent.ts")).modelStatus());
});

// The latest committed safety-suite results (docs/safety-results.json), read-only. Numbers shown anywhere come from here.
app.get("/api/safety", (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    res.json(JSON.parse(readFileSync(process.env.CARECUE_SAFETY_RESULTS ?? path.join(import.meta.dirname, "..", "docs", "safety-results.json"), "utf8")));
  } catch {
    res.status(404).json({ error: "No safety results have been committed yet. Run npm run safety." });
  }
});

// Eval hooks: answer only to a direct loopback caller on a server started with CARECUE_EVAL=1 (never behind the proxy).
app.post("/api/eval/tick", async (req, res) => {
  if (!evalHookAllowed(req)) return void res.status(403).json({ error: "Eval hooks are off." });
  await care.tick();
  res.json({ ok: true, time: localTime(now()) });
});

// Sets the clock of an eval server to a fixed time of day, so relative dose times never cross midnight in the middle of a run.
app.post("/api/eval/clock", (req, res) => {
  if (!evalHookAllowed(req)) return void res.status(403).json({ error: "Eval hooks are off." });
  if (typeof req.body?.time !== "string" || !/^\d{2}:\d{2}$/.test(req.body.time)) return void res.status(400).json({ error: "Send {time: 'HH:MM'}." });
  setNow(atLocal(localDate(now()), req.body.time));
  res.json({ ok: true, time: localTime(now()) });
});

app.get("/api/limits", (req, res) => {
  const h = req.headers.authorization;
  const link = linkFromAppToken(h?.startsWith("Bearer ") ? h.slice(7) : undefined);
  res.json(describe(req, link ? `app-${link.id}` : undefined));
});

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
    const wait = gateCreate(req);
    if (wait) {
      res.set("Retry-After", String(wait));
      return void res.status(429).json({ error: "Too many new households from this address. Please try again later.", retry_after_s: wait });
    }
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
      dose_notes: care.doseNotes(id),
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
  wrap((req, res) => agentReply(req, res, req.link.patient_id, `app-${req.link.id}`, String(req.body?.text ?? "").trim(), `app-${req.link.id}`)),
);

app.use("/api/app", appApi);

// ---------- web simulator ----------
// Every route below acts on the caller's private sandbox (header x-carecue-sandbox), or on the shared demo
// household when there is no header (the local recorder, local dev). An unknown or expired id answers 404 sandbox_expired.

type Scoped = (req: Request, res: Response, patientId: number) => unknown;
const demo = (fn: Scoped) => (req: Request, res: Response) => {
  const patientId = pidFor(req);
  if (patientId === undefined) return void res.status(404).json({ error: "sandbox_expired" });
  Promise.resolve(fn(req, res, patientId)).catch((err) => {
    console.error("[demo]", err);
    if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
  });
};

/** A private demo household for this visitor, set up for a scenario (default: a fresh morning with a reminder due). */
app.post("/api/sandbox", async (req, res) => {
  try {
    // createSandbox charges the shared household-creation limit itself, exactly once.
    const r = await createSandbox(req, { scenario: req.body?.scenario, lang: req.body?.lang });
    if (!r.ok) {
      if (r.retry_after_s) res.set("Retry-After", String(r.retry_after_s));
      return void res.status(r.status).json({ error: r.error, ...(r.retry_after_s ? { retry_after_s: r.retry_after_s } : {}) });
    }
    res.json({ sandbox_id: r.sandbox_id, scenario: r.scenario, lang: r.lang, utterance: r.utterance, replay: r.replay, timezone: process.env.TZ });
  } catch (err) {
    console.error("[sandbox]", err);
    res.status(500).json({ error: "Could not start a private demo." });
  }
});

app.get("/api/scenarios", (_req, res) => res.json(scenarioList()));

/**
 * Re-seeds the caller's household for a scenario (alerts, events, conversation and scene latch cleared) and returns
 * what to say, if anything. The client sends it through the normal chat route: at most one model turn per chip.
 * Without a sandbox header it only works on a local server that controls its own clock (the recorder).
 */
app.post(
  "/api/scenario/:id",
  demo(async (req, res, patientId) => {
    const id = String(req.params.id);
    if (!isScenarioId(id)) return void res.status(404).json({ error: "unknown_scenario", scenarios: scenarioList().map((s) => s.id) });
    if (!sandboxIdOf(req) && !clockControlEnabled()) return void res.status(403).json({ error: "sandbox_required" });
    const lang: Lang | undefined = req.body?.lang === "es" ? "es" : req.body?.lang === "en" ? "en" : undefined;
    await restartHousehold(patientId);
    const r = await applyScenario(patientId, id, lang);
    res.json({ scenario: r.scenario, lang: r.lang, utterance: r.utterance, replay: r.replay });
  }),
);

app.post(
  "/api/chat",
  demo((req, res, patientId) =>
    agentReply(req, res, patientId, sandboxIdOf(req) ?? String(req.body?.conversationId ?? "device"), String(req.body?.text ?? "").trim()),
  ),
);

app.post(
  "/api/chat/reset",
  demo(async (req, res, patientId) => {
    const { resetConversation } = await import("./agent.ts");
    resetConversation(`${patientId}:${sandboxIdOf(req) ?? String(req.body?.conversationId ?? "device")}`);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/state",
  demo((req, res, id) => {
    const p = care.getPatient(id);
    const t = now();
    const caregivers = care.caregiversOf(id);
    res.json({
      patient: p.name,
      caregivers,
      clock: { time: localTime(t), spoken: spokenTime(localTime(t)), date: localDate(t), shifted: isShifted() },
      model_ready: hasModelCredentials(),
      today: care.todaySchedule(id),
      adherence: care.adherence(id, 7),
      refills: care.refillForecast(id),
      alerts: care.recentAlerts(id, 15),
      checkins: care.recentCheckins(id, 5),
      scene: currentScene(id),
      device: {
        emergency_number: care.emergencyNumber(id),
        crisis_line: care.crisisLine(id),
        caregiver_first: caregivers[0]?.name.trim().split(/\s+/)[0] ?? null,
        language: p.preferred_language === "es" ? "es" : "en",
        clock_control: clockControlEnabled(),
      },
      sandbox: !!sandboxIdOf(req),
      sample_label: SAMPLE_LABEL[p.preferred_language === "es" ? "es" : "en"],
      timezone: process.env.TZ ?? null,
    });
  }),
);

app.get(
  "/api/events",
  demo((req, res, id) => res.json(care.eventsSince(Number(req.query.since ?? 0), id))),
);

// The last 7 days of dose history (sample data, labelled) with plain counts. Demo households only.
app.get(
  "/api/week",
  demo((_req, res, id) => res.json(weekView(id))),
);

// The "I took it" / "Not yet" buttons of the simulated device. Touch goes through MCP log_dose like a model call would,
// so the same server guard runs and a TOUCH chip appears in the wire tab. No model is involved.
app.post(
  "/api/device/touch",
  demo(async (req, res, patientId) => {
    const wait = gateMcp(req);
    if (wait) {
      res.set("Retry-After", String(wait));
      return void res.status(429).json({ error: "Too many requests. Please slow down." });
    }
    const action = req.body?.action;
    if (action === "not_yet") return void res.json({ ok: true }); // writes nothing; the client shows its fixed line
    if (action !== "took") return void res.status(400).json({ error: "Send {action: 'took'} or {action: 'not_yet'}." });
    const { callToolDirect } = await import("./agent.ts");
    let trace;
    try {
      trace = await callToolDirect(patientId, "log_dose", { medication: "all_due", status: "taken", person_was_certain: true, note: "tapped on the screen" }, "touch");
    } catch (err) {
      console.error("[touch]", err);
      return void res.status(503).json({ error: "The device could not reach the care service. Nothing was written down." });
    }
    res.json({ result: trace.result, trace, ...deriveScene([trace], "", patientId) });
  }),
);

// What the MCP server announced at its handshake, for the wire tab header. Read from a real initialize response.
app.get("/api/mcp-info", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    res.json(await (await import("./probes.ts")).mcpInfo(demoPatientId()));
  } catch (err) {
    console.error("[mcp-info]", err);
    res.status(503).json({ error: "The MCP handshake is not available yet." });
  }
});

// Three labelled direct tool calls (never a model): what the server does when a client misbehaves.
app.post(
  "/api/probe",
  demo(async (req, res, patientId) => {
    const probes = await import("./probes.ts");
    const id = req.body?.id;
    if (!probes.isProbeId(id)) return void res.status(400).json({ error: "Unknown probe.", probes: probes.PROBE_IDS });
    const wait = gateMcp(req);
    if (wait) {
      res.set("Retry-After", String(wait));
      return void res.status(429).json({ error: "Too many requests. Please slow down." });
    }
    const r = await probes.runProbe(id, patientId);
    res.status(r.status).json(r.body);
  }),
);

// Moving the clock is for a local server only (the recorder, the tests): on a public instance everyone shares one clock.
app.post("/api/clock", async (req, res) => {
  if (!DEMO || !clockControlEnabled()) return void res.status(403).json({ error: "The clock is fixed on this server." });
  if (req.body?.reset) resetClock();
  else if (typeof req.body?.time === "string" && /^\d{2}:\d{2}$/.test(req.body.time)) {
    setNow(atLocal(localDate(now()), req.body.time));
  } else return void res.status(400).json({ error: "Send {time: 'HH:MM'} or {reset: true}." });
  await care.tick();
  res.json({ ok: true, time: localTime(now()) });
});

app.post(
  "/api/alerts/:id/ack",
  demo((req, res, patientId) => {
    const alert = care.recentAlerts(patientId, 200).find((a) => a.id === Number(req.params.id));
    if (!alert) return void res.status(404).json({ error: "Alert not found." });
    res.json(care.acknowledgeAlert(alert.id));
  }),
);

// Start over. With a sandbox header: a fresh morning for that sandbox. Without one: reset the shared demo household
// and the clock, which only a local server (clock control) allows.
app.post("/api/reset", async (req, res) => {
  if (!DEMO) return void res.status(403).json({ error: "Demo controls are off." });
  if (sandboxIdOf(req) || req.headers["x-carecue-sandbox"] !== undefined) {
    const id = pidFor(req);
    if (id === undefined) return void res.status(404).json({ error: "sandbox_expired" });
    await restartHousehold(id);
    return void res.json({ ok: true });
  }
  if (!clockControlEnabled()) return void res.status(403).json({ error: "Only a local server can reset the shared demo." });
  resetDemo();
  resetClock();
  clearAllLatches();
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
  console.log(`  Spend guard:     ${process.env.CARECUE_PUBLIC === "1" ? "ON (public instance)" : "off (local)"}`);
  if (process.env.CARECUE_PUBLIC !== "1" && !["127.0.0.1", "::1", "localhost"].includes(HOST))
    console.warn("  WARNING: listening on a non-loopback address without CARECUE_PUBLIC=1; model routes are not rate limited.");
  console.log(`  Model:           ${hasModelCredentials() ? "credentials found" : "no credentials (assistant disabled)"}`);
  if (hasModelCredentials())
    import("./agent.ts").then((a) => {
      const m = a.modelStatus().configured;
      console.log(`  Voice agent:     ${m.primary} ${m.model}${m.fallback ? `, failover ${m.fallback.provider} ${m.fallback.model}` : ""}`);
    });
  // Keeps the prompt cache warm for the first turn of a visitor: once at boot, then every 4 minutes, but only while there
  // was activity in the last 30 minutes (an unwatched instance makes no model calls at all) and never when paused.
  if (hasModelCredentials() && process.env.CARECUE_DEMO !== "0" && process.env.CARECUE_FAKE_AGENT !== "1") {
    const warm = () =>
      isPaused() ? undefined : import("./agent.ts").then((a) => a.warmUp(demoPatientId())).catch((e) => console.error("[warm-up]", (e as Error).message));
    const everyS = Number(process.env.CARECUE_WARMUP_EVERY_S) || 240; // the env names are only for tests
    const activeS = Number(process.env.CARECUE_WARMUP_ACTIVE_S) || 1800;
    warm();
    setInterval(() => {
      if (Date.now() - lastActivity < activeS * 1000) warm();
    }, everyS * 1000).unref();
  }
});
