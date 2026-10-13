// "Try it in 60 seconds": five scenario chips and "Start over" for the visitor's private demo.
// A chip first sets up the household through POST /api/scenario/:id (deterministic, no model), then sends the scenario's
// line through the normal chat route, so it costs at most one live model turn. When the model cannot be used (rate limited,
// paused, not configured, down, slower than 25 s) or the set-up needs more past time than today has (just after midnight),
// the chip plays the recorded step of web/replay/tour.json through the same renderers, under the badge
// "Replay of a real run (the live demo is resting)". The server never rewrites anything for a replay.

const ui = window.carecueUI;
const $ = (id) => document.getElementById(id);

const STEP_TIMEOUT_MS = 25_000;

// tab: which side panel shows the effect. Labels and hints are the visitor's words, not ours.
const CHIPS = [
  { id: "extra", label: "Extra dose", tab: "wire", hint: "She already took her pills and asks for another one: STOP on the screen, the family is told, the dose log does not change." },
  { id: "hedged", label: "Hedged answer", tab: "wire", hint: "“I think I took it, maybe.” Nothing is written down until she is sure." },
  { id: "missed", label: "Missed dose to family", tab: "phone", hint: "A dose 50 minutes late: Daniel's phone gets the alert (no model)." },
  { id: "chest", label: "Chest pain", tab: "wire", hint: "An emergency: the number in giant digits and an urgent alert for Daniel." },
  { id: "spanish", label: "Spanish", tab: "wire", hint: "A question in Spanish: the screen and the answer switch to Spanish." },
];

let running = false;
let last = null; // the record of the last chip run (the recorder reads it)

function paint() {
  const box = $("scenario-chips");
  if (!box) return;
  box.innerHTML = CHIPS.map(
    (c) => `<button type="button" class="scn-chip" data-scenario="${c.id}" title="${c.hint.replace(/"/g, "&quot;")}">${c.label}</button>`,
  ).join("");
}

function lock(on) {
  document.querySelectorAll(".scn-chip, #start-over").forEach((b) => (b.disabled = on));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The recorded step for a chip, played through the same renderers; says so on screen when there is none. */
async function playRecording(id) {
  const rec = await window.carecueReplay?.playRecorded(id);
  if (!rec) {
    ui.setUser("");
    ui.setReply("The live demo is resting and there is no recording of this scenario yet. Press Play Rosa's day instead.");
  }
  return rec;
}

async function run(id) {
  const chip = CHIPS.find((c) => c.id === id);
  if (!chip || running || ui.isBusy() || document.body.classList.contains("touring")) return null;
  running = true;
  lock(true);
  const rec = { id, kind: "say", mode: "live", started: Date.now(), notes: [] };
  last = rec;
  try {
    ui.showTab(chip.tab);
    const u = await ui.usability();
    ui.setRest(u.model ? "" : u.why);
    let data = null;
    if (u.server) {
      try {
        data = await ui.scenario(id);
      } catch (err) {
        rec.notes.push(`set-up failed: ${err.message}`);
      }
    }
    if (!data) {
      // No server: nothing is set up, the recording tells the story.
      rec.mode = "replay";
      await playRecording(id);
      return rec;
    }
    ui.setLang(data.lang === "es" ? "es-CL" : "en-US");
    await ui.resetView();
    if (data.replay) {
      // The set-up needs time earlier today that does not exist yet (just after midnight): replay it honestly.
      rec.mode = "replay";
      rec.notes.push("needs time earlier today, replayed");
      await playRecording(id);
      return rec;
    }
    ui.setReplayBadge(false);
    if (!data.utterance) return rec; // a chip without a spoken line (none of the five today) is just its set-up
    rec.text = data.utterance;
    rec.lang = data.lang;
    if (!u.model) {
      rec.mode = "replay";
      await playRecording(id);
      return rec;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), STEP_TIMEOUT_MS);
    let out;
    try {
      out = await ui.ask(data.utterance, { signal: abort.signal, waitSpeech: false });
    } finally {
      clearTimeout(timer);
    }
    const r = out.response ?? {};
    if (out.aborted || !out.response || out.status >= 400 || r.limited || r.degraded) {
      rec.notes.push(out.aborted ? "timeout" : !out.response ? "unreachable" : r.limited ? "limited" : r.degraded ? "unavailable" : `HTTP ${out.status}`);
      ui.setRest(out.aborted ? "the model took too long" : r.limited ? "daily limit reached for this visitor, or the demo is paused" : "the model is not answering");
      rec.mode = "replay";
      await playRecording(id);
      return rec;
    }
    await sleep(600); // the wire view adds its "dose log unchanged" chip after a state diff
    const entry = window.carecueWire?.entries().find((e) => e.tag === "model" && e.title === data.utterance);
    Object.assign(rec, { reply: out.reply, response: r, unchanged: entry?.unchanged ?? null });
    return rec;
  } catch (err) {
    rec.notes.push(err.message);
    return rec;
  } finally {
    running = false;
    lock(false);
  }
}

/** A fresh private morning: reminder due, no alerts, the wire and the tour strip cleared, nothing spoken. */
async function startOver() {
  if (running) return;
  if (window.carecueTour?.isRunning()) {
    window.carecueTour.stop();
    for (let i = 0; i < 30 && window.carecueTour.isRunning(); i++) await sleep(100);
  }
  running = true;
  lock(true);
  try {
    try { await ui.scenario("morning"); } catch {} // a resting demo has nothing to re-seed; the view is still cleared
    ui.setReplayBadge(false);
    window.carecueWire?.clear();
    const strip = $("tour-strip");
    if (strip) strip.hidden = true;
    await ui.resetView({ idle: true, quiet: true });
    ui.loadWeek(true);
    const u = await ui.usability();
    ui.setRest(u.model ? "" : u.why);
  } finally {
    running = false;
    lock(false);
  }
}

paint();
$("scenario-chips")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-scenario]");
  if (b) run(b.dataset.scenario);
});
$("start-over")?.addEventListener("click", () => startOver());

// For the recorder (video/record-replay.mjs) and tests.
window.carecueChips = { run, startOver, ids: CHIPS.map((c) => c.id), lastRun: () => last, isRunning: () => running };
