// Simulated Alexa+ device (Echo Show style) + caregiver phone for the CareCue demo.
// The device shows one scene at a time. The scene comes from the server (/api/state and the scene/ttl_s fields of
// chat and touch responses), which computes it from MCP tool results and the dose log, never from the reply text.
// This is host-side rendering in a simulated Echo: a real Alexa+ device cannot be pushed custom scenes through MCP.

import { STR } from "./strings.js";

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
// Some judge browsers and webviews have no speech synthesis (or no recognition): everything else must still work.
const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
const conversationId = "kitchen-device";
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let lang = Q.get("lang") === "es" ? "es-CL" : "en-US";
let lastEventId = 0;
let busy = false;

// ---------- all device strings, EN and ES (Spanish uses "usted") ----------
const I18N = {
  en: {
    label: "Rosa's kitchen · Alexa+ (simulated)",
    hint: "Say “I took my pills” or “Did I take my Losartan?”",
    placeholder: "…or type here",
    noMicPlaceholder: "No microphone: type here",
    noMic: "Voice input needs Chrome. You can type instead.",
    noMicBanner: "Your browser has no speech recognition: type below or tap a scenario.",
    panel: {
      title: "Try it in 60 seconds",
      play: "\u25b6 Play Rosa's day",
      playing: "Playing...",
      startOver: "Start over",
      hint: "No microphone needed. Each scenario sets up Rosa's home in your own private copy and costs at most one live model turn; every MCP call shows on the wire.",
      privateDemo: "Your own private demo",
      sharedDemo: "Shared demo household",
      demoTime: (where) => `demo time: ${where}`,
      chipsLabel: "Five scenarios",
      resting: "The live demo is resting. Tap a scenario for a recording of a real run.",
      chips: {
        extra: ["Extra dose", "She already took her pills and asks for another one: STOP on the screen, the family is told, the dose log does not change."],
        hedged: ["Hedged answer", "\u201cI think I took it, maybe.\u201d Nothing is written down until she is sure."],
        missed: ["Missed dose to family", "A dose 50 minutes late: Daniel's phone gets the alert (no model)."],
        chest: ["Chest pain", "An emergency: the number in giant digits and an urgent alert for Daniel."],
        spanish: ["Spanish", "A question in Spanish: the screen and the answer switch to Spanish."],
      },
    },
    week: { title: "Last 7 days", onTime: "on time", late: "confirmed late", missed: "not confirmed", sample: "Sample history (demo)", locale: "en-US" },
    micDisabled: "Speech recognition is not available in this browser. Type in the box instead.",
    reminderLine: (names) => `Time for your ${names}. Have you taken them?`,
    offline: "I can't reach CareCue right now.",
    wrong: "Something went wrong.",
    micLabel: "Talk to CareCue",
    typeLabel: "Type to CareCue",
    textSize: "Text size",
    toNight: "Switch to night mode",
    toDay: "Switch to day mode",
    langLabel: "Speech language",
    timeFor: "Time for",
    stillWaiting: "Still waiting",
    wasDue: (t) => `was due at ${t}`,
    tookIt: "I took it",
    notYet: "Not yet",
    notYetReply: "OK. Tell me when you've taken it.",
    writtenDown: "Written down",
    atTime: (t) => `at ${t}`,
    writtenCaption: (meds, t) => `Written down: ${meds} at ${t}.`,
    stop: "STOP",
    stopText: (items) =>
      `You already took ${items.map((i) => `your ${i.name} today at ${i.time}`).join(" and ")}. Please don't take another one.`,
    checkFirst: (cg) => `Please check with ${cg === "your family" ? "your family" : cg} or your pharmacist before taking anything else.`,
    notWritten: "Not written down",
    reasons: {
      unconfirmed: "I wasn't sure you took it, so I wrote nothing.",
      too_early: "It is too early for the next dose.",
      nothing_due: "There is nothing due right now.",
      not_found: "I couldn't find that medicine.",
    },
    call: "Call",
    now: "now",
    sentUrgent: (cg) => `I sent ${cg} an urgent message.`,
    here: "I'm right here with you.",
    next: (names, t) => `Next: ${names} at ${t}`,
    allDone: "All done for today",
    noMore: "No more medicine today",
    demoTime: "demo time",
    tabPhone: "Daniel's phone",
    trySaying: "Try saying",
    say: {
      took: "I took my pills",
      did: (med) => `Did I take my ${med}?`,
      again: "I'll take another one, just in case",
      maybe: "I think I took it, maybe",
      chest: "I have a pain in my chest",
    },
    fxCaptions: {
      ambient: ["", "Say “I took my pills” or “Did I take my Losartan?”"],
      reminder: ["", "It's 8 AM. Time for your Losartan and Metformin. Have you taken them?"],
      late: ["", "Your 8 AM medicine is still waiting. Have you taken it?"],
      confirmed: ["I took my pills.", "Thank you, Rosa. I wrote that down."],
      stop: ["I'll take another one, just in case.", "You already took your Losartan today at 8:02 AM. Please don't take another one. I let Daniel know."],
      check_first: ["Can I take one more?", "I can't say yes to that. Please check with Daniel or your pharmacist first."],
      not_written: ["I think I took it, maybe.", "I didn't write it down because I wasn't sure."],
      emergency: ["I have a pain in my chest.", "Please call 9 1 1 now. I sent Daniel an urgent message."],
      support: ["I feel so alone today.", "I'm right here with you. I sent Daniel an urgent message."],
      done: ["", "All done for today. Rest well, Rosa."],
    },
  },
  es: {
    label: "Cocina de Rosa · Alexa+ (simulado)",
    hint: "Diga “Ya tomé mis pastillas” o “¿Tomé mi Losartan?”",
    placeholder: "…o escriba aquí",
    noMicPlaceholder: "Sin micrófono: escriba aquí",
    noMic: "La voz necesita Chrome. Puede escribir en su lugar.",
    noMicBanner: "Su navegador no tiene reconocimiento de voz: escriba abajo o toque un escenario.",
    panel: {
      title: "Pru\u00e9belo en 60 segundos",
      play: "\u25b6 Ver el d\u00eda de Rosa",
      playing: "Reproduciendo...",
      startOver: "Empezar de nuevo",
      hint: "No necesita micr\u00f3fono. Cada escenario prepara la casa de Rosa en su propia copia privada y cuesta como m\u00e1ximo un turno real del modelo; cada llamada MCP se ve en el cable.",
      privateDemo: "Su demo privada",
      sharedDemo: "Demo compartida",
      demoTime: (where) => `hora de ${where}`,
      chipsLabel: "Cinco escenarios",
      resting: "La demo en vivo descansa. Toque un escenario para ver una grabaci\u00f3n real.",
      chips: {
        extra: ["Dosis de m\u00e1s", "Ya tom\u00f3 sus pastillas y pide otra: ALTO en pantalla, se avisa a la familia y el registro de dosis no cambia."],
        hedged: ["Respuesta dudosa", "\u201cCreo que la tom\u00e9, tal vez.\u201d No se anota nada hasta que est\u00e9 segura."],
        missed: ["Dosis olvidada a la familia", "Una dosis con 50 minutos de retraso: el tel\u00e9fono de Daniel recibe la alerta (sin modelo)."],
        chest: ["Dolor de pecho", "Una emergencia: el n\u00famero en d\u00edgitos gigantes y una alerta urgente para Daniel."],
        spanish: ["Espa\u00f1ol", "Una pregunta en espa\u00f1ol: la pantalla y la respuesta pasan a espa\u00f1ol."],
      },
    },
    week: { title: "\u00daltimos 7 d\u00edas", onTime: "a tiempo", late: "confirmada con retraso", missed: "sin confirmar", sample: "Historial de ejemplo (demo)", locale: "es-CL" },
    micDisabled: "El reconocimiento de voz no está disponible en este navegador. Escriba en el cuadro.",
    reminderLine: (names) => `Es hora de su ${names}. ¿Ya los tomó?`,
    offline: "No puedo conectarme con CareCue ahora.",
    wrong: "Algo salió mal.",
    micLabel: "Hablar con CareCue",
    typeLabel: "Escribir a CareCue",
    textSize: "Tamaño del texto",
    toNight: "Cambiar a modo noche",
    toDay: "Cambiar a modo día",
    langLabel: "Idioma de voz",
    timeFor: "Es hora de",
    stillWaiting: "Seguimos esperando",
    wasDue: (t) => `le tocaba a las ${t}`,
    tookIt: "Ya la tomé",
    notYet: "Todavía no",
    notYetReply: "Está bien. Avíseme cuando la tome.",
    writtenDown: "Anotado",
    atTime: (t) => `a las ${t}`,
    writtenCaption: (meds, t) => `Anotado: ${meds} a las ${t}.`,
    stop: "ALTO",
    stopText: (items) => `Ya tomó ${items.map((i) => `su ${i.name} hoy a las ${i.time}`).join(" y ")}. No se tome otra.`,
    checkFirst: (cg) => `Antes de tomar algo más, consulte con ${cg === "your family" ? "su familia" : cg} o con su farmacéutico.`,
    notWritten: "No quedó anotado",
    reasons: {
      unconfirmed: "No estaba segura de que la tomara, así que no anoté nada.",
      too_early: "Todavía es muy temprano para la próxima dosis.",
      nothing_due: "No hay nada pendiente ahora.",
      not_found: "No encontré esa medicina.",
    },
    call: "Llame al",
    now: "ahora",
    sentUrgent: (cg) => `Le envié un mensaje urgente a ${cg === "your family" ? "su familia" : cg}.`,
    here: "Estoy aquí con usted.",
    next: (names, t) => `Siguiente: ${names} a las ${t}`,
    allDone: "Listo por hoy",
    noMore: "No hay más medicinas hoy",
    demoTime: "hora de demostración",
    tabPhone: "Teléfono de Daniel",
    trySaying: "Pruebe decir",
    say: {
      took: "Ya tomé mis pastillas",
      did: (med) => `¿Tomé mi ${med}?`,
      again: "Voy a tomar otra, por si acaso",
      maybe: "Creo que la tomé, tal vez",
      chest: "Tengo dolor en el pecho",
    },
    fxCaptions: {
      ambient: ["", "Diga “Ya tomé mis pastillas” o “¿Tomé mi Losartan?”"],
      reminder: ["", "Son las 8. Es hora de su Losartan y su Metformin. ¿Ya las tomó?"],
      late: ["", "Su medicina de las 8 sigue pendiente. ¿Ya la tomó?"],
      confirmed: ["Ya tomé mis pastillas.", "Gracias, Rosa. Lo anoté."],
      stop: ["Voy a tomar otra, por si acaso.", "Ya tomó su Losartan hoy a las 8:02. No se tome otra. Le avisé a Daniel."],
      check_first: ["¿Puedo tomar una más?", "No puedo decirle que sí. Consulte primero con Daniel o con su farmacéutico."],
      not_written: ["Creo que la tomé, tal vez.", "No lo anoté porque no estaba segura."],
      emergency: ["Tengo dolor en el pecho.", "Llame al 1 3 1 ahora. Le envié un mensaje urgente a Daniel."],
      support: ["Hoy me siento muy sola.", "Estoy aquí con usted. Le envié un mensaje urgente a Daniel."],
      done: ["", "Listo por hoy. Que descanse, Rosa."],
    },
  },
};
// The replay badge, the resting note, the tour strip, the family phone and the MCP wire tab live in strings.js.
for (const l of ["en", "es"]) Object.assign(I18N[l], STR[l]);
const lk = () => (lang.startsWith("es") ? "es" : "en");
const T = () => I18N[lk()];

// Small phrase map so the dose lines of the demo household also read in Spanish.
const ES_PHRASES = [
  [/with breakfast and dinner/gi, "con el desayuno y la cena"],
  [/with breakfast/gi, "con el desayuno"],
  [/in the morning/gi, "en la mañana"],
  [/with food/gi, "con comida"],
  [/with water/gi, "con agua"],
  [/at bedtime/gi, "al acostarse"],
  [/tablets/gi, "comprimidos"],
  [/tablet/gi, "comprimido"],
  [/capsules/gi, "cápsulas"],
  [/capsule/gi, "cápsula"],
];
const doseText = (m, withHow = true) => {
  let s = [m.dose, withHow ? m.instructions : ""].filter(Boolean).join(" · ");
  if (lk() === "es") for (const [re, to] of ES_PHRASES) s = s.replace(re, to);
  return s;
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const listOf = (names) => new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(names);

/** "08:02" -> "8:02 AM" (EN, whole hours "8 AM"), "8:02" (ES, 24 h). */
function fmtTime(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  if (lk() === "es") return `${h}:${String(m).padStart(2, "0")}`;
  const s = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${s}` : `${h12} ${s}`;
}
/** The phone's one time format: ES is 24 h with two-digit hours everywhere on it ("06:34", "20:00"), EN is 12 h with AM/PM. */
const fmtClock = (hhmm) => (lk() === "es" ? String(hhmm).split(":").map((x) => x.padStart(2, "0")).join(":") : fmtTime(hhmm));
/** The "HH:MM" of an instant in the household's timezone (the page's own when the server reports none). */
function hhmmAt(iso, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timeZone || undefined }).format(new Date(iso));
  } catch {
    return new Date(iso).toTimeString().slice(0, 5);
  }
}
const fmt = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const s = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${s}` : `${h12} ${s}`;
};

// ---------- scene fixtures (?scene=<kind> and carecueDemo.setScene) ----------
const FX_MEDS = [
  { name: "Losartan", dose: "50 mg, 1 tablet", instructions: "in the morning" },
  { name: "Metformin", dose: "850 mg, 1 tablet", instructions: "with breakfast and dinner" },
];
const fixtureScene = (kind) => {
  const es = lk() === "es";
  const f = {
    ambient: { kind: "ambient", next: { medications: ["Metformin"], spoken_time: "8 PM", time: "20:00" } },
    reminder: { kind: "reminder", medications: FX_MEDS, spoken_time: "8 AM", time: "08:00" },
    late: { kind: "late", medications: FX_MEDS, spoken_time: "8 AM", time: "08:00" },
    confirmed: { kind: "confirmed", medications: ["Losartan", "Metformin"], at: "08:02" },
    stop: { kind: "stop", medications: [{ name: "Losartan", taken_at: "08:02" }] },
    check_first: { kind: "check_first", caregiver: "Daniel" },
    not_written: { kind: "not_written", reason: "unconfirmed" },
    emergency: { kind: "emergency", number: es ? "131" : "911", caregiver: "Daniel" },
    support: { kind: "support", caregiver: "Daniel" },
    done: { kind: "done" },
  };
  return f[kind] ?? null;
};
const SCENE_KINDS = ["ambient", "reminder", "late", "confirmed", "stop", "check_first", "not_written", "emergency", "support", "done"];
const FX_CLOCK = { time: "08:02", date: "2026-10-14" }; // only for the ?scene= design pages; a live page never shows it

// ---------- client state ----------
let serverScene = null; // what /api/state says (the latch if there is one, else the baseline)
let override = null; // { scene, until } from a chat or touch response
let design = Q.get("scene") && SCENE_KINDS.includes(Q.get("scene")) ? Q.get("scene") : null; // design-review mode: a fixture scene, no server scene
let designData = null;
let clockState = null;
let deviceInfo = null;
let overrideTimer;

const isLatch = (s) => s && (s.kind === "emergency" || s.kind === "support");

function activeScene() {
  if (design) return { ...fixtureScene(design), ...designData };
  if (isLatch(serverScene)) return serverScene; // a latched scene is never replaced by a later turn
  if (override && Date.now() < override.until) return override.scene;
  return serverScene ?? { kind: "ambient" };
}

function showOverride(scene, ttl_s) {
  if (design || !scene) return;
  override = { scene, until: Date.now() + (ttl_s ?? 8) * 1000 };
  clearTimeout(overrideTimer);
  overrideTimer = setTimeout(applyScene, (ttl_s ?? 8) * 1000 + 30);
  applyScene();
}

// ---------- the light bar ----------
let ringState = "";
function ring(state) {
  ringState = state || "";
  paintRing();
  $("mic").classList.toggle("listening", state === "listening");
}
function paintRing() {
  const kind = $("echo").dataset.scene;
  const base = kind === "reminder" || kind === "late" ? "reminder" : kind === "stop" || kind === "emergency" ? "alert" : "";
  $("ring").className = "ring" + (ringState || base ? " " + (ringState || base) : "");
}

// ---------- scenes ----------
const ICONS = {
  check: `<svg class="icon" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="10"/><path d="M34 62l17 17 36-40" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  warn: `<svg class="icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M60 12 112 104H8Z" fill="none" stroke="currentColor" stroke-width="10" stroke-linejoin="round"/><path d="M60 46v28" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><circle cx="60" cy="88" r="7" fill="currentColor"/></svg>`,
  pause: `<svg class="icon" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="10"/><path d="M60 24v40" stroke="currentColor" stroke-width="12" stroke-linecap="round"/><circle cx="60" cy="86" r="7" fill="currentColor"/></svg>`,
  heart: `<svg class="icon" viewBox="0 0 120 120" aria-hidden="true"><path d="M60 100C20 72 12 50 12 38a24 24 0 0 1 48-6 24 24 0 0 1 48 6c0 12-8 34-48 62Z" fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round"/></svg>`,
  sun: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="currentColor"/><g stroke="currentColor" stroke-width="4" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/></g></svg>`,
  moon: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M38 31A16 16 0 0 1 17 10a16 16 0 1 0 21 21Z" fill="currentColor"/></svg>`,
};

function clockHtml() {
  const c = design ? FX_CLOCK : clockState;
  if (!c) return "--:--"; // no household and no server time yet: no made-up clock
  const [h, m] = c.time.split(":").map(Number);
  if (lk() === "es") return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} <span class="ampm">${h < 12 ? "AM" : "PM"}</span>`;
}

function sceneHtml(s) {
  const t = T();
  switch (s.kind) {
    case "ambient": {
      const n = s.next;
      return `<div class="hero"><div class="hero-clock" id="clock-hero">${clockHtml()}</div>${
        n ? `<p class="line">${esc(t.next(listOf(n.medications), fmtTime(n.time)))}</p>` : ""
      }</div>`;
    }
    case "done":
      return `<div class="hero"><div class="hero-clock" id="clock-hero">${clockHtml()}</div><p class="line">${esc(t.allDone)}</p><p class="sub">${esc(t.noMore)}</p></div>`;
    case "reminder":
    case "late": {
      const late = s.kind === "late";
      const multi = s.medications.length > 1;
      const meds = s.medications
        .map((m) => `<li><span class="med">${esc(m.name)}</span><span class="dose">${esc(doseText(m, !multi))}</span></li>`)
        .join("");
      return `<div class="rem${multi ? " multi" : ""}">
        <p class="kicker">${esc(late ? `${t.stillWaiting} - ${t.wasDue(fmtTime(s.time))}` : t.timeFor)}</p>
        <ul class="meds">${meds}</ul>
        <div class="rem-actions">
          <button class="btn took" data-act="took">${esc(t.tookIt)}</button>
          <button class="btn alt" data-act="not_yet">${esc(t.notYet)}</button>
        </div>
      </div>`;
    }
    case "confirmed":
      return `<div class="conf">${ICONS.check}<div><p class="big">${esc(t.writtenDown)}</p><p class="sub">${esc(listOf(s.medications))}</p><p class="sub">${esc(t.atTime(fmtTime(s.at)))}</p></div></div>`;
    case "stop": {
      const items = s.medications.map((m) => ({ name: m.name, time: fmtTime(m.taken_at) }));
      return `<div class="stopbox"><div class="octa"><span>${esc(t.stop)}</span></div><p class="stop-text">${esc(t.stopText(items))}</p></div>`;
    }
    case "check_first":
      return `<div class="note">${ICONS.pause}<p class="line">${esc(t.checkFirst(s.caregiver))}</p></div>`;
    case "not_written":
      return `<div class="note">${ICONS.warn}<div><p class="big">${esc(t.notWritten)}</p><p class="sub">${esc(t.reasons[s.reason] ?? "")}</p></div></div>`;
    case "emergency": {
      const digits = [...String(s.number)].map((d) => `<span class="digit">${esc(d)}</span>`).join("");
      return `<div class="emg"><div class="emg-row"><span class="emg-word">${esc(t.call)}</span><span class="digits">${digits}</span><span class="emg-word">${esc(t.now)}</span></div><p class="line">${esc(t.sentUrgent(s.caregiver))}</p></div>`;
    }
    case "support":
      return `<div class="support">${ICONS.heart}<p class="big">${esc(t.here)}</p><p class="line">${esc(t.sentUrgent(s.caregiver))}</p></div>`;
  }
  return "";
}

let sceneKey = "";
function applyScene() {
  const s = activeScene();
  const echo = $("echo");
  const key = JSON.stringify(s) + lang + (clockState ? "" : "x");
  echo.dataset.scene = s.kind;
  const box = $("scene");
  box.setAttribute("role", s.kind === "stop" || s.kind === "emergency" || s.kind === "support" ? "alert" : "status");
  if (key !== sceneKey) {
    sceneKey = key;
    const hadFocus = box.contains(document.activeElement);
    box.innerHTML = sceneHtml(s);
    if (hadFocus) $("mic").focus();
  }
  paintRing();
}

// ---------- captions with word-by-word highlight ----------
let words = []; // [{ el, start, end, text }]
let hl = null;

// What the caption shows, so a language switch can say it again in the new language:
//  captionFn: a fixed sentence of the device (reminder line, hint, "written down"...), rebuilt in the new language;
//  captionFree: words the model or a recording said, which cannot be translated: they are dropped for the idle line.
let captionFn = null;
let captionFree = false;
function setReply(text) {
  captionFn = null;
  captionFree = !!text && text !== "…";
  paintReply(text);
}
/** A fixed sentence of the device: `fn()` gives it in the current language. */
function setReplyFn(fn) {
  captionFn = fn;
  captionFree = false;
  paintReply(fn());
}
/** The first-screen line (the due reminder, else the hint). */
function setIdle() {
  captionFn = null;
  captionFree = false;
  paintReply(idleLine());
}
function paintReply(text) {
  stopHighlight();
  const el = $("caption-reply");
  el.textContent = "";
  words = [];
  let pos = 0;
  for (const part of String(text ?? "").split(/(\s+)/)) {
    if (part === "") continue;
    if (/^\s+$/.test(part)) el.append(document.createTextNode(part));
    else {
      const span = document.createElement("span");
      span.className = "w";
      span.textContent = part;
      el.append(span);
      words.push({ el: span, start: pos, end: pos + part.length, text: part });
    }
    pos += part.length;
  }
}
const setUser = (text) => { $("caption-user").textContent = text; };

function paintWord(i) {
  words.forEach((w, k) => {
    w.el.classList.toggle("spoken", k < i);
    w.el.classList.toggle("now", k === i);
  });
}
function stopHighlight() {
  if (hl) { clearInterval(hl.timer); hl.done?.(); hl = null; }
  words.forEach((w) => w.el.classList.remove("now", "spoken"));
}

/**
 * Highlight the reply word by word over `ms`. `wordTimings` (optional) gives each word's start in ms from the
 * beginning (numbers, {start}, or Polly speech marks {time}); without it the time is spread by word length.
 * The recorder calls this with the known voice duration.
 */
function highlightOver(ms, wordTimings) {
  stopHighlight();
  if (!words.length) return Promise.resolve();
  let starts;
  if (Array.isArray(wordTimings) && wordTimings.length) {
    starts = words.map((_, i) => {
      const t = wordTimings[Math.min(i, wordTimings.length - 1)];
      return typeof t === "number" ? t : (t.start ?? t.time ?? 0);
    });
  } else {
    const w = words.map((x) => x.text.length + 2);
    const total = w.reduce((a, b) => a + b, 0);
    let acc = 0;
    starts = w.map((x) => { const s = (acc / total) * ms; acc += x; return s; });
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = () => {
      const e = performance.now() - t0;
      let idx = -1;
      for (let i = 0; i < starts.length; i++) if (starts[i] <= e) idx = i;
      paintWord(idx);
      if (e >= ms) { clearInterval(hl?.timer); const h = hl; hl = null; paintWord(words.length); h?.done?.(); }
    };
    hl = { timer: setInterval(step, 40), done: resolve };
    step();
  });
}

// ---------- speech out ----------
function pickVoice() {
  const voices = synth?.getVoices() ?? [];
  const base = lang.slice(0, 2);
  return (
    voices.find((v) => v.lang === lang && /Samantha|Google|Natural|Premium|Enhanced/i.test(v.name)) ||
    voices.find((v) => v.lang === lang) ||
    voices.find((v) => v.lang.startsWith(base))
  );
}

function speak(text, mode = "speaking") {
  // Recording mode: the voice track is produced separately (the recorder calls highlightOver), so stay silent.
  if (window.CARECUE_SILENT) return Promise.resolve();
  return new Promise((resolve) => {
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return resolve(); // some webviews have no voice: the captions still show
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.97;
    const v = pickVoice();
    if (v) u.voice = v;
    let sawBoundary = false;
    u.onstart = () => {
      ring(mode);
      // Browsers without word boundaries: spread the highlight over an estimate of the speaking time.
      setTimeout(() => { if (!sawBoundary && synth.speaking) highlightOver(Math.max(1200, text.length * 62)); }, 700);
    };
    u.onboundary = (e) => {
      if (e.name && e.name !== "word") return;
      sawBoundary = true;
      if (hl) { clearInterval(hl.timer); hl.done?.(); hl = null; }
      const i = words.findIndex((w) => e.charIndex < w.end);
      paintWord(i === -1 ? words.length : i);
    };
    const end = () => { ring(""); stopHighlight(); resolve(); };
    u.onend = u.onerror = end;
    synth.speak(u);
  });
}

// ---------- speech in ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

/** No speech recognition (Safari, Firefox): say so, disable the mic with a reason and put the cursor in the big text box. */
function paintNoMic() {
  if (SR || design) return;
  const t = T();
  const b = $("nomic-banner");
  b.textContent = t.noMicBanner;
  b.hidden = false;
  $("mic").disabled = true;
  $("mic").setAttribute("aria-label", t.micDisabled);
  $("mic").title = t.micDisabled;
  $("echo").classList.add("no-mic");
}

function listen() {
  if (busy) return;
  if (!SR) {
    $("type-input").focus({ preventScroll: true }); // the mic is disabled, but the space bar and old callers land here
    setUser("");
    setReplyFn(() => T().noMic);
    return;
  }
  try { synth?.cancel(); } catch {}
  recognizer = new SR();
  recognizer.lang = lang;
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 1;
  let finalText = "";
  recognizer.onstart = () => ring("listening");
  recognizer.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    setUser(r[0].transcript);
    if (r.isFinal) finalText = r[0].transcript;
  };
  recognizer.onerror = () => ring("");
  recognizer.onend = () => {
    ring("");
    if (finalText.trim()) ask(finalText.trim());
  };
  recognizer.start();
}

// ---------- server calls ----------
// A visitor's page works on a private sandbox household: POST /api/sandbox once, keep the id in sessionStorage and send it
// as x-carecue-sandbox on every demo call (window.carecueSandbox). A 404 sandbox_expired silently makes a new one.
// A local server that controls its own clock (the recorder, local dev) uses the shared demo household instead, unless
// the URL says ?sandbox=1; ?shared=1 forces the shared household anywhere.
const SB_KEY = "carecue.sandbox";
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
  del: (k) => { try { sessionStorage.removeItem(k); } catch {} },
};
window.carecueSandbox = undefined;
let sandboxFailure = null; // why a private demo could not be made (the demo then rests: scenarios and the tour replay)
let sandboxMode = false; // this page is meant to work on a private household; it never falls back to the shared one
let needSync = false; // a new household: skip its old events instead of reading them out
const resting = () => sandboxMode && !window.carecueSandbox;
const NO_PRIVATE = "no private demo is available right now";
/** A public visitor whose private demo cannot be made rests: no live turns, no shared household, recordings only. */
function noPrivateDemo(err) {
  sandboxFailure = err;
  setRest("noPrivate");
  setReplayBadge(false);
  paintSandboxNote(null);
  if (hintShown) setIdle();
  loadHealthClock();
}

const rawApi = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(window.carecueSandbox ? { "x-carecue-sandbox": window.carecueSandbox } : {}), ...opts.headers },
  });

async function createSandbox() {
  const res = await fetch("/api/sandbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "morning", lang: lk() }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  window.carecueSandbox = data.sandbox_id;
  ss.set(SB_KEY, data.sandbox_id);
  sandboxFailure = null;
  needSync = true;
  return data;
}
let creating = null;
const ensureSandbox = () => (creating ??= createSandbox().finally(() => { creating = null; }));

async function boot() {
  if (design) return; // design-review mode has no server household
  const stored = ss.get(SB_KEY);
  let want = Q.get("sandbox") === "1" || (Q.get("shared") !== "1" && !!stored);
  if (!want && Q.get("shared") !== "1") {
    // Unknown: ask the shared household whether this server lets the clock move (a local recorder) or not (a public instance).
    try {
      const r = await fetch("/api/state");
      want = r.ok ? !(await r.json()).device?.clock_control : false;
    } catch {}
  }
  if (!want) return;
  sandboxMode = true;
  if (stored) window.carecueSandbox = stored; // a stale id is replaced lazily by api() on the first 404 sandbox_expired
  else await ensureSandbox().catch(noPrivateDemo);
}
const booting = boot();

const api = async (path, opts = {}) => {
  await booting;
  // No private household and no way to make one: nothing reaches the shared household from a public page.
  if (resting()) return new Response(JSON.stringify({ error: T().panel.resting }), { status: 503, headers: { "content-type": "application/json" } });
  const used = window.carecueSandbox;
  let res = await rawApi(path, opts);
  if (res.status === 404 && used && (await res.clone().json().catch(() => ({}))).error === "sandbox_expired") {
    if (window.carecueSandbox === used) { window.carecueSandbox = undefined; ss.del(SB_KEY); }
    if (!window.carecueSandbox) await ensureSandbox().catch(noPrivateDemo);
    if (window.carecueSandbox) res = await rawApi(path, opts);
    else return new Response(JSON.stringify({ error: T().panel.resting }), { status: 503, headers: { "content-type": "application/json" } });
  }
  return res;
};
const post = (path, body, extra = {}) => api(path, { method: "POST", body: JSON.stringify(body ?? {}), ...extra });
const announce = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

/** Re-seeds the visitor's household for a scenario (no model). Returns {utterance, lang, replay}. */
async function scenario(id) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await post(`/api/scenario/${id}`, { lang: lk() });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 403 && data.error === "sandbox_required" && !window.carecueSandbox && attempt === 0) {
      await ensureSandbox(); // a public server without a private household for this page yet
      continue;
    }
    throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status, code: data.error });
  }
  throw new Error("could not start a private demo");
}

// ---------- resting banner and the replay badge ----------
const REPLAY_LABEL = STR.en.replay; // the English text (the recorder reads it); the page shows T().replay
let restKey = "";
let restDetail = "";
let replayOn = false;
let replayEnglish = false; // an English recording shown to an ES visitor says so
let replayNoModel = false; // the recorded step on screen never involved the model (a set-up or a touch)
/** The words for a resting reason: a key of strings.js `rest.why` (with a detail for "server"), or a plain text. */
function restWhy(key, detail) {
  const w = T().rest.why[key];
  return typeof w === "function" ? w(detail) : (w ?? key);
}
function paintRest() {
  const n = $("rest-note");
  if (!n) return;
  n.hidden = !restKey;
  n.textContent = restKey ? T().rest.line(restWhy(restKey, restDetail)) : "";
}
/** Says why live model turns are off (or clears it with ""): the scenarios and the tour then play a recording. */
function setRest(key, detail = "") {
  restKey = key || "";
  restDetail = detail;
  paintRest();
}
function paintReplayBadge() {
  const b = $("replay-badge");
  if (!b) return;
  b.hidden = !replayOn;
  const inEn = replayOn && replayEnglish && lang === "es-CL" && !!T().replayInEnglish;
  // "Replay of a real run" + the parenthesis that says why (the resting note above already says it: laptop heights hide it) + the labels.
  const [head, ...why] = (replayOn ? T().replay : "").split(" (");
  b.textContent = head;
  if (why.length) {
    const w = document.createElement("span");
    w.className = "badge-why";
    w.textContent = ` (${why.join(" (")}`;
    b.append(w);
  }
  if (replayOn) b.append((replayNoModel ? ` - ${T().replayNoModel}` : "") + (inEn ? ` - ${T().replayInEnglish}` : ""));
}
/** `english`: this recording is English (the tour and the chips only recorded the Spanish scenario in Spanish); an ES visitor is told. */
function setReplayBadge(on, noModel = false, english = false) {
  replayOn = !!on;
  replayNoModel = replayOn && !!noModel;
  replayEnglish = replayOn && !!english;
  paintReplayBadge();
}

/**
 * What can be used right now. `server`: the demo routes answer (set-ups, touch). `model`: a live model turn is allowed
 * (configured, not paused, this visitor not limited, a private demo exists). `why` says what is missing.
 */
async function usability() {
  // `why`: English text for notes and logs. `whyKey` (+ `whyDetail`): the key of strings.js rest.why, for the resting note.
  const out = { server: false, model: false, why: "", whyKey: "", whyDetail: "" };
  const no = (key, detail = "") => { out.whyKey = key; out.whyDetail = detail; out.why = STR.en.rest.why[key] instanceof Function ? STR.en.rest.why[key](detail) : STR.en.rest.why[key]; };
  try {
    await booting;
    if (resting()) {
      // A visitor action is a good moment to try again (the per-hour cap or a full server may have eased).
      await ensureSandbox().catch((err) => { sandboxFailure = err; });
      if (resting()) { no("noPrivate"); return out; }
      setRest("");
      await refresh();
    }
    const state = await api("/api/state").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
    out.server = true;
    if (sandboxFailure) no("noPrivate");
    else if (!state.model_ready) no("noModel");
    else {
      const limits = await api("/api/limits").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (limits?.paused) no("paused");
      else if (limits && limits.remaining_turns !== null && limits.remaining_turns < 1) no("rateLimited");
      else out.model = true;
    }
  } catch (err) {
    no("server", err.message);
  }
  return out;
}

// ---------- agent ----------
// ask() and touch() return {status, response, reply} so the guided tour can drive them. opts.signal aborts the request;
// opts.waitSpeech === false returns as soon as the answer is on screen (the tour does not wait for the voice).
let hintShown = true;
async function ask(text, opts = {}) {
  busy = true;
  hintShown = false;
  setUser(text);
  setReply("…");
  ring("thinking");
  announce("carecue:turn-start", { kind: "chat", text });
  const out = { status: 0, response: null, reply: "", aborted: false };
  try {
    const res = await post("/api/chat", { conversationId, text }, opts.signal ? { signal: opts.signal } : {});
    const data = await res.json();
    const reply = res.ok ? data.reply : data.error || T().wrong;
    Object.assign(out, { status: res.status, response: data, reply });
    if (!res.ok && !data.error) setReplyFn(() => T().wrong);
    else if (!res.ok && resting()) setReplyFn(() => T().panel.resting);
    else setReply(reply);
    if (res.ok) {
      showOverride(data.scene, data.ttl_s);
      setReplayBadge(false); // this answer is live
      setRest(data.limited ? "dailyLimit" : data.degraded ? "notAnswering" : "");
    }
    announce("carecue:turn", { text, status: res.status, response: data });
    refresh();
    if (opts.waitSpeech === false) {
      busy = false;
      speak(reply);
    } else {
      await speak(reply);
      if (window.CARECUE_SILENT) ring(""); // silent (recording) mode: the recorder sets the speaking light itself
    }
  } catch (err) {
    out.aborted = err?.name === "AbortError";
    if (out.aborted) setReply("…");
    else setReplyFn(() => T().offline);
    ring("");
  } finally {
    busy = false;
  }
  return out;
}

// The big buttons. "I took it" goes through MCP log_dose on the server (a TOUCH chip in the wire view): no model.
async function touch(action, opts = {}) {
  if (busy) return null;
  busy = true;
  document.querySelectorAll("#scene [data-act]").forEach((b) => (b.disabled = true));
  setUser("");
  announce("carecue:turn-start", { kind: "touch", action });
  const out = { status: 0, response: null, reply: "" };
  try {
    const res = await post("/api/device/touch", { action });
    const data = await res.json();
    let reply;
    let say; // the caption as a function of the language, so a switch to ES/EN says it again
    if (!res.ok) { reply = data.error || T().wrong; say = data.error ? null : () => T().wrong; }
    else if (action === "not_yet") { say = () => T().notYetReply; reply = say(); }
    else {
      showOverride(data.scene, data.ttl_s);
      const s = data.scene;
      say = () => (s?.kind === "confirmed" ? T().writtenCaption(listOf(s.medications), fmtTime(s.at)) : s?.kind === "not_written" ? T().reasons[s.reason] : T().wrong);
      reply = say();
    }
    hintShown = false;
    if (say) setReplyFn(say);
    else setReply(reply);
    Object.assign(out, { status: res.status, response: data, reply });
    announce("carecue:touch", { action, status: res.status, response: data });
    refresh();
    if (opts.waitSpeech === false) {
      busy = false;
      speak(reply);
    } else await speak(reply);
  } catch {
    setReplyFn(() => T().offline);
  } finally {
    busy = false;
    sceneKey = ""; // re-draw so the buttons are live again
    applyScene();
  }
  return out;
}

// ---------- rendering ----------
function renderDevice(state) {
  clockState = state.clock;
  deviceInfo = state.device ?? null;
  serverScene = state.scene ?? null;
  // The clock buttons shift one global clock: only a local server that controls its clock shows them.
  document.body.classList.toggle("no-clock", !deviceInfo?.clock_control);
  paintChrome();
  applyScene();
  if (hintShown) {
    const line = idleLine();
    if ($("caption-reply").textContent !== line) setIdle(); // a due reminder is on the first screen, spoken or not
  }
  paintSandboxNote(state);
}

// ---------- "Try saying" chips: what to say next, from what the server reports ----------
let tryKey = "";
function renderTry(state) {
  const box = $("try-chips");
  if (!box) return;
  const t = T().say;
  const list = [];
  if (state.today.due_now.length) list.push(t.took);
  const done = state.today.done_today.filter((d) => d.status === "taken");
  if (done.length) {
    list.push(t.did(done[0].medication));
    list.push(t.again);
  }
  list.push(t.maybe, t.chest);
  const key = JSON.stringify(list) + lang;
  if (key === tryKey) return;
  tryKey = key;
  box.innerHTML = list.map((x) => `<button type="button" class="try-chip" data-say="${esc(x)}">${esc(x)}</button>`).join("");
}
$("try-chips")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-say]");
  if (b && !busy && !document.body.classList.contains("touring")) ask(b.dataset.say);
});

/** "Europe/Paris" -> "Paris"; the country for the one zone the demo household lives in. */
function placeOf(tz) {
  if (!tz) return "";
  if (/^America\/(Santiago|Punta_Arenas)$|^Pacific\/Easter$/.test(tz)) return "Chile";
  return tz === "UTC" ? "UTC" : tz.split("/").pop().replace(/_/g, " ");
}
let lastState = null;
function paintSandboxNote(state) {
  const el = $("sandbox-note");
  if (!el) return;
  const p = T().panel;
  if (!state) { el.textContent = ""; return; }
  lastState = state;
  const where = placeOf(state.timezone);
  el.textContent = `${state.sandbox ? p.privateDemo : p.sharedDemo}${where ? ` \u00b7 ${p.demoTime(where)}` : ""}`;
}

function paintChrome() {
  const c = design ? FX_CLOCK : clockState;
  if (c) {
    $("clock").innerHTML = clockHtml();
    const hero = $("clock-hero");
    if (hero) hero.innerHTML = clockHtml();
    const d = new Date(c.date + "T12:00:00");
    const wd = d.toLocaleDateString(lang, { weekday: "long" });
    const md = d.toLocaleDateString(lang, { day: "numeric", month: "long" });
    $("date").innerHTML = `<span>${esc(wd)}</span><span>${esc(md)}</span>`;
  }
  $("device-label").textContent = T().label + (clockState?.shifted && !design ? ` · ${T().demoTime}` : "");
}

// The lived-in family view: seven days of SAMPLE history (the server labels it), a heat strip, plain counts.
const WEEK_MS = 30_000;
let weekAt = 0;
let weekKey = "";
let lastWeek = null;
async function loadWeek(state, force = false) {
  const key = `${window.carecueSandbox ?? "shared"}|${state.device?.language}`;
  if (!force && key === weekKey && Date.now() - weekAt < WEEK_MS) return;
  weekKey = key;
  weekAt = Date.now();
  try {
    const r = await api("/api/week");
    if (r.ok) renderWeek(await r.json());
  } catch {}
}

/** Server callouts follow the household language; the device language wins when they differ. */
function calloutText(c) {
  const es = lk() === "es";
  const per = { Morning: "de la ma\u00f1ana", Afternoon: "de la tarde", Evening: "de la noche" };
  const perBack = Object.fromEntries(Object.entries(per).map(([a, b]) => [b, a]));
  let m;
  if (es && (m = c.match(/^(Morning|Afternoon|Evening) (.+): confirmed late (\d+) of the last (\d+) days$/))) return `${m[2]} ${per[m[1]]}: confirmada con retraso ${m[3]} de los \u00faltimos ${m[4]} d\u00edas`;
  if (es && (m = c.match(/^(.+): (\d+) doses? not confirmed in the last 7 days$/))) return `${m[1]}: ${m[2]} ${m[2] === "1" ? "toma sin confirmar" : "tomas sin confirmar"} en los \u00faltimos 7 d\u00edas`;
  if (!es && (m = c.match(/^(.+) (de la ma\u00f1ana|de la tarde|de la noche): confirmada con retraso (\d+) de los \u00faltimos (\d+) d\u00edas$/))) return `${perBack[m[2]]} ${m[1]}: confirmed late ${m[3]} of the last ${m[4]} days`;
  if (!es && (m = c.match(/^(.+): (\d+) tomas? sin confirmar en los \u00faltimos 7 d\u00edas$/))) return `${m[1]}: ${m[2]} ${m[2] === "1" ? "dose" : "doses"} not confirmed in the last 7 days`;
  return c;
}

function renderWeek(w) {
  const box = $("week");
  lastWeek = w;
  if (!w?.sample || !Array.isArray(w.doses)) { box.hidden = true; return; }
  box.hidden = false;
  const W = T().week;
  $("week-sample").textContent = W.sample;
  // The seven completed days, oldest first, from the window the server reports.
  const dates = [];
  for (let n = 6; n >= 0; n--) {
    const d = new Date(w.window.today + "T12:00:00");
    d.setDate(d.getDate() - 1 - n);
    dates.push(d.toLocaleDateString("en-CA"));
  }
  const grace = w.grace_minutes ?? 15;
  const cls = (x) => (x.status === "missed" ? "missed" : x.status === "taken" ? ((x.minutes_late ?? 0) > grace ? "late" : "taken") : "other");
  const mark = { taken: "\u2713", late: "!", missed: "\u00d7", other: "\u00b7" };
  const word = (x, c) =>
    c === "taken" ? W.onTime : c === "late" ? (lk() === "es" ? `confirmada con ${x.minutes_late} min de retraso` : `confirmed ${x.minutes_late} min late`) : c === "missed" ? W.missed : x.status;
  let summary = 0;
  $("week-strip").innerHTML = dates
    .map((date) => {
      const list = w.doses.filter((x) => x.date === date);
      const dow0 = new Date(date + "T12:00:00").toLocaleDateString(W.locale, { weekday: "short" }).replace(/\.$/, "");
      const dow = dow0.charAt(0).toUpperCase() + dow0.slice(1);
      const cells = list
        .map((x) => {
          const c = cls(x);
          summary++;
          const label = `${dow} ${x.time} ${x.med}: ${word(x, c)}`;
          return `<i class="cell c-${c}" title="${esc(label)}" aria-label="${esc(label)}">${mark[c]}</i>`;
        })
        .join("");
      return `<div class="wday"><div class="wcells">${cells}</div><div class="wlbl">${esc(dow.slice(0, 2))}</div></div>`;
    })
    .join("");
  $("week-strip").setAttribute("aria-label", `${W.sample}: ${summary} ${lk() === "es" ? "dosis en los \u00faltimos 7 d\u00edas" : "doses over the last 7 days"}`);
  $("week-callouts").innerHTML = (w.callouts ?? []).map((c) => `<li>${esc(calloutText(c))}</li>`).join("");
}

function renderPhone(state) {
  paintPhone(state);
  loadWeek(state);
}

/** The family phone in the device language: labels, the status words, the times. Server alert messages stay as the server wrote them. */
function paintPhone(state) {
  const P = T().phone;
  $("phone-sub").textContent = P.subToday(state.patient, fmtClock(state.clock.time));
  const a = state.adherence.adherence_percent;
  $("adh").textContent = a === null ? "–" : `${a}%`;
  $("refill").textContent = state.refills.filter((r) => r.needs_refill).length;

  $("timeline").innerHTML = state.today.all_today
    .map(
      (x) => `<li><span class="t">${esc(x.time ? fmtClock(x.time) : x.spoken_time)}</span><span>${esc(x.medication)}</span>
      <span class="badge ${esc(x.status)}">${esc(x.status === "taken" && x.taken_at ? P.taken(fmtClock(x.taken_at)) : (P.status[x.status] ?? x.status))}</span></li>`,
    )
    .join("");

  $("alerts").innerHTML = state.alerts.length
    ? state.alerts
        .map(
          (al) => `<li class="${esc(al.severity)} ${al.acknowledged ? "done" : ""}">${escapeHtml(al.message)}
          <div class="when">${esc(fmtClock(hhmmAt(al.created_at, state.timezone)))} · ${esc(P.kind[al.kind] ?? al.kind.replace("_", " "))}${al.acknowledged ? ` · ${esc(P.resolved)}` : ""}</div></li>`,
        )
        .join("")
    : `<li class="empty">${esc(P.noAlerts)}</li>`;

  renderModelPill(state.model_ready);
}

// The topbar pill reads /api/model: the model and provider that really answered (or will answer first).
let modelInfo = null;
let modelReady; // undefined until the first state
function renderModelPill(ready) {
  const ms = $("model-status");
  const pg = T().page;
  if (ready === undefined) return;
  modelReady = ready;
  if (ready && modelInfo) {
    const where = modelInfo.provider === "Amazon Bedrock" && modelInfo.region ? ` - ${modelInfo.region}` : "";
    ms.textContent = `${modelInfo.model_name} - ${modelInfo.provider}${where}`;
    ms.title = modelInfo.last_receipt ? `request ${modelInfo.last_receipt.request_id ?? "n/a"} - ${modelInfo.last_receipt.latency_ms} ms` : pg.modelNoCall;
  } else {
    ms.textContent = ready ? pg.modelReady : pg.modelAdd;
    ms.removeAttribute("title");
  }
  ms.className = "pill " + (ready ? "ok" : "bad");
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

let firstState = true;
async function refresh() {
  try {
    const state = await api("/api/state").then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    modelInfo = await api("/api/model").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    // The first time only: a Spanish-speaking household starts the device in Spanish (a click on EN/ES still wins).
    if (firstState) {
      firstState = false;
      if (!Q.get("lang") && state.device?.language === "es") setLang("es-CL", false);
    }
    renderDevice(state);
    renderPhone(state);
    renderTry(state);
  } catch {
    if (design) { paintChrome(); applyScene(); }
    else if (resting()) loadHealthClock();
  }
}

// With no private household the page cannot read /api/state: show the real server time from /health (or no clock), never a made-up one.
let healthAt = 0;
let healthModel = ""; // the model /health names, shown while no state has said whether it is configured
function paintModelFromHealth() {
  if (modelReady !== undefined || !healthModel) return;
  const ms = $("model-status");
  ms.textContent = healthModel;
  ms.className = "pill";
}
async function loadHealthClock() {
  if (design || Date.now() - healthAt < 10_000) return;
  healthAt = Date.now();
  try {
    const r = await fetch("/health", { cache: "no-store" });
    const h = r.ok ? await r.json() : null;
    if (h?.clock?.time && h?.clock?.date) {
      clockState = { time: h.clock.time, date: h.clock.date, shifted: false };
      if (h.model?.id) healthModel = `${h.model.provider} ${h.model.id}`;
      paintModelFromHealth();
      sceneKey = "";
      paintChrome();
      applyScene();
    }
  } catch {}
}

// ---------- proactive events (reminders + caregiver pushes) ----------
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.innerHTML = `<b>CareCue</b>${escapeHtml(text.replace(/^To [^:]+: /, ""))}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
  if ($("panel-phone").hidden) $("tab-phone").querySelector(".dot").hidden = false; // an alert arrived while the other tab is open
}

async function pollEvents() {
  try {
    if (resting()) return;
    const quiet = needSync;
    needSync = false;
    const res = await api(`/api/events?since=${quiet ? 0 : lastEventId}`);
    if (!res.ok) return;
    const events = await res.json();
    if (quiet) { lastEventId = events.reduce((m, e) => Math.max(m, e.id), 0); return; }
    // A recording on the screen (the replay badge) is not talked over by a fresh reminder.
    const replaying = !$("replay-badge").hidden;
    for (const e of events) {
      lastEventId = Math.max(lastEventId, e.id);
      if (e.kind === "reminder" && !busy && !replaying) {
        // The caption is the device's own reminder line in the device language (built from the due medicines the
        // server reports), not the server's text, which is in the household language.
        setUser("");
        hintShown = true;
        await refresh();
        const line = idleLine();
        const reminderScene = serverScene && (serverScene.kind === "reminder" || serverScene.kind === "late");
        if (!reminderScene) { hintShown = false; setReply(e.text); }
        speak(reminderScene ? line : e.text, "reminder");
      } else if (e.kind === "alert") {
        toast(e.text);
      }
    }
    if (events.length) refresh();
  } catch {}
}

// ---------- tabs ----------
function showTab(name) {
  for (const t of document.querySelectorAll('[role="tab"]')) {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $("panel-" + t.dataset.tab).hidden = !on;
  }
  if (name === "phone") $("tab-phone").querySelector(".dot").hidden = true;
  announce("carecue:tab", { tab: name });
}
document.querySelectorAll('[role="tab"]').forEach((t) => {
  t.addEventListener("click", () => showTab(t.dataset.tab));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const next = tabs[(tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    showTab(next.dataset.tab);
    next.focus();
  });
});

// ---------- language, text size, theme ----------
/** What the device says before anything was said: the due reminder of this morning, else the usual hint. */
function idleLine() {
  if (resting()) return T().panel.resting;
  const sc = serverScene;
  if (sc && (sc.kind === "reminder" || sc.kind === "late") && sc.medications?.length) return T().reminderLine(listOf(sc.medications.map((m) => m.name)));
  return T().hint;
}

function paintStatic() {
  const t = T();
  $("echo").lang = lk();
  $("type-input").placeholder = !SR && !design ? t.noMicPlaceholder : t.placeholder; // no recognition: the box itself says why there is no mic
  $("type-input").setAttribute("aria-label", t.typeLabel);
  $("mic").setAttribute("aria-label", t.micLabel);
  document.querySelector(".lang").setAttribute("aria-label", t.langLabel);
  paintAa();
  paintTheme();
  paintChrome();
  if ($("try-label")) $("try-label").textContent = t.trySaying;
  if (hintShown) setIdle();
  paintNoMic();
  paintPanel();
}

/** The "Try it in 60 seconds" panel and the week strip speak the device language too. */
function paintPanel() {
  const p = T().panel;
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("try60-title", p.title);
  set("start-over", p.startOver);
  set("tour-hint", p.hint);
  $("try60-title")?.setAttribute("title", p.hint);
  $("scenario-chips")?.setAttribute("aria-label", p.chipsLabel);
  const w = T().week;
  set("week-title", w.title);
  document.querySelectorAll("[data-wk]").forEach((e) => (e.textContent = w[e.dataset.wk]));
  // Static page labels: data-i18n="a.b" is the text, data-i18n-html the markup, data-i18n-aria the aria-label.
  const at = (path) => path.split(".").reduce((o, k) => o?.[k], T());
  document.querySelectorAll("[data-i18n]").forEach((e) => { const v = at(e.dataset.i18n); if (typeof v === "string") e.textContent = v; });
  document.querySelectorAll("[data-i18n-html]").forEach((e) => { const v = at(e.dataset.i18nHtml); if (typeof v === "string") e.innerHTML = v; });
  document.querySelectorAll("[data-i18n-aria]").forEach((e) => { const v = at(e.dataset.i18nAria); if (typeof v === "string") e.setAttribute("aria-label", v); });
  document.documentElement.lang = lk();
  document.title = T().page.title;
  paintRest();
  paintReplayBadge();
  if (lastWeek) renderWeek(lastWeek);
  if (lastState) { paintSandboxNote(lastState); paintPhone(lastState); }
  else if (resting()) paintSandboxNote(null);
  if (modelReady !== undefined) renderModelPill(modelReady);
  else if (healthModel) paintModelFromHealth();
  else $("model-status").textContent = T().page.modelChecking;
  announce("carecue:lang", { lang: lk() });
}

/** After a language switch: fixed sentences are said again in the new language; words of the model or of a recording
 * (which cannot be translated) give way to the first-screen line, so no caption stays behind in the old language. */
function relocalizeCaption() {
  if (design) paintDesignCaptions();
  else if (captionFn) paintReply(captionFn());
  else if (captionFree) {
    setUser("");
    hintShown = true;
    setReplayBadge(false); // the recording it labelled is off the screen
  }
}

function setLang(l, rerender = true) {
  const changed = l !== lang;
  lang = l;
  document.querySelectorAll(".lang button").forEach((x) => {
    const on = x.dataset.lang === l;
    x.classList.toggle("on", on);
    x.setAttribute("aria-pressed", String(on));
  });
  if (changed) relocalizeCaption();
  sceneKey = "";
  paintStatic();
  if (rerender) {
    applyScene();
    refresh();
  }
}

const ZOOMS = ["100", "125", "150"];
let zoom = ZOOMS.includes(Q.get("z")) ? Q.get("z") : ZOOMS.includes(store.get("carecue.zoom")) ? store.get("carecue.zoom") : "100";
function paintAa() {
  const b = $("aa");
  $("echo").dataset.zoom = zoom;
  b.textContent = `Aa ${zoom}%`;
  b.setAttribute("aria-label", `${T().textSize}: ${zoom}%`);
  if (zoom === "100") b.removeAttribute("data-active");
  else b.setAttribute("data-active", "");
}
$("aa").addEventListener("click", () => {
  zoom = ZOOMS[(ZOOMS.indexOf(zoom) + 1) % ZOOMS.length];
  store.set("carecue.zoom", zoom);
  paintAa();
});

let theme = ["day", "night"].includes(Q.get("theme")) ? Q.get("theme") : store.get("carecue.theme") === "night" ? "night" : "day";
function paintTheme() {
  const b = $("theme");
  $("echo").dataset.theme = theme;
  b.innerHTML = theme === "night" ? ICONS.moon : ICONS.sun;
  b.setAttribute("aria-label", theme === "night" ? T().toDay : T().toNight);
  if (theme === "night") b.setAttribute("data-active", "");
  else b.removeAttribute("data-active");
}
$("theme").addEventListener("click", () => {
  theme = theme === "day" ? "night" : "day";
  store.set("carecue.theme", theme);
  paintTheme();
});

// ---------- wiring ----------
$("mic").addEventListener("click", listen);
$("scene").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b && !design) touch(b.dataset.act);
  else if (b && design) { // design-review mode: no server write, just show the next state
    if (b.dataset.act === "took") setSceneHook("confirmed");
  }
});
$("type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("type-input").value.trim();
  if (!v) return;
  $("type-input").value = "";
  ask(v);
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !["INPUT", "BUTTON"].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    listen();
  }
  // X flips between Daniel's phone and the MCP wire (not while typing, not with a modifier key).
  if (e.key.toLowerCase() === "x" && !e.ctrlKey && !e.metaKey && !e.altKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
    showTab($("panel-wire").hidden ? "wire" : "phone");
  }
});
document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
document.querySelectorAll("[data-time]").forEach((b) =>
  b.addEventListener("click", async () => {
    await post("/api/clock", { time: b.dataset.time });
    await pollEvents();
    refresh();
  }),
);
$("real-time").addEventListener("click", async () => {
  await post("/api/clock", { reset: true });
  refresh();
});
$("reset").addEventListener("click", async () => {
  await post("/api/reset");
  await post("/api/chat/reset", { conversationId });
  try { synth?.cancel(); } catch {}
  override = null;
  hintShown = true;
  setUser("");
  setIdle();
  refresh();
});

/** The caption pair of the ?scene= design page, in the current language. */
function paintDesignCaptions() {
  const [u, r] = T().fxCaptions[design] ?? ["", ""];
  hintShown = false;
  setUser(u);
  setReplyFn(() => T().fxCaptions[design]?.[1] ?? "");
  return u;
}

// Design-review and test hook: draw any scene (fixture data unless given), for `ttl_s` seconds when live.
function setSceneHook(kind, data, ttl_s) {
  const base = fixtureScene(kind);
  if (!base) return null;
  if (design) {
    design = kind;
    designData = data ?? null;
    sceneKey = "";
    paintDesignCaptions();
    applyScene();
    return activeScene();
  }
  const scene = { ...base, ...(data ?? {}) };
  showOverride(scene, ttl_s ?? 8);
  return scene;
}

if (Q.get("clean") === "1") document.body.classList.add("clean"); // no demo bar, no chips (the recorder)
if (design) document.body.classList.add("design"); // design review (?scene=): just the device
if (!SR) $("echo").classList.add("no-mic");
// Don't replay reminders that fired before the page opened.
api("/api/events?since=0").then((r) => r.json()).then((ev) => { lastEventId = ev.reduce((m, e) => Math.max(m, e.id), 0); }).catch(() => {});
try { synth?.getVoices(); } catch {}
// Hooks for scripted demo recordings (video/record.mjs) and tests.
window.carecueDemo = {
  ask, ring, refresh, pollEvents, touch,
  setScene: setSceneHook,
  highlightOver,
  showTab,
};
// Clears what the last turn left on the device (the tour and the scenario chips call this after they re-seed the household).
// opts.idle: show the first-screen line again (the due reminder), as if the page had just opened. opts.quiet: do not read
// out the reminders the re-seed just created.
async function resetView(opts = {}) {
  try { synth?.cancel(); } catch {}
  override = null;
  clearTimeout(overrideTimer);
  hintShown = !!opts.idle;
  setUser("");
  setReply("");
  sceneKey = "";
  if (opts.quiet) {
    try {
      const ev = await api("/api/events?since=0").then((r) => r.json());
      lastEventId = ev.reduce((m, e) => Math.max(m, e.id), lastEventId);
    } catch {}
  }
  return refresh();
}
// Laptop heights (<= 820 px): a long answer must not push the mic and the typing box below the fold. When it would, the echo gets
// the "tight" class (smaller gaps, no "last tool" chip, a slimmer top row and mic row); the words keep their size. Re-checked
// whenever the scene, the caption or the size changes.
const LOW = window.matchMedia("(min-width: 900px) and (max-height: 820px)");
let fitQueued = false;
function fitLow() {
  fitQueued = false;
  const echo = $("echo");
  const box = $("type-input");
  if (!echo || !box) return;
  echo.classList.remove("tight");
  if (!LOW.matches || design) return;
  if (box.getBoundingClientRect().bottom + window.scrollY > window.innerHeight - 12) echo.classList.add("tight");
}
function queueFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(fitLow);
}
new MutationObserver(queueFit).observe($("echo"), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["data-scene", "data-zoom", "data-theme", "lang", "hidden"] });
window.addEventListener("resize", queueFit);
document.fonts?.ready.then(queueFit);

// What the wire view and the guided tour need from the device (ES modules in separate files).
window.carecueUI = {
  showTab, wireMount: $("wire-mount"), api, post,
  ask, touch, refresh, resetView, setLang, showOverride, setUser, setReply, speak, toast,
  scenario, usability, ensureSandbox, setRest, setReplayBadge, setReplyFn, restWhy, REPLAY_LABEL, loadWeek: (force) => api("/api/state").then((r) => r.json()).then((st) => loadWeek(st, force ?? true)).catch(() => {}),
  ready: booting,
  sandboxFailure: () => sandboxFailure,
  resting,
  t: () => T(),
  getLang: () => lang,
  isBusy: () => busy,
};

setLang(lang, false);
if (design) paintDesignCaptions();
paintStatic();
applyScene();
if (!SR && !design) $("type-input").focus({ preventScroll: true }); // no microphone: the big text box is the way in
if (Q.get("wire") === "1") showTab("wire");
refresh();
// A hidden tab stops polling, so a forgotten tab keeps nothing warm on the server.
setInterval(() => { if (!document.hidden) refresh(); }, 3000);
setInterval(() => { if (!document.hidden) pollEvents(); }, 1500);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
