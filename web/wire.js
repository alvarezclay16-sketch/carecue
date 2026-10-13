// The "MCP wire" tab: every MCP tool call the demo makes, as the server reports it.
// Sources: a MODEL turn (the agent called tools), a TOUCH (the "I took it" button, no model) and a PROBE
// (a labelled direct tool call, no model). Everything shown comes from the server's own ToolTrace
// (name, input, result, ok, guard, effect, ms, annotations, source); this file only formats it.
// Tokens and Authorization headers are never rendered (see redact()).

const ui = window.carecueUI;
const mount = ui.wireMount;
const $$ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

import { argsSummary, badgeFor, lastToolText, prettyJson, unchangedText } from "./wire-format.js";
import { STR } from "./strings.js";

const FEED_MAX = 40;
// Every word on this tab comes from strings.js (EN/ES) through ui.t().wire, so a language switch redraws the whole tab.
const W = () => ui.t().wire;

const PROBES = ["hedged_log", "double_log", "remove_med"];

// ---------- the feed ----------
// newest first: { id, tag, title, titleKey, ms, model, replay, labelKind, calls, notes, unchanged, unchangedKind, failed }
// notes are plain texts (from the server) or functions of the strings table; titleKey/labelKind name a fixed sentence.
let feed = [];
let nextId = 1;
let expanded = new Set(); // "turnId:callIndex"

function callHtml(turn, t, i) {
  const key = `${turn.id}:${i}`;
  const open = expanded.has(key);
  const w = W();
  const b = badgeFor(t, w);
  const tag = w.tags[t.source] ?? w.tags.model;
  return `<li class="call-item">
    <button type="button" class="call" data-key="${key}" aria-expanded="${open}">
      <span class="tag tag-${esc(t.source ?? "model")}">${tag}</span>
      <span class="cname">${esc(t.name)}</span>
      <span class="cargs">${esc(argsSummary(t.input))}</span>
      <span class="cms">${esc(t.ms)} ${esc(w.ms)}</span>
      <span class="badge-w b-${b.tone}">${esc(b.text)}</span>
    </button>
    ${b.note ? `<p class="call-note">${esc(b.note)}</p>` : ""}
    <pre class="cjson" ${open ? "" : "hidden"}>${esc(prettyJson({ input: t.input, result: t.result, annotations: t.annotations ?? undefined }, undefined, w))}</pre>
  </li>`;
}

const noteText = (n) => (typeof n === "function" ? n(W()) : n);
const titleOf = (turn) => (turn.titleKey === "tapped" ? W().tapped : turn.titleKey ? (W().probes[turn.titleKey]?.[0] ?? turn.titleKey) : turn.title);

function turnHtml(turn) {
  const w = W();
  const tag = w.tags[turn.tag] ?? w.tags.model;
  const sec = turn.ms == null ? "" : turn.ms < 1000 ? `${turn.ms} ${w.ms}` : `${(turn.ms / 1000).toFixed(1)} s`;
  const title = titleOf(turn);
  const head = [
    `<span class="tag tag-${esc(turn.tag)}">${esc(tag)}</span>`,
    title ? `<q class="turn-q">${esc(title)}</q>` : "",
    sec ? `<span class="turn-ms">${esc(sec)}</span>` : "",
    turn.model ? `<span class="turn-model">${esc(turn.model)}</span>` : "",
  ].join("");
  const labelText = turn.replay ? "" : turn.labelKind === "touch" ? w.touchLabel : turn.labelKind === "probe" ? w.probeLabel : "";
  const label = turn.replay
    ? `<p class="turn-label replay">${esc(w.replayLabel + (turn.tag === "touch" ? ` - ${w.replayNoModel}` : ""))}</p>`
    : labelText
      ? `<p class="turn-label">${esc(labelText)}</p>`
      : "";
  const unchanged = turn.unchangedKind ? (turn.unchangedKind === "called" ? w.unchangedCalled : w.unchangedNone) : turn.unchanged;
  const chips = [
    ...(unchanged ? [`<li class="chip-note">${esc(unchanged)}</li>`] : []),
    ...turn.calls.map((t, i) => [t, i]).reverse().map(([t, i]) => callHtml(turn, t, i)),
    ...turn.notes.map((n) => `<li class="chip-note">${esc(noteText(n))}</li>`),
  ];
  return `<section class="turn" aria-label="${esc(w.turnAria(tag))}"><div class="turn-head">${head}</div>${label}<ul class="calls">${chips.join("")}</ul></section>`;
}

function renderFeed() {
  const box = $$("#wire-feed");
  if (!box) return;
  box.innerHTML = feed.length
    ? feed.map(turnHtml).join("")
    : `<p class="wire-empty">${esc(W().empty)}</p>`;
}

function paintLastTool(turn) {
  const el = document.getElementById("last-tool");
  if (!el) return;
  const text = lastToolText(turn, W());
  el.hidden = !text;
  el.textContent = text;
  const t = turn.calls[turn.calls.length - 1];
  el.dataset.tone = t ? badgeFor(t, W()).tone : "grey";
}

function addTurn(turn) {
  const t = { id: nextId++, calls: [], notes: [], unchanged: null, ...turn };
  feed.unshift(t);
  feed = feed.slice(0, FEED_MAX);
  renderFeed();
  paintLastTool(t);
  return t;
}

// ---------- dose log diff (client side, from /api/state) ----------
const doneCount = (state) => (state?.today?.done_today ?? []).length;
const snapshot = () => ui.api("/api/state").then((r) => (r.ok ? r.json() : null)).then((s) => (s ? doneCount(s) : null)).catch(() => null);

let pendingBefore = null; // promise of the done_today count at the start of the current turn
document.addEventListener("carecue:turn-start", () => { pendingBefore = snapshot(); });

async function unchangedChip(turn, before) {
  const after = await snapshot();
  setUnchanged(turn, unchangedText(before, after, turn.calls.length > 0));
  renderFeed();
}
/** `text` is the English chip text (what the recorder stores); the page draws the chip in the device language. */
function setUnchanged(turn, text) {
  turn.unchanged = text ?? null;
  turn.unchangedKind = text === STR.en.wire.unchangedCalled ? "called" : text === STR.en.wire.unchangedNone ? "none" : null;
}

// ---------- events from the device ----------
document.addEventListener("carecue:turn", (e) => {
  const { text, status, response, replay, unchanged } = e.detail;
  const r = response ?? {};
  const failed = status >= 400 || !!r.limited || !!r.degraded;
  const turn = addTurn({
    tag: "model",
    title: text,
    ms: r.ms ?? null,
    model: r.model ? `${r.model.provider} ${r.model.id}` : null,
    replay: !!replay,
    failed,
    calls: Array.isArray(r.toolCalls) ? r.toolCalls : [],
    notes: status >= 400 ? [r.error ?? `HTTP ${status}`] : r.limited ? [(w) => w.noteLimited] : r.degraded ? [(w) => w.noteDegraded] : [],
  });
  if (!failed) {
    if (replay) { setUnchanged(turn, unchanged ?? null); renderFeed(); }
    else (pendingBefore ?? Promise.resolve(null)).then((b) => unchangedChip(turn, b));
  }
  refreshHeader();
});

document.addEventListener("carecue:touch", (e) => {
  const { action, status, response, replay } = e.detail;
  if (action !== "took") return;
  const r = response ?? {};
  addTurn({
    tag: "touch",
    titleKey: "tapped",
    ms: r.trace?.ms ?? null,
    replay: !!replay,
    labelKind: replay ? null : "touch",
    calls: r.trace ? [r.trace] : [],
    notes: status >= 400 ? [r.error ?? `HTTP ${status}`] : [],
  });
});

// ---------- probes ----------
async function runProbe(id, btn) {
  const all = mount.querySelectorAll(".probe");
  all.forEach((b) => (b.disabled = true));
  btn.setAttribute("aria-busy", "true");
  const base = { tag: "probe", titleKey: id, labelKind: "probe" };
  try {
    const res = await ui.post("/api/probe", { id });
    const data = await res.json();
    if (res.status === 409) {
      addTurn({ ...base, notes: [(w) => w.notePossible(data.error, data.hint)] });
    } else if (!res.ok) {
      addTurn({ ...base, notes: [data.error ?? `HTTP ${res.status}`] });
    } else {
      addTurn({ ...base, ms: data.trace?.ms ?? null, calls: [data.trace] });
    }
    ui.refresh();
  } catch {
    addTurn({ ...base, notes: [(w) => w.noteUnreachable] });
  } finally {
    all.forEach((b) => (b.disabled = false));
    btn.removeAttribute("aria-busy");
  }
}

// ---------- header strip, who sees what, safety pill ----------
let info = null;
let model = null;

function headerText() {
  const w = W();
  const bits = ["MCP", "Streamable HTTP"];
  if (info) {
    bits.push(info.protocolVersion);
    if (info.serverInfo) bits.push(`${info.serverInfo.name} ${info.serverInfo.version}`);
    bits.push(w.headTools(info.tools.length));
  } else bits.push(w.headHandshake);
  if (model) bits.push(`${model.provider} ${model.model_name ?? model.model}`);
  return bits.join(" - ");
}

async function refreshHeader() {
  try {
    if (!info) {
      const r = await ui.api("/api/mcp-info");
      if (r.ok) info = await r.json();
    }
    const m = await ui.api("/api/model");
    if (m.ok) model = await m.json();
  } catch {}
  const el = $$("#wire-head");
  if (el) el.textContent = headerText();
  paintWho();
}

function paintWho() {
  const box = $$("#wire-who");
  if (!box || !info?.roles) return;
  const w = W();
  const patient = info.roles.patient;
  const caregiver = info.roles.caregiver;
  const admin = new Set(caregiver.filter((n) => !patient.includes(n)));
  const toolTitle = (n) => w.toolTitles[n] ?? info.tools.find((t) => t.name === n)?.title ?? ""; // the server's titles are English
  const col = (who, role, names) => `<div class="who-col"><h4>${esc(who)} <span>${esc(role)} - ${esc(w.toolsCount(names.length))}</span></h4><ul>${names
    .map((n) => `<li class="${admin.has(n) ? "admin" : ""}"><code>${esc(n)}</code>${admin.has(n) ? ` <span class="scope">care:admin</span>` : ""}<small>${esc(toolTitle(n))}</small></li>`)
    .join("")}</ul></div>`;
  const names = [...admin].map((n) => `<code>${esc(n)}</code>`).join(` ${w.and} `);
  box.innerHTML = `<div class="who-grid">${col(w.whoSession("Rosa"), w.patientRole, patient)}${col(w.whoSession("Daniel"), w.caregiverRole, caregiver)}</div>
    <p class="who-note">${w.whoNote(names)}</p>`;
}

let safety = null;
function paintSafety() {
  const pill = $$("#safety-pill");
  if (!pill) return;
  pill.hidden = !safety;
  if (!safety) return;
  pill.textContent = W().safety(safety);
  pill.title = W().safetyTitle(safety);
}
async function refreshSafety() {
  try {
    const r = await ui.api("/api/safety");
    if (!r.ok) throw new Error(String(r.status));
    safety = (await r.json()).headline;
  } catch {
    safety = null; // no committed results: show nothing
  }
  paintSafety();
}

// ---------- copy buttons ----------
async function copy(text, btn, labelOf) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand("copy"); } catch {}
    ta.remove();
  }
  btn.textContent = ok ? W().copied : W().copyFailed;
  setTimeout(() => (btn.textContent = labelOf()), 1400);
}
const mcpUrl = () => `${location.origin}/mcp`;
// MCP Inspector (npm @modelcontextprotocol/inspector, v1 and v2 README): CLI mode against a remote Streamable HTTP server is
// `npx @modelcontextprotocol/inspector --cli <url> --transport http --method tools/list`; the target comes first, flags after it.
const inspectorCommand = () => `npx @modelcontextprotocol/inspector --cli ${mcpUrl()} --transport http --method tools/list`;

// ---------- the panel ----------
mount.innerHTML = `<div class="wire">
  <p id="wire-head" class="wire-head mono"></p>
  <div class="wire-actions">
    <button type="button" class="wbtn" id="w-copy-url"></button>
    <button type="button" class="wbtn" id="w-copy-insp"></button>
    <button type="button" class="wbtn" id="w-who" aria-expanded="false" aria-controls="wire-who"></button>
    <span id="safety-pill" class="pill ok" hidden></span>
  </div>
  <div id="wire-who" class="wire-who" hidden></div>
  <div class="wire-probes" id="wire-probes" role="group">
    <p class="probes-title"><span id="probes-title"></span> <span id="probes-sub"></span></p>
    <div class="probes-row">${PROBES.map((id) => `<button type="button" class="wbtn probe" data-probe="${id}"></button>`).join("")}</div>
  </div>
  <div id="wire-feed" class="wire-feed" aria-live="polite"></div>
</div>`;

/** The fixed labels of the tab, in the device language. */
function paintLabels() {
  const w = W();
  const set = (sel, v) => { const e = $$(sel); if (e) e.textContent = v; };
  set("#w-copy-url", w.copyUrl);
  set("#w-copy-insp", w.copyInspector);
  set("#w-who", w.who);
  set("#probes-title", w.probesTitle);
  set("#probes-sub", `(${w.probeLabel.replace(" involved", "")})`);
  $$("#wire-probes").setAttribute("aria-label", w.probesAria);
  for (const id of PROBES) {
    const b = $$(`[data-probe="${id}"]`);
    b.textContent = w.probes[id][0];
    b.title = w.probes[id][1];
  }
  set("#wire-head", headerText());
}

$$("#w-copy-url").addEventListener("click", (e) => copy(mcpUrl(), e.currentTarget, () => W().copyUrl));
$$("#w-copy-insp").addEventListener("click", (e) => copy(inspectorCommand(), e.currentTarget, () => W().copyInspector));
$$("#w-who").addEventListener("click", (e) => {
  const open = $$("#wire-who").hidden;
  $$("#wire-who").hidden = !open;
  e.currentTarget.setAttribute("aria-expanded", String(open));
  if (open) paintWho();
});
mount.addEventListener("click", (e) => {
  const probe = e.target.closest("[data-probe]");
  if (probe) return void runProbe(probe.dataset.probe, probe);
  const call = e.target.closest(".call");
  if (call) {
    const key = call.dataset.key;
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    const open = expanded.has(key);
    call.setAttribute("aria-expanded", String(open));
    call.parentElement.querySelector(".cjson").hidden = !open;
  }
});

// A language switch redraws every label, the feed, the last-tool chip, the header, the who view and the safety pill.
document.addEventListener("carecue:lang", () => {
  paintLabels();
  renderFeed();
  paintWho();
  paintSafety();
  const el = document.getElementById("last-tool");
  if (el && feed[0] && !el.hidden) paintLastTool(feed[0]);
});

paintLabels();
renderFeed();
refreshHeader();
refreshSafety();
setInterval(refreshHeader, 30000);

// Used by the guided tour (replay mode), the scenario chips and the recorder.
window.carecueWire = {
  clear() { feed = []; expanded = new Set(); renderFeed(); const el = document.getElementById("last-tool"); if (el) el.hidden = true; },
  /** Drops the newest live model entry that failed (rate limited, degraded, HTTP error) for this text: the caller is about to
   * play the recording of the same step, and the feed must show that one only. */
  discardFailed(title) {
    const i = feed.findIndex((t) => t.tag === "model" && !t.replay && t.failed && (title == null || t.title === title));
    if (i < 0) return false;
    feed.splice(i, 1);
    renderFeed();
    const el = document.getElementById("last-tool");
    if (feed[0]) paintLastTool(feed[0]);
    else if (el) el.hidden = true;
    return true;
  },
  entries: () => feed,
  headerText,
};
