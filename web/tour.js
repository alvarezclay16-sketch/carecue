// "Play Rosa's day": a guided tour of six steps, no microphone needed, exactly three model turns.
// The setup steps and the touch step never call a model. The same shared scenarios (src/scenarios.ts, served by
// /api/scenarios and /api/scenario/:id) drive this tour, the chips and video/record.mjs.
// If the model cannot be used (not configured, paused, rate limited, error, or a step takes longer than 25 s)
// the tour plays web/replay/tour.json instead: a real recorded run, labelled as a replay on screen.

import { STR } from "./strings.js";

const ui = window.carecueUI;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const STEP_TIMEOUT_MS = 25_000;
// The words of the strip (the step texts, the mode labels, the summary) are in strings.js in EN and ES; the scenario lines the
// tour says to the model are English (src/scenarios.ts), so the tour plays with the screen in English and gives the visitor's
// language back when it ends, saying so in the strip.

// kind: setup (no model), say (one model turn), touch (MCP log_dose from the button, no model). The step texts are in strings.js.
const STEPS = [
  { id: "morning", kind: "setup", tab: "wire", dwell: 3200 },
  { id: "hedged", kind: "say", tab: "wire", dwell: 4500 },
  { id: "took", kind: "touch", tab: "wire", dwell: 4200 },
  { id: "extra", kind: "say", tab: "wire", dwell: 5800 },
  { id: "missed", kind: "setup", tab: "phone", dwell: 4500 },
  { id: "chest", kind: "say", tab: "wire", dwell: 6000 },
];

let running = false;
let cancelled = false;
let abort = null;
let run = null; // the last run: { mode, started, steps: [record], model_turns, ... } (the recorder reads it)
let replayData; // undefined = not tried, null = none available

const sleep = (ms) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => (cancelled || Date.now() - t0 >= ms ? resolve() : setTimeout(tick, 100));
    tick();
  });

// ---------- the private household (the page makes one on load; ui.scenario recreates it if it expired) ----------
const scenarioCall = (id) => ui.scenario(id);

const jsonOf = (path) => ui.api(path).then((r) => (r.ok ? r.json() : Promise.reject(Object.assign(new Error(String(r.status)), { status: r.status }))));

// ---------- the strip ----------
// view: { running, modeKind: setup | touch | live | replay | liverun, turns, status[], text: (tr) => string, langNote }
// `text` is a function of the strings table, so the strip is redrawn in the new language when the visitor switches.
let currentView = null;
function modeLabel(view, tr) {
  switch (view.modeKind) {
    case "replay": return ui.t().replay;
    case "replayNoModel": return `${ui.t().replay} - ${ui.t().replayNoModel}`;
    case "setup": return tr.modeSetup;
    case "touch": return tr.modeTouch;
    case "liverun": return tr.modeLiveRun(view.turns ?? 0);
    default: return tr.modeLive;
  }
}
function paintStrip(view = currentView) {
  const box = $("tour-strip");
  if (!box || !view) return;
  currentView = view;
  const tr = ui.t().tour;
  box.hidden = false;
  box.className = "tour-strip";
  const dots = STEPS.map((s, i) => {
    const st = view.status[i] ?? "todo";
    return `<li class="dot-${st}" aria-label="${esc(tr.stepAria(i + 1, tr.status[st] ?? st))}">${i + 1}</li>`;
  }).join("");
  box.innerHTML = `<div class="tour-head"><b>${esc(tr.title)}</b>
      <span class="tour-mode ${view.modeKind.startsWith("replay") ? "replay" : ""}">${esc(modeLabel(view, tr))}</span>
      ${view.langNote ? `<span class="tour-en">${esc(STR.es.tour.inEnglishShort)}</span>` : ""}
      ${view.running ? `<button type="button" id="tour-stop" class="tour-stop">${esc(tr.stop)}</button>` : ""}</div>
    <ol class="tour-dots">${dots}</ol>
    <p class="tour-watch">${esc(view.text(tr))}</p>
    ${view.langNote ? `<p class="tour-lang">${esc(view.langNote)}</p>` : ""}`;
}

function setButton(isRunning) {
  const b = $("tour-play");
  if (!b) return;
  b.disabled = isRunning;
  const p = ui.t().panel;
  b.textContent = isRunning ? p.playing : p.play;
}
document.addEventListener("carecue:lang", () => { setButton(running); if (currentView && !$("tour-strip").hidden) paintStrip(); });
setButton(false); // the button speaks the page language from the first paint

// ---------- replay ----------
async function loadReplay() {
  if (replayData !== undefined) return replayData;
  try {
    const r = await fetch("/replay/tour.json", { cache: "no-cache" });
    replayData = r.ok ? await r.json() : null;
    if (replayData && !Array.isArray(replayData.steps)) replayData = null;
  } catch {
    replayData = null;
  }
  return replayData;
}

function say(text) { ui.setUser(text); }

/** Plays one recorded step through the same renderers the live path uses. */
async function replayStep(step, rec, opts = {}) {
  if (rec.lang) ui.setLang(rec.lang === "es" ? "es-CL" : "en-US"); // a recorded Spanish turn is shown in Spanish
  ui.setReplayBadge(true, step.kind !== "say", !!opts.chip && !rec.lang); // a replayed set-up or touch says "no model" too; a chip's English recording says so to an ES visitor
  if (step.kind === "setup") {
    ui.setUser("");
    ui.setReply("");
    if (rec.scene) ui.showOverride(rec.scene, Math.ceil(step.dwell / 1000) + 1);
    if (rec.alert) ui.toast(rec.alert);
    return;
  }
  if (step.kind === "touch") {
    ui.setUser("");
    ui.setReply(rec.reply ?? "");
    if (rec.response?.scene) ui.showOverride(rec.response.scene, rec.response.ttl_s ?? 8);
    document.dispatchEvent(new CustomEvent("carecue:touch", { detail: { action: "took", status: 200, response: rec.response, replay: true } }));
    return;
  }
  say(rec.text);
  ui.setReply(rec.reply ?? "");
  if (rec.response?.scene) ui.showOverride(rec.response.scene, rec.response.ttl_s ?? 8);
  document.dispatchEvent(new CustomEvent("carecue:turn", { detail: { text: rec.text, status: 200, response: rec.response, replay: true, unchanged: rec.unchanged ?? null } }));
}

// ---------- live steps ----------
/** The newest alert text for the household, for the replay record of the "missed" step. */
async function newestAlert() {
  try {
    const s = await jsonOf("/api/state");
    return { alert: s.alerts[0]?.message ?? null, scene: s.scene ?? null };
  } catch {
    return { alert: null, scene: null };
  }
}

async function liveStep(step, utterances) {
  ui.setReplayBadge(false);
  if (step.kind === "setup") {
    const r = await scenarioCall(step.id);
    if (r.replay) return { skipped: true, note: "needs time earlier today, skipped" };
    await ui.resetView();
    await ui.refresh();
    const extra = await newestAlert();
    return { rec: { id: step.id, kind: "setup", scenario: step.id, scene: extra.scene, alert: step.id === "missed" ? extra.alert : null } };
  }
  if (step.kind === "touch") {
    const out = await ui.touch("took", { waitSpeech: false });
    if (!out || out.status >= 400) return { fail: "touch" };
    return { rec: { id: step.id, kind: "touch", reply: out.reply, response: out.response } };
  }
  const text = utterances[step.id];
  if (!text) return { fail: "no utterance" };
  abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STEP_TIMEOUT_MS);
  let out;
  try {
    out = await ui.ask(text, { signal: abort.signal, waitSpeech: false });
  } finally {
    clearTimeout(timer);
    abort = null;
  }
  if (cancelled) return { cancelled: true };
  if (out.aborted) return { fail: "timeout" };
  const r = out.response ?? {};
  if (!out.response) return { fail: "unreachable" };
  if (out.status >= 400 || r.limited || r.degraded) return { fail: r.limited ? "limited" : r.degraded ? "unavailable" : `HTTP ${out.status}` };
  // The "dose log unchanged" chip is added by the wire view after a state diff; read it back for the record.
  await sleep(600);
  const entry = window.carecueWire?.entries().find((e) => e.tag === "model" && e.title === text);
  return { rec: { id: step.id, kind: "say", text, reply: out.reply, response: r, unchanged: entry?.unchanged ?? null } };
}

/** What is usable right now: the server (set-up, touch) and the model (the three spoken turns) are checked apart. */
async function preflight() {
  const out = { server: false, model: false, why: "", whyKey: "", whyDetail: "", utterances: {} };
  const u = await ui.usability();
  Object.assign(out, { why: u.why, whyKey: u.whyKey, whyDetail: u.whyDetail });
  if (!u.server) return out;
  try {
    const list = await jsonOf("/api/scenarios");
    out.utterances = Object.fromEntries(list.filter((x) => x.say).map((x) => [x.id, x.say]));
    out.server = true;
    if (!out.utterances.hedged || !out.utterances.extra || !out.utterances.chest) Object.assign(out, { why: "scenarios unavailable", whyKey: "scenarios", whyDetail: "" });
    else out.model = u.model;
  } catch (err) {
    Object.assign(out, { why: `server unavailable (${err.message})`, whyKey: "server", whyDetail: err.message });
  }
  return out;
}

// ---------- the tour ----------
let chosenLang = null; // the visitor's language, put back when the tour ends
let userSwitched = false; // the visitor pressed EN/ES during the tour: their choice stays
document.querySelector(".lang")?.addEventListener("click", () => { if (chosenLang) userSwitched = true; });

async function play() {
  if (running) return;
  running = true;
  cancelled = false;
  try { window.speechSynthesis?.cancel(); } catch {}
  for (let i = 0; i < 20 && ui.isBusy(); i++) await new Promise((r) => setTimeout(r, 100)); // a cut-off voice frees the device
  document.body.classList.add("touring");
  setButton(true);
  chosenLang = ui.getLang();
  userSwitched = false;
  const spanishVisitor = chosenLang.startsWith("es");
  ui.setLang("en-US"); // the scenario lines are English: the screen follows them, and the visitor's language comes back at the end
  window.carecueWire?.clear();
  ui.showTab("wire");

  const started = Date.now();
  const pre = await preflight();
  let serverLive = pre.server; // set-up and touch steps
  let modelLive = pre.model; // the three spoken turns
  const status = STEPS.map(() => "todo");
  const how = []; // per step: live | replay
  const records = [];
  const kindOf = (step, mode) => (mode === "replay" ? (step.kind === "say" ? "replay" : "replayNoModel") : step.kind === "say" ? "live" : step.kind);
  const view = {
    running: true,
    modeKind: serverLive && modelLive ? "live" : "replay",
    status,
    // The visitor's own language says, once, that the tour plays in English.
    langNote: spanishVisitor ? STR.es.tour.inEnglish : "",
    text: (tr) => tr.starting,
  };
  const note = (fn) => { view.text = fn; paintStrip(view); };
  run = { mode: view.modeKind, started, steps: records, model_turns: 0, notes: pre.why ? [pre.why] : [] };
  const whyText = () => ui.restWhy(pre.whyKey, pre.whyDetail);

  if (!serverLive || !modelLive) await loadReplay();
  if (!serverLive && !replayData) {
    note((tr) => tr.restingNoRecording(whyText()));
    view.restingNote = true;
    return finish(view, "stopped", how);
  }

  for (let i = 0; i < STEPS.length && !cancelled; i++) {
    const step = STEPS[i];
    status[i] = "now";
    ui.showTab(step.tab);
    const watch = (tr) => tr.stepOf(i + 1, STEPS.length) + tr.watch[step.id];
    let mode = (step.kind === "say" ? modelLive : serverLive) ? "live" : "replay";
    view.modeKind = kindOf(step, mode);
    note(watch);

    let result = {};
    if (mode === "live") {
      try {
        result = await liveStep(step, pre.utterances);
      } catch (err) {
        result = { fail: err.message };
      }
      if (result.cancelled) break;
      if (result.fail || result.skipped) {
        const why = result.fail ?? result.note;
        run.notes.push(`step ${i + 1} ${step.id}: ${why}`);
        if (step.kind === "say") {
          modelLive = false; // a failed or slow model: the rest of the spoken turns replay
          window.carecueWire?.discardFailed(pre.utterances[step.id]); // the failed live entry must not sit next to the replayed one
        } else if (result.fail) serverLive = false;
        mode = "replay"; // this step too, from the recording
        view.modeKind = kindOf(step, "replay");
        note((tr) => `${watch(tr)} ${tr.notAvailable(step.kind, why)}`);
      }
    }
    if (mode === "replay") {
      const rec = (await loadReplay())?.steps?.find((s) => s.id === step.id);
      if (!rec) {
        status[i] = "skipped";
        how[i] = "skipped";
        note((tr) => tr.skipped(i + 1, STEPS.length));
        await sleep(1500);
        continue;
      }
      await replayStep(step, rec);
      result = { rec: { ...rec, replay: true } };
    }

    status[i] = "done";
    how[i] = mode;
    if (result.rec) records.push(result.rec);
    if (step.kind === "say" && mode === "live") run.model_turns++;
    paintStrip(view);
    await sleep(step.dwell);
  }
  finish(view, cancelled ? "stopped" : "done", how);
}

function finish(view, outcome, how) {
  const secs = Math.round((Date.now() - run.started) / 1000);
  const calls = run.steps.reduce((n, s) => n + (s.response?.toolCalls?.length ?? 0) + (s.response?.trace ? 1 : 0), 0);
  const used = how.filter((h) => h === "live" || h === "replay");
  run.mode = used.length && used.every((h) => h === "live") ? "live" : used.length && used.every((h) => h === "replay") ? "replay" : "mixed";
  run.finished = Date.now();
  run.ms = run.finished - run.started;
  run.how = outcome;
  view.running = false;
  view.modeKind = run.mode === "live" ? "liverun" : "replay";
  view.turns = run.model_turns;
  // Give the visitor's language back (unless they switched it themselves during the tour) and say so in the strip.
  let backTo = null;
  if (chosenLang && chosenLang !== ui.getLang() && !userSwitched) { // the Spanish step leaves the screen in Spanish for an English visitor too
    backTo = chosenLang;
    ui.setLang(chosenLang);
  }
  chosenLang = null;
  view.langNote = "";
  if (!view.restingNote) {
    const model = run.model_turns;
    view.text = (tr) =>
      (outcome === "done" ? tr.done(secs, model, calls, run.mode === "live") : tr.stopped) + (backTo ? tr.backToLang(tr.langName) : "");
  }
  paintStrip(view);
  running = false;
  document.body.classList.remove("touring");
  setButton(false);
  document.dispatchEvent(new CustomEvent("carecue:tour-end", { detail: run }));
}

function stop() {
  cancelled = true;
  abort?.abort();
}

/** Plays one recorded step by id through the same renderers (the scenario chips use this when the model rests). */
async function playRecorded(id) {
  const rec = (await loadReplay())?.steps?.find((x) => x.id === id);
  if (!rec) return null;
  await replayStep({ kind: rec.kind, dwell: 4500 }, rec, { chip: true });
  return rec;
}

$("tour-play")?.addEventListener("click", () => play());
$("tour-strip")?.addEventListener("click", (e) => { if (e.target.closest("#tour-stop")) stop(); });

// For the recorder (video/record.mjs) and tests: window.carecueTour.play(), .lastRun().
window.carecueReplay = { load: loadReplay, playRecorded, label: STR.en.replay };
window.carecueTour = { play, stop, lastRun: () => run, steps: STEPS.map((s) => s.id), isRunning: () => running };
