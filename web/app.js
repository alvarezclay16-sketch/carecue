// Simulated Alexa+ device (Echo Show style) + caregiver phone for the CareCue demo.
// The device shows one scene at a time. The scene comes from the server (/api/state and the scene/ttl_s fields of
// chat and touch responses), which computes it from MCP tool results and the dose log, never from the reply text.
// This is host-side rendering in a simulated Echo: a real Alexa+ device cannot be pushed custom scenes through MCP.

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
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
    noMic: "Voice input needs Chrome. You can type instead.",
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
    noMic: "La voz necesita Chrome. Puede escribir en su lugar.",
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
const FX_CLOCK = { time: "08:02", date: "2026-10-14" };

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
  const c = design ? FX_CLOCK : (clockState ?? FX_CLOCK);
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

function setReply(text) {
  stopHighlight();
  const el = $("caption-reply");
  el.textContent = "";
  words = [];
  let pos = 0;
  for (const part of String(text).split(/(\s+)/)) {
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
  const voices = speechSynthesis.getVoices();
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
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.97;
    const v = pickVoice();
    if (v) u.voice = v;
    let sawBoundary = false;
    u.onstart = () => {
      ring(mode);
      // Browsers without word boundaries: spread the highlight over an estimate of the speaking time.
      setTimeout(() => { if (!sawBoundary && speechSynthesis.speaking) highlightOver(Math.max(1200, text.length * 62)); }, 700);
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
    speechSynthesis.speak(u);
  });
}

// ---------- speech in ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

function listen() {
  if (busy) return;
  if (!SR) {
    $("type-input").focus();
    setUser("");
    setReply(T().noMic);
    return;
  }
  speechSynthesis.cancel();
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
// A private demo (sandbox) sets window.carecueSandbox to its id; every call then acts on that household.
const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(window.carecueSandbox ? { "x-carecue-sandbox": window.carecueSandbox } : {}), ...opts.headers },
  });
const post = (path, body, extra = {}) => api(path, { method: "POST", body: JSON.stringify(body ?? {}), ...extra });
const announce = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

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
    setReply(reply);
    if (res.ok) showOverride(data.scene, data.ttl_s);
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
    setReply(out.aborted ? "…" : T().offline);
    ring("");
    announce("carecue:turn-end", { kind: "chat", failed: true });
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
    if (!res.ok) reply = data.error || T().wrong;
    else if (action === "not_yet") reply = T().notYetReply;
    else {
      showOverride(data.scene, data.ttl_s);
      const s = data.scene;
      reply = s?.kind === "confirmed" ? T().writtenCaption(listOf(s.medications), fmtTime(s.at)) : s?.kind === "not_written" ? T().reasons[s.reason] : T().wrong;
    }
    hintShown = false;
    setReply(reply);
    Object.assign(out, { status: res.status, response: data, reply });
    announce("carecue:touch", { action, status: res.status, response: data });
    refresh();
    if (opts.waitSpeech === false) {
      busy = false;
      speak(reply);
    } else await speak(reply);
  } catch {
    setReply(T().offline);
    announce("carecue:turn-end", { kind: "touch", failed: true });
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
  paintChrome();
  applyScene();
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

function renderPhone(state) {
  $("phone-sub").textContent = `${state.patient} · ${state.clock.spoken}`;
  const a = state.adherence.adherence_percent;
  $("adh").textContent = a === null ? "–" : `${a}%`;
  $("refill").textContent = state.refills.filter((r) => r.needs_refill).length;

  $("timeline").innerHTML = state.today.all_today
    .map(
      (x) => `<li><span class="t">${x.spoken_time}</span><span>${x.medication}</span>
      <span class="badge ${x.status}">${x.status === "taken" && x.taken_at ? "taken " + fmt(x.taken_at) : x.status}</span></li>`,
    )
    .join("");

  $("alerts").innerHTML = state.alerts.length
    ? state.alerts
        .map(
          (al) => `<li class="${al.severity} ${al.acknowledged ? "done" : ""}">${escapeHtml(al.message)}
          <div class="when">${new Date(al.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${al.kind.replace("_", " ")}${al.acknowledged ? " · resolved" : ""}</div></li>`,
        )
        .join("")
    : `<li class="empty">No alerts. All good.</li>`;

  renderModelPill(state.model_ready);
}

// The topbar pill reads /api/model: the model and provider that really answered (or will answer first).
let modelInfo = null;
function renderModelPill(ready) {
  const ms = $("model-status");
  if (ready && modelInfo) {
    const where = modelInfo.provider === "Amazon Bedrock" && modelInfo.region ? ` - ${modelInfo.region}` : "";
    ms.textContent = `${modelInfo.model_name} - ${modelInfo.provider}${where}`;
    ms.title = modelInfo.last_receipt ? `request ${modelInfo.last_receipt.request_id ?? "n/a"} - ${modelInfo.last_receipt.latency_ms} ms` : "no model call yet";
  } else {
    ms.textContent = ready ? "voice agent: ready" : "voice agent: add model credentials";
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
  }
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
    const events = await api(`/api/events?since=${lastEventId}`).then((r) => r.json());
    for (const e of events) {
      lastEventId = Math.max(lastEventId, e.id);
      if (e.kind === "reminder" && !busy) {
        hintShown = false;
        setUser("");
        setReply(e.text);
        speak(e.text, "reminder");
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
function paintStatic() {
  const t = T();
  $("echo").lang = lk();
  $("type-input").placeholder = t.placeholder;
  $("type-input").setAttribute("aria-label", t.typeLabel);
  $("mic").setAttribute("aria-label", t.micLabel);
  document.querySelector(".lang").setAttribute("aria-label", t.langLabel);
  paintAa();
  paintTheme();
  paintChrome();
  if ($("try-label")) $("try-label").textContent = t.trySaying;
  if (hintShown) setReply(t.hint);
}

function setLang(l, rerender = true) {
  lang = l;
  document.querySelectorAll(".lang button").forEach((x) => {
    const on = x.dataset.lang === l;
    x.classList.toggle("on", on);
    x.setAttribute("aria-pressed", String(on));
  });
  if (rerender) {
    sceneKey = "";
    paintStatic();
    applyScene();
    refresh();
  } else {
    sceneKey = "";
    paintStatic();
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
  speechSynthesis.cancel();
  override = null;
  hintShown = true;
  setUser("");
  setReply(T().hint);
  refresh();
});

// Design-review and test hook: draw any scene (fixture data unless given), for `ttl_s` seconds when live.
function setSceneHook(kind, data, ttl_s) {
  const base = fixtureScene(kind);
  if (!base) return null;
  if (design) {
    design = kind;
    designData = data ?? null;
    sceneKey = "";
    const [u, r] = T().fxCaptions[kind] ?? ["", ""];
    hintShown = false;
    setUser(u);
    setReply(r);
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
speechSynthesis?.getVoices();
// Hooks for scripted demo recordings (video/record.mjs) and tests.
window.carecueDemo = {
  ask, ring, refresh, pollEvents, touch,
  setScene: setSceneHook,
  highlightOver,
  showTab,
};
// Clears what the last turn left on the device (the tour calls this after it re-seeds the household).
function resetView() {
  try { speechSynthesis.cancel(); } catch {}
  override = null;
  clearTimeout(overrideTimer);
  hintShown = false;
  setUser("");
  setReply("");
  sceneKey = "";
  return refresh();
}
// What the wire view and the guided tour need from the device (ES modules in separate files).
window.carecueUI = {
  showTab, wireMount: $("wire-mount"), api, post,
  ask, touch, refresh, resetView, setLang, showOverride, setUser, setReply, speak, toast,
  getLang: () => lang,
  isBusy: () => busy,
};

setLang(lang, false);
if (design) {
  const [u, r] = T().fxCaptions[design] ?? ["", ""];
  hintShown = false;
  setUser(u);
  setReply(r);
}
paintStatic();
applyScene();
if (Q.get("wire") === "1") showTab("wire");
refresh();
setInterval(refresh, 3000);
setInterval(pollEvents, 1500);
