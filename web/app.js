// Simulated Alexa+ device + caregiver phone for the CareCue demo.

const $ = (id) => document.getElementById(id);
const conversationId = "kitchen-device";
let lang = "en-US";
let lastEventId = 0;
let busy = false;

// ---------- light ring ----------
function ring(state) {
  $("ring").className = "ring" + (state ? " " + state : "");
  $("mic").classList.toggle("listening", state === "listening");
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
  // Recording mode: the voice track is produced separately, so stay silent and don't wait.
  if (window.CARECUE_SILENT) return Promise.resolve();
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.97;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onstart = () => ring(mode);
    u.onend = u.onerror = () => { ring(""); resolve(); };
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
    $("caption-reply").textContent = "Voice input needs Chrome. You can type instead.";
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
    $("caption-user").textContent = r[0].transcript;
    if (r.isFinal) finalText = r[0].transcript;
  };
  recognizer.onerror = () => ring("");
  recognizer.onend = () => {
    ring("");
    if (finalText.trim()) ask(finalText.trim());
  };
  recognizer.start();
}

// ---------- agent ----------
async function ask(text) {
  busy = true;
  $("caption-user").textContent = text;
  $("caption-reply").textContent = "…";
  ring("thinking");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, text }),
    });
    const data = await res.json();
    const reply = res.ok ? data.reply : data.error || "Something went wrong.";
    $("caption-reply").textContent = reply;
    if (data.toolCalls?.length) console.log("tools:", data.toolCalls);
    refresh();
    await speak(reply);
  } catch (err) {
    $("caption-reply").textContent = "I can't reach CareCue right now.";
    ring("");
  } finally {
    busy = false;
  }
}

// ---------- rendering ----------
const fmt = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  const s = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${s}` : `${h12} ${s}`;
};

function renderDevice(state) {
  const [h, m] = state.clock.time.split(":").map(Number);
  $("clock").textContent = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
  const d = new Date(state.clock.date + "T12:00:00");
  $("date").textContent =
    d.toLocaleDateString(lang, { weekday: "long", month: "long", day: "numeric" }) +
    (state.clock.shifted ? " · demo time" : "");

  const due = state.today.due_now;
  const card = $("now-card");
  card.classList.remove("due", "late");
  if (due.length) {
    const late = due.some((x) => x.status === "missed");
    card.classList.add(late ? "late" : "due");
    $("now-title").textContent = due.map((x) => x.medication).join(" + ");
    const detail = due.length > 1 ? `${due.length} medicines` : `${due[0].dose}${due[0].instructions ? " · " + due[0].instructions : ""}`;
    $("now-sub").textContent = late ? `Was due at ${due[0].spoken_time} · not confirmed yet` : `Due now · ${detail}`;
    card.querySelector(".now-label").textContent = late ? "Still waiting" : "Time for";
  } else if (state.today.next_up.length) {
    const next = state.today.next_up[0];
    const same = state.today.next_up.filter((x) => x.time === next.time);
    card.querySelector(".now-label").textContent = "Next medicine";
    $("now-title").textContent = `${same.map((x) => x.medication).join(" + ")} at ${next.spoken_time}`;
    $("now-sub").textContent = next.instructions || next.dose;
  } else {
    card.querySelector(".now-label").textContent = "All done";
    $("now-title").textContent = "No more medicine today";
    $("now-sub").textContent = `${state.today.done_today.length} doses logged`;
  }
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
          <div class="when">${new Date(al.created_at).toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" })} · ${al.kind.replace("_", " ")}${al.acknowledged ? " · resolved" : ""}</div></li>`,
        )
        .join("")
    : `<li class="empty">No alerts. All good.</li>`;

  const ms = $("model-status");
  ms.textContent = state.model_ready ? "voice agent: ready" : "voice agent: add model credentials";
  ms.className = "pill " + (state.model_ready ? "ok" : "bad");
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function refresh() {
  try {
    const state = await fetch("/api/state").then((r) => r.json());
    renderDevice(state);
    renderPhone(state);
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
}

async function pollEvents() {
  try {
    const events = await fetch(`/api/events?since=${lastEventId}`).then((r) => r.json());
    for (const e of events) {
      lastEventId = Math.max(lastEventId, e.id);
      if (e.kind === "reminder" && !busy) {
        $("caption-user").textContent = "";
        $("caption-reply").textContent = e.text;
        speak(e.text, "reminder");
      } else if (e.kind === "alert") {
        toast(e.text);
      }
    }
    if (events.length) refresh();
  } catch {}
}

// ---------- wiring ----------
$("mic").addEventListener("click", listen);
$("type-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("type-input").value.trim();
  if (!v) return;
  $("type-input").value = "";
  ask(v);
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== $("type-input")) {
    e.preventDefault();
    listen();
  }
});
document.querySelectorAll(".lang button").forEach((b) =>
  b.addEventListener("click", () => {
    lang = b.dataset.lang;
    document.querySelectorAll(".lang button").forEach((x) => x.classList.toggle("on", x === b));
    refresh();
  }),
);
document.querySelectorAll("[data-time]").forEach((b) =>
  b.addEventListener("click", async () => {
    await fetch("/api/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ time: b.dataset.time }) });
    await pollEvents();
    refresh();
  }),
);
$("real-time").addEventListener("click", async () => {
  await fetch("/api/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true }) });
  refresh();
});
$("reset").addEventListener("click", async () => {
  await fetch("/api/reset", { method: "POST" });
  await fetch("/api/chat/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId }) });
  speechSynthesis.cancel();
  $("caption-user").textContent = "";
  $("caption-reply").textContent = "Say “I took my pills” or “Did I take my Losartan?”";
  refresh();
});

// Don't replay reminders that fired before the page opened.
fetch("/api/events?since=0").then((r) => r.json()).then((ev) => { lastEventId = ev.reduce((m, e) => Math.max(m, e.id), 0); });
speechSynthesis?.getVoices();
// Hooks for scripted demo recordings (tests/record-demo).
window.carecueDemo = { ask, ring, refresh, pollEvents };
refresh();
setInterval(refresh, 3000);
setInterval(pollEvents, 1500);
