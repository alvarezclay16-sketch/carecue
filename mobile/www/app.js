// CareCue mobile app: one app, two modes.
//  - Senior mode: a big clock, the next medicine, one huge "I took it" button, help buttons, voice.
//  - Family mode: today at a glance, alerts, medicine list, and codes to connect Alexa or Grandma's phone.

const API = window.CARECUE_API || "";
const Cap = window.Capacitor;
const native = !!Cap?.isNativePlatform?.();
const plugin = (name) => (native ? Cap.Plugins?.[name] : undefined);

// ---------- strings ----------
const S = {
  es: {
    appName: "CareCue",
    welcome: "Te ayuda a tomar los remedios a tiempo, y a tu familia a estar tranquila.",
    whoUses: "¿Quién va a usar este teléfono?",
    iAmFamily: "Soy familiar", iAmFamilySub: "Quiero cuidar a alguien",
    iAmSenior: "Tomo los remedios", iAmSeniorSub: "Mi familia me dio un código",
    enterCode: "Escribe el código de 4 números", enterCodeSub: "Te lo da tu familiar desde su app, en «Conectar».",
    continue: "Continuar", back: "Volver", save: "Guardar", cancel: "Cancelar", done: "Listo",
    step: (a, b) => `Paso ${a} de ${b}`,
    whoCare: "¿A quién vas a cuidar?", theirName: "Su nombre", yourName: "Tu nombre", relationship: "¿Qué eres de esa persona?",
    relOpts: ["Hijo/a", "Nieto/a", "Pareja", "Cuidador/a", "Otro"], yourPhone: "Tu teléfono (para que te llamen)",
    language: "Idioma de la persona", es: "Español", en: "English",
    addMed: "Agregar remedio", medName: "Nombre del remedio", medNamePh: "Ej: Losartán", medDose: "Dosis", medDosePh: "Ej: 50 mg, 1 comprimido",
    medWhen: "¿A qué hora se toma?", medHowMany: "¿Cuántas pastillas hay en la caja?", medInstr: "Indicación (opcional)", medInstrPh: "Ej: con el desayuno",
    times: [["08:00", "Mañana"], ["13:00", "Almuerzo"], ["18:00", "Tarde"], ["21:00", "Noche"]], otherTime: "Otra hora",
    needName: "Falta el nombre.", needTime: "Elige al menos una hora.",
    hello: (n) => { const h = new Date().getHours(); return `${h < 12 ? "Buenos días" : h < 20 ? "Buenas tardes" : "Buenas noches"}, ${n}`; },
    timeFor: "Es hora de tomar", stillWaiting: "Todavía falta", next: "Tu próximo remedio", allDone: "¡Terminaste por hoy!", allDoneSub: "No te queda ningún remedio.",
    at: (t) => `a las ${t}`, iTookIt: "Ya me lo tomé", today: "Hoy",
    wellDone: "¡Muy bien!", logged: "Lo anoté.", nextIs: (n, t) => `Lo próximo: ${n} a las ${t}.`,
    already: "Ya estaba anotado", dontRepeat: "No te tomes otra.", nothingNow: "Ahora no tienes remedios pendientes.",
    feelBad: "Me siento mal", needHelp: "Necesito ayuda", helpSent: (n) => `Le avisé a ${n}.`, call: (n) => `Llamar a ${n}`,
    talk: "Hablar", talkTo: "Hablar con CareCue", listening: "Te escucho…", textSize: "Letra",
    st: { taken: "Tomado", reminded: "Ahora", scheduled: "Pendiente", missed: "Atrasado", skipped: "Saltado" },
    tabs: ["Hoy", "Remedios", "Avisos", "Conectar"],
    allGood: "Todo al día", pending: "Tiene remedios pendientes", late: "Hay una dosis atrasada",
    adherence: "Tomados a tiempo (7 días)", refillNeed: "Hay que comprar", daysLeft: (d) => `quedan ${d} días`,
    noAlerts: "Sin avisos. Todo tranquilo.", resolve: "Marcar como visto", seen: "Visto",
    connectAlexa: "Conectar Alexa", connectAlexaHow: "En el Alexa de la casa, di:",
    alexaOpen: "«Alexa, abre mi pastillero»", alexaCode: (c) => `«Mi código es ${c.split("").join(" ")}»`,
    alexaLinked: "Alexa conectada ✓", alexaNo: "Alexa aún no está conectada",
    seniorPhone: (n) => `Agregar el teléfono de ${n}`, otherFamily: "Agregar otro familiar",
    codeFor: "Este código dura 15 minutos", newCode: "Mostrar código",
    remove: "Quitar", removeQ: (n) => `¿Quitar ${n} de la lista?`, refill: "Agregué pastillas", howManyAdded: "¿Cuántas pastillas agregaste?",
    signOut: "Cerrar sesión en este teléfono", offline: "Sin conexión. Reintentando…",
    reminderTitle: "Hora del remedio", reminderBody: (n) => `Es hora de tomar ${n}`,
    alertTitle: "Aviso de CareCue",
  },
  en: {
    appName: "CareCue",
    welcome: "Helps you take your medicine on time, and gives your family peace of mind.",
    whoUses: "Who will use this phone?",
    iAmFamily: "I'm family", iAmFamilySub: "I want to look after someone",
    iAmSenior: "I take the medicine", iAmSeniorSub: "My family gave me a code",
    enterCode: "Type the 4-digit code", enterCodeSub: "Your family member finds it in their app, under “Connect”.",
    continue: "Continue", back: "Back", save: "Save", cancel: "Cancel", done: "Done",
    step: (a, b) => `Step ${a} of ${b}`,
    whoCare: "Who are you caring for?", theirName: "Their name", yourName: "Your name", relationship: "How are you related?",
    relOpts: ["Son/Daughter", "Grandchild", "Partner", "Caregiver", "Other"], yourPhone: "Your phone (so they can call you)",
    language: "Their language", es: "Español", en: "English",
    addMed: "Add a medicine", medName: "Medicine name", medNamePh: "e.g. Losartan", medDose: "Dose", medDosePh: "e.g. 50 mg, 1 tablet",
    medWhen: "When is it taken?", medHowMany: "How many tablets are in the box?", medInstr: "Instructions (optional)", medInstrPh: "e.g. with breakfast",
    times: [["08:00", "Morning"], ["13:00", "Lunch"], ["18:00", "Afternoon"], ["21:00", "Night"]], otherTime: "Other time",
    needName: "Please add a name.", needTime: "Pick at least one time.",
    hello: (n) => { const h = new Date().getHours(); return `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, ${n}`; },
    timeFor: "Time to take", stillWaiting: "Still waiting", next: "Your next medicine", allDone: "All done for today!", allDoneSub: "No more medicine today.",
    at: (t) => `at ${t}`, iTookIt: "I took it", today: "Today",
    wellDone: "Well done!", logged: "I wrote it down.", nextIs: (n, t) => `Next: ${n} at ${t}.`,
    already: "Already written down", dontRepeat: "Please don't take another one.", nothingNow: "You have no medicine due right now.",
    feelBad: "I don't feel well", needHelp: "I need help", helpSent: (n) => `I let ${n} know.`, call: (n) => `Call ${n}`,
    talk: "Talk", talkTo: "Talk to CareCue", listening: "Listening…", textSize: "Text",
    st: { taken: "Taken", reminded: "Now", scheduled: "Later", missed: "Late", skipped: "Skipped" },
    tabs: ["Today", "Medicines", "Alerts", "Connect"],
    allGood: "All on track", pending: "Medicine due now", late: "A dose is late",
    adherence: "Taken on time (7 days)", refillNeed: "Needs a refill", daysLeft: (d) => `${d} days left`,
    noAlerts: "No alerts. All quiet.", resolve: "Mark as seen", seen: "Seen",
    connectAlexa: "Connect Alexa", connectAlexaHow: "Say to the Alexa at home:",
    alexaOpen: "“Alexa, open Care Cue”", alexaCode: (c) => `“My code is ${c.split("").join(" ")}”`,
    alexaLinked: "Alexa connected ✓", alexaNo: "Alexa isn't connected yet",
    seniorPhone: (n) => `Add ${n}'s phone`, otherFamily: "Add another family member",
    codeFor: "This code lasts 15 minutes", newCode: "Show code",
    remove: "Remove", removeQ: (n) => `Remove ${n} from the list?`, refill: "I added tablets", howManyAdded: "How many tablets did you add?",
    signOut: "Sign out on this phone", offline: "No connection. Retrying…",
    reminderTitle: "Medicine time", reminderBody: (n) => `Time to take ${n}`,
    alertTitle: "CareCue alert",
  },
};

// ---------- state ----------
const store = {
  get: (k, d) => { try { const v = localStorage.getItem("cc." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("cc." + k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem("cc." + k); } catch {} },
};

const st = {
  token: store.get("token", null),
  role: store.get("role", null),
  lang: store.get("lang", navigator.language?.startsWith("en") ? "en" : "es"),
  fs: store.get("fs", 1),
  screen: "home",
  tab: 0,
  data: null,
  lastEvent: store.get("lastEvent", 0),
  draft: {},
  code: null,
};
const L = () => S[st.lang];
document.documentElement.style.setProperty("--fs", st.fs);
document.documentElement.lang = st.lang;

// ---------- helpers ----------
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (st.lang === "es") return `${h}:${String(m).padStart(2, "0")}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}`;
};
const joinNames = (list) => {
  const arr = [...new Set(list)];
  return arr.length < 2 ? arr.join("") : `${arr.slice(0, -1).join(", ")} ${st.lang === "es" ? "y" : "and"} ${arr.at(-1)}`;
};

async function api(path, opts = {}) {
  const res = await fetch(API + "/api/app" + path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(st.token ? { authorization: "Bearer " + st.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && st.token) { signOut(); throw new Error(data.error || "401"); }
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

let toastTimer;
function toast(msg, ms = 4000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// Voice out: native TTS on Android, the browser's voice elsewhere.
async function speak(text) {
  const tts = plugin("TextToSpeech");
  const lang = st.lang === "es" ? "es-CL" : "en-US";
  try {
    if (tts) return await tts.speak({ text, lang, rate: 0.95 });
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang; u.rate = 0.95;
      speechSynthesis.speak(u);
    }
  } catch {}
}

function haptic() { try { plugin("Haptics")?.impact({ style: "HEAVY" }) ?? navigator.vibrate?.(60); } catch {} }

// ---------- notifications ----------
async function ensureNotifyPermission() {
  const ln = plugin("LocalNotifications");
  if (ln) { try { await ln.requestPermissions(); } catch {} return; }
  if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch {} }
}

async function notify(title, body) {
  const ln = plugin("LocalNotifications");
  try {
    if (ln) return await ln.schedule({ notifications: [{ id: Math.floor(Math.random() * 1e9), title, body }] });
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(title, { body, icon: "icon.svg" });
  } catch {}
}

/** Senior phone: one repeating daily notification per medicine time, rescheduled when the list changes. */
async function scheduleDailyReminders(meds) {
  const ln = plugin("LocalNotifications");
  if (!ln) return;
  const byTime = {};
  for (const m of meds) for (const t of m.times) (byTime[t] ||= []).push(m.name);
  const sig = JSON.stringify(Object.entries(byTime).sort()) + st.lang;
  if (store.get("remSig") === sig) return;
  try {
    const pending = await ln.getPending();
    if (pending.notifications?.length) await ln.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    const list = Object.entries(byTime).map(([t, names], i) => {
      const [hour, minute] = t.split(":").map(Number);
      return { id: 1000 + i, title: L().reminderTitle, body: L().reminderBody(joinNames(names)), schedule: { on: { hour, minute }, allowWhileIdle: true }, channelId: "meds" };
    });
    await ln.createChannel?.({ id: "meds", name: "Medicinas", importance: 5, sound: "default", vibration: true }).catch(() => {});
    if (list.length) await ln.schedule({ notifications: list });
    store.set("remSig", sig);
  } catch (e) { console.warn("reminders", e); }
}

// ---------- data loop ----------
async function refresh() {
  if (!st.token) return;
  try {
    st.data = await api("/state");
    if (st.data.patient?.language && st.data.patient.language !== st.lang) setLang(st.data.patient.language, false);
    if (st.role === "patient") scheduleDailyReminders(st.data.medications);
    if (!document.querySelector(".field:focus")) render();
  } catch (e) {
    if (e.message !== "401") toast(L().offline, 2500);
  }
}

async function pollEvents() {
  if (!st.token) return;
  try {
    const events = await api(`/events?since=${st.lastEvent}`);
    for (const e of events) {
      st.lastEvent = Math.max(st.lastEvent, e.id);
      if (st.role === "caregiver" && e.kind === "alert") notify(L().alertTitle, e.text.replace(/^To [^:]+: /, ""));
      if (st.role === "patient" && e.kind === "reminder") { speak(e.text); haptic(); }
    }
    store.set("lastEvent", st.lastEvent);
    if (events.length) refresh();
  } catch {}
}

// ---------- actions ----------
function setLang(lang, rerender = true) {
  st.lang = lang; store.set("lang", lang); document.documentElement.lang = lang;
  if (rerender) render();
}

function cycleSize() {
  st.fs = st.fs >= 1.3 ? 1 : +(st.fs + 0.15).toFixed(2);
  store.set("fs", st.fs);
  document.documentElement.style.setProperty("--fs", st.fs);
}

function signIn(token, role) {
  st.token = token; st.role = role;
  store.set("token", token); store.set("role", role);
  st.screen = "home"; st.tab = 0;
  ensureNotifyPermission();
  refresh();
}

function signOut() {
  ["token", "role", "remSig", "lastEvent"].forEach(store.del);
  st.token = null; st.role = null; st.data = null; st.screen = "home";
  render();
}

async function tookIt() {
  haptic();
  try {
    const r = await api("/doses", { body: { medication: "all_due", status: "taken" } });
    await refresh();
    const next = st.data?.today?.next_up?.[0];
    if (r.ok) {
      const names = joinNames(r.logged.map((x) => x.medication));
      const line = next ? L().nextIs(next.medication, fmt(next.time)) : L().allDoneSub;
      showConfirm("ok", L().wellDone, `${L().logged} ${names}. ${line}`);
      speak(`${L().wellDone} ${L().logged} ${line}`);
    } else {
      const msg = r.warnings?.includes("possible_double_dose") ? L().dontRepeat : L().nothingNow;
      showConfirm("warn", r.warnings?.includes("possible_double_dose") ? L().already : L().allGood, msg);
      speak(msg);
    }
  } catch (e) { toast(e.message); }
}

function showConfirm(kind, title, text) {
  const el = document.createElement("div");
  el.className = "confirm" + (kind === "warn" ? " warn" : "");
  el.innerHTML = `<div><div class="check">${kind === "warn" ? "!" : "✓"}</div><h1>${esc(title)}</h1><p>${esc(text)}</p>
    <button class="btn light" style="margin-top:24px">${esc(L().done)}</button></div>`;
  el.querySelector("button").onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

async function feelBad() {
  haptic();
  await api("/checkins", { body: { mood: "bad" } }).catch(() => {});
  const who = st.data?.caregivers?.[0]?.name || "";
  toast(L().helpSent(who || "tu familia"));
  speak(L().helpSent(who));
}

async function needHelp() {
  haptic();
  await api("/help", { body: {} }).catch(() => {});
  const c = st.data?.caregivers?.[0];
  toast(L().helpSent(c?.name || ""));
  if (c?.contact) location.href = "tel:" + c.contact.replace(/[^\d+]/g, "");
}

// Voice in: native speech recognition on Android, the browser's elsewhere.
async function talk(btn) {
  const lang = st.lang === "es" ? "es-CL" : "en-US";
  const sr = plugin("SpeechRecognition");
  btn.classList.add("listening");
  try {
    let text = "";
    if (sr) {
      await sr.requestPermissions?.();
      const r = await sr.start({ language: lang, maxResults: 1, partialResults: false, popup: false });
      text = r?.matches?.[0] || "";
    } else {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!R) { toast("Voice needs Chrome"); return; }
      text = await new Promise((res) => {
        const rec = new R(); rec.lang = lang; rec.onresult = (e) => res(e.results[0][0].transcript); rec.onerror = () => res(""); rec.onend = () => res(""); rec.start();
      });
    }
    btn.classList.remove("listening");
    if (!text) return;
    toast(`“${text}”`, 2500);
    const r = await api("/chat", { body: { text } });
    toast(r.reply, 8000);
    speak(r.reply);
    refresh();
  } catch (e) { toast(e.message); } finally { btn.classList.remove("listening"); }
}

// ---------- screens ----------
let lastView = "";
function render() {
  const view = `${st.token ? st.role : "out"}:${st.screen}:${st.tab}`;
  if (view !== lastView) { lastView = view; window.scrollTo(0, 0); }
  if (!st.token) {
    if (st.screen === "join") return renderJoin();
    if (st.screen === "setup") return renderSetup();
    return renderWelcome();
  }
  if (!st.data) { $app.innerHTML = `<div class="hero"><img src="icon.svg" alt=""><p class="muted">…</p></div>`; return; }
  if (st.screen === "addMed") return renderAddMed();
  return st.role === "patient" ? renderSenior() : renderFamily();
}

function topBar(extra = "") {
  return `<div class="top"><div class="brand"><img src="icon.svg" alt="">${esc(L().appName)}</div>
    <div style="display:flex;gap:8px">${extra}<button class="icon-btn" data-act="size" aria-label="${esc(L().textSize)}">A<span style="font-size:1.3em">A</span></button></div></div>`;
}

function renderWelcome() {
  $app.innerHTML = `
    <div class="seg" style="margin-bottom:8px"><button class="btn light" data-lang="es">Español</button><button class="btn light" data-lang="en">English</button></div>
    <div class="hero"><img src="icon.svg" alt=""><h1>${esc(L().appName)}</h1><p class="muted" style="font-size:1.15rem">${esc(L().welcome)}</p></div>
    <h2 class="center">${esc(L().whoUses)}</h2>
    <div class="choice">
      <button class="btn" data-go="setup"><span>👨‍👩‍👧 ${esc(L().iAmFamily)}</span><small>${esc(L().iAmFamilySub)}</small></button>
      <button class="btn ok" data-go="join"><span>💊 ${esc(L().iAmSenior)}</span><small>${esc(L().iAmSeniorSub)}</small></button>
    </div>
    <p class="center" style="margin-top:22px"><button class="link-btn" data-go="join">${esc(st.lang === "es" ? "Soy familiar y tengo un código" : "I'm family and have a code")}</button></p>`;
  bind();
}

function renderJoin() {
  $app.innerHTML = `${topBar()}
    <h1>${esc(L().enterCode)}</h1><p class="muted">${esc(L().enterCodeSub)}</p>
    <input id="code" class="field code-input" inputmode="numeric" maxlength="4" autocomplete="one-time-code" placeholder="••••" />
    <button class="btn big ok" id="joinBtn" style="margin-top:18px">${esc(L().continue)}</button>
    <button class="btn light" data-go="welcome">${esc(L().back)}</button>`;
  bind();
  const input = document.getElementById("code");
  input.focus();
  document.getElementById("joinBtn").onclick = async () => {
    try { const r = await api("/join", { body: { code: input.value } }); signIn(r.token, r.role); }
    catch (e) { toast(e.message); }
  };
}

function renderSetup() {
  const d = st.draft;
  $app.innerHTML = `${topBar()}
    <div class="steps">${esc(L().step(1, 2))}</div>
    <h1>${esc(L().whoCare)}</h1>
    <label for="pn">${esc(L().theirName)}</label><input id="pn" class="field" value="${esc(d.pn || "")}" placeholder="Rosa" autocomplete="off">
    <label for="cn">${esc(L().yourName)}</label><input id="cn" class="field" value="${esc(d.cn || "")}" placeholder="Daniel" autocomplete="name">
    <label for="rel">${esc(L().relationship)}</label>
    <select id="rel" class="field">${L().relOpts.map((o) => `<option ${d.rel === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
    <label for="ph">${esc(L().yourPhone)}</label><input id="ph" class="field" type="tel" value="${esc(d.ph || "")}" placeholder="+56 9 …" autocomplete="tel">
    <label>${esc(L().language)}</label>
    <div class="seg"><button class="time-opt ${st.lang === "es" ? "on" : ""}" data-lang="es">${esc(L().es)}</button><button class="time-opt ${st.lang === "en" ? "on" : ""}" data-lang="en">${esc(L().en)}</button></div>
    <button class="btn big" id="next" style="margin-top:22px">${esc(L().continue)}</button>
    <button class="btn light" data-go="welcome">${esc(L().back)}</button>`;
  bind();
  const keep = () => Object.assign(d, { pn: v("pn"), cn: v("cn"), rel: v("rel"), ph: v("ph") });
  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", keep, { capture: true }));
  document.getElementById("next").onclick = async () => {
    keep();
    if (!d.pn || !d.cn) return toast(L().needName);
    try {
      const r = await api("/households", { body: { patientName: d.pn, caregiverName: d.cn, relationship: d.rel, phone: d.ph, language: st.lang } });
      st.draft = {};
      signIn(r.token, r.role);
      st.screen = "addMed";
    } catch (e) { toast(e.message); }
  };
}
const v = (id) => document.getElementById(id)?.value.trim() ?? "";

function renderAddMed() {
  const d = (st.draft.med ||= { times: [] });
  const opts = L().times.map(([t, label]) => `<button class="time-opt ${d.times.includes(t) ? "on" : ""}" data-time="${t}">${esc(label)}<small>${fmt(t)}</small></button>`).join("");
  const extra = d.times.filter((t) => !L().times.some(([x]) => x === t)).map((t) => `<span class="chip">${fmt(t)}</span>`).join("");
  $app.innerHTML = `${topBar()}
    ${st.data?.medications?.length ? "" : `<div class="steps">${esc(L().step(2, 2))}</div>`}
    <h1>${esc(L().addMed)}</h1>
    <label for="mn">${esc(L().medName)}</label><input id="mn" class="field" value="${esc(d.name || "")}" placeholder="${esc(L().medNamePh)}">
    <label for="md">${esc(L().medDose)}</label><input id="md" class="field" value="${esc(d.dose || "")}" placeholder="${esc(L().medDosePh)}">
    <label>${esc(L().medWhen)}</label><div class="time-grid">${opts}</div>
    <div class="chips">${extra}</div>
    <label for="ot">${esc(L().otherTime)}</label><input id="ot" class="field" type="time">
    <label for="mi">${esc(L().medInstr)}</label><input id="mi" class="field" value="${esc(d.instr || "")}" placeholder="${esc(L().medInstrPh)}">
    <label for="mu">${esc(L().medHowMany)}</label><input id="mu" class="field" inputmode="numeric" value="${esc(d.units || "")}" placeholder="30">
    <button class="btn big ok" id="saveMed" style="margin-top:22px">${esc(L().save)}</button>
    <button class="btn light" id="skipMed">${esc(st.data?.medications?.length ? L().cancel : L().done)}</button>`;
  bind();
  const keep = () => Object.assign(d, { name: v("mn"), dose: v("md"), instr: v("mi"), units: v("mu") });
  document.querySelectorAll("[data-time]").forEach((b) => (b.onclick = () => {
    keep(); const t = b.dataset.time;
    d.times = d.times.includes(t) ? d.times.filter((x) => x !== t) : [...d.times, t];
    renderAddMed();
  }));
  document.getElementById("ot").onchange = (e) => { keep(); if (e.target.value && !d.times.includes(e.target.value)) d.times.push(e.target.value); renderAddMed(); };
  document.getElementById("saveMed").onclick = async () => {
    keep();
    if (!d.name || !d.dose) return toast(L().needName);
    if (!d.times.length) return toast(L().needTime);
    try {
      await api("/medications", { body: { name: d.name, dose: d.dose, times: d.times.sort(), instructions: d.instr, units_on_hand: Number(d.units || 0) } });
      st.draft.med = { times: [] };
      st.screen = "home"; st.tab = 1;
      await refresh();
    } catch (e) { toast(e.message); }
  };
  document.getElementById("skipMed").onclick = () => { st.draft.med = { times: [] }; st.screen = "home"; render(); };
}

// ---------- senior mode ----------
function renderSenior() {
  const D = st.data, T = D.today, me = D.patient.name, cg = D.caregivers[0];
  const now = new Date();
  const due = T.due_now, next = T.next_up[0];
  let main;
  if (due.length) {
    const late = due.every((x) => x.status === "missed");
    main = `<div class="card due">
      <div class="next-label"><span class="pill-dot"></span>${esc(late ? L().stillWaiting : L().timeFor)}</div>
      <div class="next-name">${esc(joinNames(due.map((x) => x.medication)))}</div>
      <div class="next-sub">${esc(due.length === 1 ? `${due[0].dose}${due[0].instructions ? " · " + due[0].instructions : ""}` : due.map((x) => `${x.medication} ${x.dose}`).filter((v, i, a) => a.indexOf(v) === i).join(" · "))}</div>
      <button class="btn big ok" data-act="took" style="margin-top:18px"><span class="ico">✓</span>${esc(L().iTookIt)}</button>
    </div>`;
  } else if (next) {
    const same = T.next_up.filter((x) => x.time === next.time);
    main = `<div class="card"><div class="next-label">${esc(L().next)}</div>
      <div class="next-name">${esc(joinNames(same.map((x) => x.medication)))}</div>
      <div class="next-sub" style="font-size:1.4rem;color:var(--ink);font-weight:700">${esc(L().at(fmt(next.time)))}</div>
      <div class="next-sub">${esc(next.dose)}${next.instructions ? " · " + esc(next.instructions) : ""}</div></div>`;
  } else {
    main = `<div class="card ok"><div class="next-name">🌿 ${esc(L().allDone)}</div><div class="next-sub">${esc(L().allDoneSub)}</div></div>`;
  }
  $app.innerHTML = `${topBar()}
    <h1 class="hello">${esc(L().hello(me))}</h1>
    <div class="clock">${now.toLocaleTimeString(st.lang === "es" ? "es-CL" : "en-US", { hour: "numeric", minute: "2-digit" })}</div>
    <div class="date">${now.toLocaleDateString(st.lang === "es" ? "es-CL" : "en-US", { weekday: "long", day: "numeric", month: "long" })}</div>
    ${main}
    <h2>${esc(L().today)}</h2>
    <ul class="dose-list">${T.all_today.map((x) => `<li><span class="dose-time">${fmt(x.time)}</span>
      <span class="dose-name">${esc(x.medication)}<small>${esc(x.dose)}</small></span>
      <span class="state ${x.status}">${x.status === "taken" ? "✓ " : ""}${esc(L().st[x.status])}</span></li>`).join("")}</ul>
    <h2></h2>
    <div class="row">
      <button class="btn light" data-act="feelbad">😟 ${esc(L().feelBad)}</button>
      <button class="btn bad" data-act="help">🆘 ${esc(L().needHelp)}</button>
    </div>
    ${cg?.contact ? `<a class="btn light" style="margin-top:12px;text-decoration:none" href="tel:${esc(cg.contact.replace(/[^\d+]/g, ""))}">📞 ${esc(L().call(cg.name))}</a>` : ""}
    ${D.assistant_ready ? `<button class="btn" data-act="talk" style="margin-top:12px">🎤 ${esc(L().talkTo)}</button>` : ""}`;
  bind();
}

// ---------- family mode ----------
function renderFamily() {
  const D = st.data, name = D.patient.name;
  const open = D.alerts.filter((a) => !a.acknowledged).length;
  const tabs = L().tabs.map((t, i) => `<button class="${st.tab === i ? "on" : ""}" data-tab="${i}"><span class="t-ico">${["🏠", "💊", "🔔", "🔗"][i]}</span>${esc(t)}${i === 2 && open ? `<span class="badge">${open}</span>` : ""}</button>`).join("");
  const body = [familyToday, familyMeds, familyAlerts, familyConnect][st.tab](D, name);
  $app.innerHTML = `${topBar()}${body}<nav class="tabs">${tabs}</nav>`;
  bind();
}

function familyToday(D, name) {
  const T = D.today;
  const late = T.due_now.some((x) => x.status === "missed");
  const pending = T.due_now.length > 0;
  const cls = late ? "bad" : pending ? "due" : "ok";
  const title = late ? L().late : pending ? L().pending : L().allGood;
  const pct = D.adherence.adherence_percent ?? 100;
  const low = D.refills.filter((r) => r.needs_refill);
  return `<h1>${esc(name)}</h1><p class="muted">${esc(new Date().toLocaleDateString(st.lang === "es" ? "es-CL" : "en-US", { weekday: "long", day: "numeric", month: "long" }))}</p>
    <div class="card ${cls}"><div class="status-hero">
      <div class="ring" style="--p:${pct}"><span>${pct}%</span></div>
      <div><div class="next-name" style="font-size:1.4rem">${esc(title)}</div><div class="muted">${esc(L().adherence)}</div></div>
    </div></div>
    ${low.length ? `<div class="card due"><b>🛒 ${esc(L().refillNeed)}</b><div class="chips">${low.map((r) => `<span class="chip warn">${esc(r.medication)} · ${esc(L().daysLeft(r.days_left))}</span>`).join("")}</div></div>` : ""}
    ${!D.alexa_linked ? `<div class="card"><b>🔊 ${esc(L().alexaNo)}</b><button class="btn" data-tab="3" style="margin-top:12px">${esc(L().connectAlexa)}</button></div>` : ""}
    <h2>${esc(L().today)}</h2>
    <ul class="dose-list">${T.all_today.map((x) => `<li><span class="dose-time">${fmt(x.time)}</span>
      <span class="dose-name">${esc(x.medication)}<small>${esc(x.dose)}</small></span>
      <span class="state ${x.status}">${x.status === "taken" && x.taken_at ? "✓ " + fmt(x.taken_at) : esc(L().st[x.status])}</span></li>`).join("") || `<li>${esc(L().addMed)}</li>`}</ul>`;
}

function familyMeds(D) {
  return `<h1>${esc(L().tabs[1])}</h1>
    <button class="btn ok" data-go="addMed" style="margin:12px 0 16px">＋ ${esc(L().addMed)}</button>
    ${D.medications.map((m) => {
      const f = D.refills.find((r) => r.medication === m.name);
      return `<div class="card med-card"><div class="med-title">${esc(m.name)}</div><div class="muted">${esc(m.dose)}${m.instructions ? " · " + esc(m.instructions) : ""}</div>
        <div class="chips">${m.times.map((t) => `<span class="chip">⏰ ${fmt(t)}</span>`).join("")}
        <span class="chip ${f?.needs_refill ? "warn" : ""}">📦 ${m.units_on_hand} · ${esc(L().daysLeft(f?.days_left ?? "–"))}</span></div>
        <div class="row" style="margin-top:14px"><button class="btn light" data-refill="${esc(m.name)}">＋ ${esc(L().refill)}</button>
        <button class="btn light" data-remove="${esc(m.name)}">${esc(L().remove)}</button></div></div>`;
    }).join("")}`;
}

function familyAlerts(D) {
  return `<h1>${esc(L().tabs[2])}</h1>
    ${D.alerts.length ? D.alerts.map((a) => `<div class="card alert-item ${a.severity} ${a.acknowledged ? "done" : ""}">
      <div>${a.severity === "urgent" ? "🆘 " : a.kind === "refill" ? "🛒 " : a.kind === "missed_dose" ? "⏰ " : "💬 "}${esc(a.message)}</div>
      <div class="alert-meta">${new Date(a.created_at).toLocaleString(st.lang === "es" ? "es-CL" : "en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}${a.acknowledged ? " · " + esc(L().seen) : ""}</div>
      ${a.acknowledged ? "" : `<button class="btn light" data-ack="${a.id}" style="margin-top:12px;min-height:56px">${esc(L().resolve)}</button>`}
    </div>`).join("") : `<div class="card ok">${esc(L().noAlerts)}</div>`}`;
}

function familyConnect(D, name) {
  const c = st.code;
  const show = (target) => c && c.target === target
    ? `<div class="code">${esc(c.code)}</div><p class="center muted">${esc(L().codeFor)}</p>${target === "alexa" ? `<div class="say">1. <b>${esc(L().alexaOpen)}</b></div><div class="say">2. <b>${esc(L().alexaCode(c.code))}</b></div>` : ""}`
    : `<button class="btn" data-code="${target}">${esc(L().newCode)}</button>`;
  return `<h1>${esc(L().tabs[3])}</h1>
    <div class="card"><h2 style="margin-top:0">🔊 ${esc(L().connectAlexa)}</h2>
      <p>${D.alexa_linked ? `<b style="color:var(--ok)">${esc(L().alexaLinked)}</b>` : esc(L().connectAlexaHow)}</p>${show("alexa")}</div>
    <div class="card"><h2 style="margin-top:0">📱 ${esc(L().seniorPhone(name))}</h2>${show("app_patient")}</div>
    <div class="card"><h2 style="margin-top:0">👥 ${esc(L().otherFamily)}</h2>${show("app_caregiver")}</div>
    <p class="center"><button class="link-btn" data-act="signout">${esc(L().signOut)}</button></p>`;
}

// ---------- events ----------
function bind() {
  document.querySelectorAll("[data-lang]").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
  document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => { st.screen = b.dataset.go === "welcome" ? "home" : b.dataset.go; render(); }));
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { st.tab = Number(b.dataset.tab); render(); window.scrollTo(0, 0); }));
  document.querySelectorAll("[data-ack]").forEach((b) => (b.onclick = async () => { await api(`/alerts/${b.dataset.ack}/ack`, { body: {} }).catch((e) => toast(e.message)); refresh(); }));
  document.querySelectorAll("[data-code]").forEach((b) => (b.onclick = async () => {
    try { const r = await api("/pair-codes", { body: { target: b.dataset.code } }); st.code = { ...r, target: b.dataset.code }; render(); } catch (e) { toast(e.message); }
  }));
  document.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => {
    if (!confirm(L().removeQ(b.dataset.remove))) return;
    await api(`/medications/${encodeURIComponent(b.dataset.remove)}`, { method: "DELETE" }).catch((e) => toast(e.message));
    refresh();
  }));
  document.querySelectorAll("[data-refill]").forEach((b) => (b.onclick = async () => {
    const n = Number(prompt(L().howManyAdded, "30"));
    if (n > 0) { const r = await api("/refills", { body: { medication: b.dataset.refill, units: n } }).catch((e) => toast(e.message)); if (r?.message) toast(r.message); refresh(); }
  }));
  const act = { took: tookIt, feelbad: feelBad, help: needHelp, signout: signOut, size: () => { cycleSize(); }, talk: null };
  document.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => (b.dataset.act === "talk" ? talk(b) : act[b.dataset.act]?.())));
}

// ---------- start ----------
render();
if (st.token) { ensureNotifyPermission(); refresh(); }
setInterval(refresh, 15000);
setInterval(pollEvents, 5000);
setInterval(() => { if (st.role === "patient" && st.data && !document.querySelector(".confirm")) render(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
