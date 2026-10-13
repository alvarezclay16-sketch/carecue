// CareCue as an Alexa custom skill: works today on any Echo device or the Alexa app.
// Same household data as the MCP server and the mobile app. English and Spanish.

import { createHash } from "node:crypto";
import Alexa from "ask-sdk-core";
import type { HandlerInput, RequestHandler, ErrorHandler } from "ask-sdk-core";
import type { Response, services } from "ask-sdk-model";
import { ExpressAdapter } from "ask-sdk-express-adapter";
import * as care from "./care.ts";
import { db } from "./db.ts";
import { linkAlexa, linkFromAlexaUser, type Link } from "./households.ts";
import { localDate, now } from "./clock.ts";

type Lang = "en" | "es";

// ---------- words ----------

const T = {
  en: {
    welcomeUnlinked:
      "Welcome to Care Cue. To connect this Alexa to your family's Care Cue app, tell me the four-digit code shown in the app. For example: my code is one two three four.",
    askCode: "What's the four-digit code shown in the Care Cue app?",
    badCode: "That code didn't work. Codes last fifteen minutes. Please check the app and tell me the four digits again.",
    linked: (name: string) => `Done! This Alexa is now connected to ${name}'s medicines.`,
    askReminders: "I'd also like to remind you out loud at each medicine time.",
    remindersOn: "Reminders are set. I'll speak up at every medicine time.",
    remindersOff: "Okay, no spoken reminders. You can enable them later in the Alexa app.",
    hello: (name: string) => `Hi ${name}.`,
    dueNow: (list: string) => `It's time for your ${list}. Tell me when you've taken it.`,
    late: (list: string, time: string) => `You still have your ${time} ${list} waiting. Did you take it?`,
    nextAt: (list: string, time: string) => `Your next medicine is ${list} at ${time}.`,
    noneLeft: "You're all done with your medicines for today. Well done.",
    logged: (list: string) => `Got it, I wrote down your ${list}.`,
    doubleDose: (med: string, time: string) => `You already took your ${med} today at ${time}. Please don't take another one.`,
    tooEarly: (med: string, time: string) => `It's a bit early. Your next ${med} is at ${time}, so I haven't written it down yet.`,
    nothingDue: "You don't have any medicine due right now.",
    unknownMed: (name: string, list: string) => `I don't have ${name} on your list. Your medicines are ${list}.`,
    tookAt: (med: string, time: string) => `Yes, you took your ${med} at ${time}.`,
    notYet: (med: string) => `No, you haven't taken your ${med} yet.`,
    takenToday: (list: string) => `Today you've taken ${list}.`,
    nothingTaken: "You haven't logged any medicine yet today.",
    refillAdded: (n: number, med: string, days: number | null) =>
      `Added ${n} ${med}. That's about ${days ?? "a few"} days of supply.`,
    refillLow: (list: string) => `You're running low on ${list}. Your family gets a refill reminder in their app.`,
    refillOk: "You have enough of all your medicines for now.",
    feelGood: "I'm glad to hear that.",
    feelBad: (who: string, num: string) => `I'm sorry you feel that way. I sent ${who} a message. If you faint, or have chest pain or trouble speaking, call ${num}.`,
    emergency: (who: string, num: string) => `Please call ${num} now. I sent ${who} an urgent message.`,
    familyTold: (who: string) => `I've sent a message to ${who}.`,
    family: "your family",
    help: "You can say: I took my pills. Did I take my Losartan? What's next? Or: tell my family I'm okay.",
    anythingElse: "Anything else?",
    bye: "Take care.",
    sorry: "Sorry, something went wrong. Please try again.",
    notUnderstood: "Sorry, I didn't get that. You can say: I took my pills, or: what's next?",
    and: "and",
    reminderText: (name: string, list: string) =>
      `${name}, it's time for your ${list}. When you've taken it, say: Alexa, tell Care Cue I took my pills.`,
  },
  es: {
    welcomeUnlinked:
      "Bienvenido a Mi Pastillero. Para conectar este Alexa con la app de tu familia, dime el código de cuatro números que aparece en la app. Por ejemplo: mi código es uno dos tres cuatro.",
    askCode: "¿Cuál es el código de cuatro números que aparece en la app?",
    badCode: "Ese código no funcionó. Los códigos duran quince minutos. Revisa la app y dime los cuatro números de nuevo.",
    linked: (name: string) => `¡Listo! Este Alexa ya está conectado a los remedios de ${name}.`,
    askReminders: "También me gustaría avisarte en voz alta a la hora de cada remedio.",
    remindersOn: "Recordatorios activados. Te voy a avisar a cada hora de remedio.",
    remindersOff: "Bueno, sin recordatorios por voz. Puedes activarlos después en la app de Alexa.",
    hello: (name: string) => `Hola ${name}.`,
    dueNow: (list: string) => `Es hora de tomar ${list}. Avísame cuando lo hagas.`,
    late: (list: string, time: string) => `Todavía tienes pendiente ${list} de las ${time}. ¿Ya te lo tomaste?`,
    nextAt: (list: string, time: string) => `Tu próximo remedio es ${list} a las ${time}.`,
    noneLeft: "Ya terminaste todos tus remedios de hoy. Muy bien.",
    logged: (list: string) => `Perfecto, anoté ${list}.`,
    doubleDose: (med: string, time: string) => `Ya te tomaste tu ${med} hoy a las ${time}. Por favor no te tomes otra.`,
    tooEarly: (med: string, time: string) => `Todavía es temprano. Tu próxima ${med} es a las ${time}, así que aún no la anoto.`,
    nothingDue: "Ahora no tienes ningún remedio pendiente.",
    unknownMed: (name: string, list: string) => `No tengo ${name} en tu lista. Tus remedios son ${list}.`,
    tookAt: (med: string, time: string) => `Sí, te tomaste tu ${med} a las ${time}.`,
    notYet: (med: string) => `No, todavía no te tomas tu ${med}.`,
    takenToday: (list: string) => `Hoy te has tomado ${list}.`,
    nothingTaken: "Todavía no has anotado ningún remedio hoy.",
    refillAdded: (n: number, med: string, days: number | null) =>
      `Agregué ${n} de ${med}. Te alcanza para unos ${days ?? "pocos"} días.`,
    refillLow: (list: string) => `Te queda poco de ${list}. Tu familia recibe un aviso de reposición en su app.`,
    refillOk: "Tienes suficiente de todos tus remedios por ahora.",
    feelGood: "Qué bueno escuchar eso.",
    feelBad: (who: string, num: string) => `Lamento que te sientas así. Le mandé un mensaje a ${who}. Si te desmayas, tienes dolor de pecho o te cuesta hablar, llama al ${num}.`,
    emergency: (who: string, num: string) => `Por favor llama al ${num} ahora. Le mandé un mensaje urgente a ${who}.`,
    familyTold: (who: string) => `Le mandé un mensaje a ${who}.`,
    family: "tu familia",
    help: "Puedes decir: ya me tomé las pastillas. ¿Me tomé el Losartán? ¿Qué me toca ahora? O: avísale a mi familia que estoy bien.",
    anythingElse: "¿Algo más?",
    bye: "Cuídate mucho.",
    sorry: "Perdón, algo falló. Inténtalo de nuevo.",
    notUnderstood: "Perdón, no te entendí. Puedes decir: ya me tomé las pastillas, o: qué me toca ahora.",
    and: "y",
    reminderText: (name: string, list: string) =>
      `${name}, es hora de tomar ${list}. Cuando lo hagas, di: Alexa, dile a mi pastillero que ya me tomé las pastillas.`,
  },
} as const;

const lang = (h: HandlerInput): Lang => (Alexa.getLocale(h.requestEnvelope)?.startsWith("es") ? "es" : "en");
const t = (h: HandlerInput) => T[lang(h)];

function joinList(items: string[], l: Lang): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${T[l].and} ${items[items.length - 1]}`;
}

function sayTime(hhmm: string, l: Lang): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (l === "es") {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const part = h < 12 ? "de la mañana" : h < 20 ? "de la tarde" : "de la noche";
    return m ? `${h12} y ${m} ${part}` : `${h12} ${part}`;
  }
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

const slot = (h: HandlerInput, name: string) => {
  try {
    return Alexa.getSlotValue(h.requestEnvelope, name) || undefined;
  } catch {
    return undefined;
  }
};

function household(h: HandlerInput): Link | undefined {
  return linkFromAlexaUser(Alexa.getUserId(h.requestEnvelope));
}

function caregiverName(patientId: number, l: Lang): string {
  const c = care.caregiversOf(patientId)[0];
  return c ? c.name : T[l].family;
}

// ---------- status sentences, shared by several intents ----------

function statusSpeech(patientId: number, l: Lang): string {
  const s = care.todaySchedule(patientId);
  const due = s.due_now;
  if (due.length) {
    const late = due.filter((d) => d.status === "missed");
    const list = joinList(due.map((d) => d.medication), l);
    return late.length === due.length ? T[l].late(list, sayTime(due[0].time, l)) : T[l].dueNow(list);
  }
  if (s.next_up.length) {
    const first = s.next_up[0];
    const same = s.next_up.filter((d) => d.time === first.time).map((d) => d.medication);
    return T[l].nextAt(joinList(same, l), sayTime(first.time, l));
  }
  return T[l].noneLeft;
}

function nextSentence(patientId: number, l: Lang): string {
  const s = care.todaySchedule(patientId);
  if (s.due_now.length) return T[l].dueNow(joinList(s.due_now.map((d) => d.medication), l));
  if (s.next_up.length) {
    const first = s.next_up[0];
    return T[l].nextAt(joinList(s.next_up.filter((d) => d.time === first.time).map((d) => d.medication), l), sayTime(first.time, l));
  }
  return T[l].noneLeft;
}

// ---------- reminders (Alexa speaks at each medicine time) ----------

const REMINDER_SCOPE = "alexa::alerts:reminders:skill:readwrite";

function hasReminderPermission(h: HandlerInput): boolean {
  return !!h.requestEnvelope.context.System.user.permissions?.consentToken;
}

function askForReminders(h: HandlerInput, speech: string): Response {
  return h.responseBuilder
    .speak(speech)
    .addDirective({
      type: "Connections.SendRequest",
      name: "AskFor",
      payload: { "@type": "AskForPermissionsConsentRequest", "@version": "2", permissionScopes: [{ permissionScope: REMINDER_SCOPE, consentLevel: "ACCOUNT" }] },
      token: "reminders",
    } as never)
    .getResponse();
}

/** Creates one daily reminder per medicine time; replaces them when the schedule changed. */
async function syncReminders(h: HandlerInput, link: Link): Promise<void> {
  if (!hasReminderPermission(h)) return;
  const l = lang(h);
  const patient = care.getPatient(link.patient_id);
  const meds = care.medicationsOf(link.patient_id);
  const byTime = new Map<string, string[]>();
  for (const m of meds) for (const time of JSON.parse(m.times) as string[]) byTime.set(time, [...(byTime.get(time) ?? []), m.name]);
  const hash = createHash("sha1").update(JSON.stringify([...byTime.entries()].sort()) + l).digest("hex");

  const existing = db.prepare("SELECT * FROM alexa_reminders WHERE link_id = ?").all(link.id) as Array<{ id: number; alert_token: string; schedule_hash: string }>;
  if (existing.length && existing.every((r) => r.schedule_hash === hash)) return;

  const client = h.serviceClientFactory!.getReminderManagementServiceClient();
  for (const r of existing) {
    await client.deleteReminder(r.alert_token).catch(() => {});
    db.prepare("DELETE FROM alexa_reminders WHERE id = ?").run(r.id);
  }

  let timeZoneId = process.env.TZ ?? "America/Santiago";
  try {
    const deviceId = Alexa.getDeviceId(h.requestEnvelope);
    timeZoneId = await h.serviceClientFactory!.getUpsServiceClient().getSystemTimeZone(deviceId);
  } catch {}

  const start = `${localDate(now())}T00:00:00.000`;
  for (const [time, names] of [...byTime.entries()].sort()) {
    const [hh, mm] = time.split(":").map(Number);
    const reminder: services.reminderManagement.ReminderRequest = {
      requestTime: new Date().toISOString().replace("Z", ""),
      trigger: {
        type: "SCHEDULED_ABSOLUTE",
        timeZoneId,
        recurrence: { startDateTime: start, recurrenceRules: [`FREQ=DAILY;BYHOUR=${hh};BYMINUTE=${mm};BYSECOND=0;INTERVAL=1;`] },
      },
      alertInfo: {
        spokenInfo: { content: [{ locale: Alexa.getLocale(h.requestEnvelope), text: T[l].reminderText(patient.name, joinList(names, l)) }] },
      },
      pushNotification: { status: "ENABLED" },
    };
    const created = await client.createReminder(reminder);
    db.prepare("INSERT INTO alexa_reminders (patient_id, link_id, alert_token, time, schedule_hash) VALUES (?, ?, ?, ?, ?)").run(
      link.patient_id,
      link.id,
      created.alertToken!,
      time,
      hash,
    );
  }
}

// ---------- handlers ----------

const reprompt = (h: HandlerInput) => t(h).anythingElse;

function unlinked(h: HandlerInput): Response {
  return h.responseBuilder.speak(t(h).welcomeUnlinked).reprompt(t(h).askCode).getResponse();
}

const Launch: RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "LaunchRequest",
  async handle(h) {
    const link = household(h);
    if (!link) return unlinked(h);
    await syncReminders(h, link).catch((e) => console.error("[alexa] reminders", e.message));
    const p = care.getPatient(link.patient_id);
    return h.responseBuilder.speak(`${t(h).hello(p.name)} ${statusSpeech(link.patient_id, lang(h))}`).reprompt(reprompt(h)).getResponse();
  },
};

const LinkDevice: RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(h.requestEnvelope) === "LinkDeviceIntent",
  async handle(h) {
    const code = slot(h, "code");
    if (!code) return h.responseBuilder.speak(t(h).askCode).reprompt(t(h).askCode).getResponse();
    const link = linkAlexa(Alexa.getUserId(h.requestEnvelope), code);
    if (!link) return h.responseBuilder.speak(t(h).badCode).reprompt(t(h).askCode).getResponse();
    const p = care.getPatient(link.patient_id);
    const msg = `${t(h).linked(p.name)} ${statusSpeech(link.patient_id, lang(h))}`;
    if (!hasReminderPermission(h)) return askForReminders(h, `${msg} ${t(h).askReminders}`);
    await syncReminders(h, link).catch((e) => console.error("[alexa] reminders", e.message));
    return h.responseBuilder.speak(msg).reprompt(reprompt(h)).getResponse();
  },
};

const PermissionResponse: RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "Connections.Response",
  async handle(h) {
    const req = h.requestEnvelope.request as unknown as { payload?: { status?: string } };
    const link = household(h);
    if (req.payload?.status === "ACCEPTED" && link) {
      await syncReminders(h, link).catch((e) => console.error("[alexa] reminders", e.message));
      return h.responseBuilder.speak(`${t(h).remindersOn} ${t(h).anythingElse}`).reprompt(reprompt(h)).getResponse();
    }
    return h.responseBuilder.speak(`${t(h).remindersOff} ${t(h).anythingElse}`).reprompt(reprompt(h)).getResponse();
  },
};

/** Every household intent below needs a linked Alexa; unlinked users get the code prompt. */
function householdIntent(name: string, run: (h: HandlerInput, link: Link, l: Lang) => Promise<string> | string, keepOpen = true): RequestHandler {
  return {
    canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(h.requestEnvelope) === name,
    async handle(h) {
      const link = household(h);
      if (!link) return unlinked(h);
      const speech = await run(h, link, lang(h));
      const rb = h.responseBuilder.speak(keepOpen ? `${speech} ${t(h).anythingElse}` : speech);
      return keepOpen ? rb.reprompt(reprompt(h)).getResponse() : rb.withShouldEndSession(true).getResponse();
    },
  };
}

const TookMeds = householdIntent("TookMedsIntent", (h, link, l) => {
  const med = slot(h, "medication");
  const r = care.logDose(link.patient_id, med ?? "all_due", "taken");
  if (r.ok) return `${T[l].logged(joinList(r.logged.map((x) => x.medication), l))} ${nextSentence(link.patient_id, l)}`;
  if (r.warnings.includes("possible_double_dose")) {
    const m = care.findMedication(link.patient_id, med ?? "")!;
    const taken = care.whatHaveITaken(link.patient_id, m.name).taken.pop();
    return T[l].doubleDose(m.name, taken?.taken_at ? sayTime(toHHMM(taken.taken_at), l) : "");
  }
  if (r.warnings.includes("too_early")) {
    const m = care.findMedication(link.patient_id, med ?? "")!;
    const next = care.todaySchedule(link.patient_id).all_today.find((d) => d.medication === m.name && d.status === "scheduled");
    return T[l].tooEarly(m.name, next ? sayTime(next.time, l) : "");
  }
  if (med && !care.findMedication(link.patient_id, med)) {
    return T[l].unknownMed(med, joinList(care.medicationsOf(link.patient_id).map((m) => m.name), l));
  }
  return `${T[l].nothingDue} ${nextSentence(link.patient_id, l)}`;
});

/** "8:02 AM" (from whatHaveITaken) back to "08:02". */
function toHHMM(spoken: string): string {
  const m = spoken.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
  if (!m) return spoken;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
}

const DidITake = householdIntent("DidITakeIntent", (h, link, l) => {
  const medName = slot(h, "medication");
  if (medName) {
    const med = care.findMedication(link.patient_id, medName);
    if (!med) return T[l].unknownMed(medName, joinList(care.medicationsOf(link.patient_id).map((m) => m.name), l));
    const r = care.whatHaveITaken(link.patient_id, med.name);
    const last = r.taken[r.taken.length - 1];
    return last?.taken_at ? T[l].tookAt(med.name, sayTime(toHHMM(last.taken_at), l)) : T[l].notYet(med.name);
  }
  const r = care.whatHaveITaken(link.patient_id);
  if (!r.taken.length) return `${T[l].nothingTaken} ${statusSpeech(link.patient_id, l)}`;
  const list = joinList(r.taken.map((x) => x.medication), l);
  return `${T[l].takenToday(list)} ${nextSentence(link.patient_id, l)}`;
});

const WhatsNext = householdIntent("WhatsNextIntent", (_h, link, l) => statusSpeech(link.patient_id, l));

const Refill = householdIntent("RefillIntent", (h, link, l) => {
  const med = slot(h, "medication");
  const count = Number(slot(h, "count"));
  if (med && count > 0) {
    const r = care.recordRefill(link.patient_id, med, count);
    if (!r.ok) return T[l].unknownMed(med, joinList(care.medicationsOf(link.patient_id).map((m) => m.name), l));
    return T[l].refillAdded(count, r.forecast!.medication, r.forecast!.days_left);
  }
  const low = care.refillForecast(link.patient_id).filter((r) => r.needs_refill);
  return low.length ? T[l].refillLow(joinList(low.map((r) => r.medication), l)) : T[l].refillOk;
});

const EMERGENCY = /chest|breath|fell|fall|faint|stroke|pecho|respirar|aire|ca[ií]|desmay|derrame|no puedo moverme/i;
const BAD = /bad|sick|dizzy|pain|tired|nause|weak|mal|mare|dolor|cansad|n[aá]use|d[eé]bil|enferm|triste/i;

const Feeling = householdIntent("FeelingIntent", async (h, link, l) => {
  const feeling = slot(h, "feeling") ?? "";
  const p = care.getPatient(link.patient_id);
  const who = caregiverName(link.patient_id, l);
  const num = care.emergencyNumber(link.patient_id).split("").join(" ");
  care.recordCheckin(link.patient_id, feeling || "unspecified", "said to Alexa");
  if (EMERGENCY.test(feeling)) {
    await care.alertCaregivers(link.patient_id, "help", "urgent", `${p.name} told Alexa: "${feeling}". This may be an emergency. Please call now.`);
    return T[l].emergency(who, num);
  }
  if (BAD.test(feeling)) {
    await care.alertCaregivers(link.patient_id, "wellbeing", "warning", `${p.name} told Alexa they feel "${feeling}".`);
    return T[l].feelBad(who, num);
  }
  return T[l].feelGood;
});

const TellFamily = householdIntent("TellFamilyIntent", async (h, link, l) => {
  const message = slot(h, "message");
  const p = care.getPatient(link.patient_id);
  await care.alertCaregivers(
    link.patient_id,
    "info",
    "info",
    message ? `Message from ${p.name} via Alexa: "${message}"` : `${p.name} asked you to give them a call.`,
  );
  return T[l].familyTold(caregiverName(link.patient_id, l));
});

const Help: RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(h.requestEnvelope) === "AMAZON.HelpIntent",
  handle: (h) => h.responseBuilder.speak(t(h).help).reprompt(t(h).help).getResponse(),
};

const Fallback: RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" && Alexa.getIntentName(h.requestEnvelope) === "AMAZON.FallbackIntent",
  handle: (h) => h.responseBuilder.speak(t(h).notUnderstood).reprompt(t(h).notUnderstood).getResponse(),
};

const StopCancel: RequestHandler = {
  canHandle: (h) =>
    Alexa.getRequestType(h.requestEnvelope) === "IntentRequest" &&
    ["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NoIntent"].includes(Alexa.getIntentName(h.requestEnvelope)),
  handle: (h) => h.responseBuilder.speak(t(h).bye).withShouldEndSession(true).getResponse(),
};

const SessionEnded: RequestHandler = {
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === "SessionEndedRequest",
  handle: (h) => h.responseBuilder.getResponse(),
};

const Errors: ErrorHandler = {
  canHandle: () => true,
  handle(h, err) {
    console.error("[alexa]", err);
    return h.responseBuilder.speak(t(h).sorry).reprompt(t(h).help).getResponse();
  },
};

const builder = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    Launch,
    LinkDevice,
    PermissionResponse,
    TookMeds,
    DidITake,
    WhatsNext,
    Refill,
    Feeling,
    TellFamily,
    Help,
    Fallback,
    StopCancel,
    SessionEnded,
  )
  .addErrorHandlers(Errors)
  .withApiClient(new Alexa.DefaultApiClient());
if (process.env.ALEXA_SKILL_ID) builder.withSkillId(process.env.ALEXA_SKILL_ID);
export const skill = builder.create();

/** Express middleware for POST /alexa. Signature + timestamp checks are on unless explicitly disabled for local tests. */
export function alexaHandlers() {
  const verify = process.env.ALEXA_SKIP_VERIFY !== "1";
  return new ExpressAdapter(skill, verify, verify).getRequestHandlers();
}
