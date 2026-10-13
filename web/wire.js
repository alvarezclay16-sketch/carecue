// The "MCP wire" tab: every MCP tool call the demo makes, as the server reports it.
// Sources: a MODEL turn (the agent called tools), a TOUCH (the "I took it" button, no model) and a PROBE
// (a labelled direct tool call, no model). Everything shown comes from the server's own ToolTrace
// (name, input, result, ok, guard, effect, ms, annotations, source); this file only formats it.
// Tokens and Authorization headers are never rendered (see redact()).

const ui = window.carecueUI;
const mount = ui.wireMount;
const $$ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

import { PROBE_LABEL, TAGS, argsSummary, badgeFor, lastToolText, prettyJson, unchangedText } from "./wire-format.js";

const FEED_MAX = 40;

const PROBES = [
  { id: "hedged_log", label: "Log a hedged dose", hint: "log_dose with person_was_certain: false" },
  { id: "double_log", label: "Log a dose twice", hint: "log_dose for a medicine already taken today" },
  { id: "remove_med", label: "Remove a medicine", hint: "stop_medication with Rosa's own token" },
];

// ---------- the feed ----------
let feed = []; // newest first: { id, tag, title, ms, model, replay, label, calls, notes, unchanged }
let nextId = 1;
let expanded = new Set(); // "turnId:callIndex"

function callHtml(turn, t, i) {
  const key = `${turn.id}:${i}`;
  const open = expanded.has(key);
  const b = badgeFor(t);
  const tag = TAGS[t.source] ?? "MODEL";
  return `<li class="call-item">
    <button type="button" class="call" data-key="${key}" aria-expanded="${open}">
      <span class="tag tag-${esc(t.source ?? "model")}">${tag}</span>
      <span class="cname">${esc(t.name)}</span>
      <span class="cargs">${esc(argsSummary(t.input))}</span>
      <span class="cms">${esc(t.ms)} ms</span>
      <span class="badge-w b-${b.tone}">${esc(b.text)}</span>
    </button>
    ${b.note ? `<p class="call-note">${esc(b.note)}</p>` : ""}
    <pre class="cjson" ${open ? "" : "hidden"}>${esc(prettyJson({ input: t.input, result: t.result, annotations: t.annotations ?? undefined }))}</pre>
  </li>`;
}

function turnHtml(turn) {
  const tag = TAGS[turn.tag] ?? "MODEL";
  const sec = turn.ms == null ? "" : turn.ms < 1000 ? `${turn.ms} ms` : `${(turn.ms / 1000).toFixed(1)} s`;
  const head = [
    `<span class="tag tag-${esc(turn.tag)}">${tag}</span>`,
    turn.title ? `<q class="turn-q">${esc(turn.title)}</q>` : "",
    sec ? `<span class="turn-ms">${esc(sec)}</span>` : "",
    turn.model ? `<span class="turn-model">${esc(turn.model)}</span>` : "",
  ].join("");
  const label = turn.replay
    ? `<p class="turn-label replay">Replay of a real run (the live demo is resting)</p>`
    : turn.label
      ? `<p class="turn-label">${esc(turn.label)}</p>`
      : "";
  const chips = [
    ...(turn.unchanged ? [`<li class="chip-note">${esc(turn.unchanged)}</li>`] : []),
    ...turn.calls.map((t, i) => [t, i]).reverse().map(([t, i]) => callHtml(turn, t, i)),
    ...turn.notes.map((n) => `<li class="chip-note">${esc(n)}</li>`),
  ];
  return `<section class="turn" aria-label="${esc(tag)} turn"><div class="turn-head">${head}</div>${label}<ul class="calls">${chips.join("")}</ul></section>`;
}

function renderFeed() {
  const box = $$("#wire-feed");
  if (!box) return;
  box.innerHTML = feed.length
    ? feed.map(turnHtml).join("")
    : `<p class="wire-empty">No tool calls yet. Say something to Rosa's device, tap a button, or press a probe: each MCP call shows up here.</p>`;
}

function paintLastTool(turn) {
  const el = document.getElementById("last-tool");
  if (!el) return;
  const text = lastToolText(turn);
  el.hidden = !text;
  el.textContent = text;
  const t = turn.calls[turn.calls.length - 1];
  el.dataset.tone = t ? badgeFor(t).tone : "grey";
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
  turn.unchanged = unchangedText(before, after, turn.calls.length > 0);
  renderFeed();
}

// ---------- events from the device ----------
document.addEventListener("carecue:turn", (e) => {
  const { text, status, response, replay, unchanged } = e.detail;
  const r = response ?? {};
  const turn = addTurn({
    tag: "model",
    title: text,
    ms: r.ms ?? null,
    model: r.model ? `${r.model.provider} ${r.model.id}` : null,
    replay: !!replay,
    calls: Array.isArray(r.toolCalls) ? r.toolCalls : [],
    notes: status >= 400 ? [r.error ?? `HTTP ${status}`] : r.limited ? ["Not sent to the model: the demo is rate limited right now."] : r.degraded ? ["The model was unavailable: a safe canned reply was spoken, nothing was written."] : [],
  });
  if (status < 400 && !r.limited && !r.degraded) {
    if (replay) { turn.unchanged = unchanged ?? null; renderFeed(); }
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
    title: "Tapped “I took it”",
    ms: r.trace?.ms ?? null,
    replay: !!replay,
    label: replay ? null : "MCP log_dose from the touch screen - no model involved",
    calls: r.trace ? [r.trace] : [],
    notes: status >= 400 ? [r.error ?? `HTTP ${status}`] : [],
  });
});

// ---------- probes ----------
async function runProbe(id, btn) {
  const all = mount.querySelectorAll(".probe");
  all.forEach((b) => (b.disabled = true));
  btn.setAttribute("aria-busy", "true");
  try {
    const res = await ui.post("/api/probe", { id });
    const data = await res.json();
    if (res.status === 409) {
      addTurn({ tag: "probe", title: PROBES.find((p) => p.id === id)?.label, label: PROBE_LABEL, notes: [`Not possible right now: ${data.error} ${data.hint ? `(${data.hint})` : ""}`.trim()] });
    } else if (!res.ok) {
      addTurn({ tag: "probe", title: PROBES.find((p) => p.id === id)?.label, label: PROBE_LABEL, notes: [data.error ?? `HTTP ${res.status}`] });
    } else {
      addTurn({ tag: "probe", title: PROBES.find((p) => p.id === id)?.label, ms: data.trace?.ms ?? null, label: data.label ?? PROBE_LABEL, calls: [data.trace] });
    }
    ui.refresh();
  } catch {
    addTurn({ tag: "probe", title: PROBES.find((p) => p.id === id)?.label, label: PROBE_LABEL, notes: ["Could not reach the server."] });
  } finally {
    all.forEach((b) => (b.disabled = false));
    btn.removeAttribute("aria-busy");
  }
}

// ---------- header strip, who sees what, safety pill ----------
let info = null;
let model = null;

function headerText() {
  const bits = ["MCP", "Streamable HTTP"];
  if (info) {
    bits.push(info.protocolVersion);
    if (info.serverInfo) bits.push(`${info.serverInfo.name} ${info.serverInfo.version}`);
    bits.push(`${info.tools.length} tools`);
  } else bits.push("handshake not read yet");
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
  const patient = info.roles.patient;
  const caregiver = info.roles.caregiver;
  const admin = new Set(caregiver.filter((n) => !patient.includes(n)));
  const titleOf = (n) => info.tools.find((t) => t.name === n)?.title ?? "";
  const col = (who, role, names) => `<div class="who-col"><h4>${esc(who)} <span>${esc(role)} - ${names.length} tools</span></h4><ul>${names
    .map((n) => `<li class="${admin.has(n) ? "admin" : ""}"><code>${esc(n)}</code>${admin.has(n) ? ` <span class="scope">care:admin</span>` : ""}<small>${esc(titleOf(n))}</small></li>`)
    .join("")}</ul></div>`;
  box.innerHTML = `<div class="who-grid">${col("Rosa's session", "patient role", patient)}${col("Daniel's session", "caregiver role", caregiver)}</div>
    <p class="who-note">The server registers ${[...admin].map((n) => `<code>${esc(n)}</code>`).join(" and ")} only for the caregiver role, and answers HTTP 403 insufficient_scope to anyone else. The voice agent runs as Rosa; so does an anonymous MCP client.</p>`;
}

async function refreshSafety() {
  const pill = $$("#safety-pill");
  if (!pill) return;
  try {
    const r = await ui.api("/api/safety");
    if (!r.ok) throw new Error(String(r.status));
    const s = (await r.json()).headline;
    pill.hidden = false;
    pill.textContent = `Safety suite ${s.pass2}/${s.n}`;
    pill.title = `${s.n} adversarial scenarios, all pass within 2 attempts; first try ${s.pass1}/${s.n}; ${s.unsafe_replies} unsafe replies; ${s.provider} ${s.model}; ${s.date}. Run it with: npm run safety`;
  } catch {
    pill.hidden = true; // no committed results: show nothing
  }
}

// ---------- copy buttons ----------
async function copy(text, btn) {
  const was = btn.dataset.label ?? btn.textContent;
  btn.dataset.label = was;
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
  btn.textContent = ok ? "Copied" : "Copy failed";
  setTimeout(() => (btn.textContent = was), 1400);
}
const mcpUrl = () => `${location.origin}/mcp`;
const inspectorCommand = () => `npx @modelcontextprotocol/inspector --cli ${mcpUrl()} --transport http --method tools/list`;

// ---------- the panel ----------
mount.innerHTML = `<div class="wire">
  <p id="wire-head" class="wire-head mono">${esc(headerText())}</p>
  <div class="wire-actions">
    <button type="button" class="wbtn" id="w-copy-url">Copy MCP URL</button>
    <button type="button" class="wbtn" id="w-copy-insp">Copy Inspector command</button>
    <button type="button" class="wbtn" id="w-who" aria-expanded="false" aria-controls="wire-who">Who sees what</button>
    <span id="safety-pill" class="pill ok" hidden></span>
  </div>
  <div id="wire-who" class="wire-who" hidden></div>
  <div class="wire-probes" role="group" aria-label="If the model slips: direct tool calls, no model">
    <p class="probes-title">If the model slips... <span>(${esc(PROBE_LABEL.replace(" involved", ""))})</span></p>
    <div class="probes-row">${PROBES.map((p) => `<button type="button" class="wbtn probe" data-probe="${p.id}" title="${esc(p.hint)}">${esc(p.label)}</button>`).join("")}</div>
  </div>
  <div id="wire-feed" class="wire-feed" aria-live="polite"></div>
</div>`;

$$("#w-copy-url").addEventListener("click", (e) => copy(mcpUrl(), e.currentTarget));
$$("#w-copy-insp").addEventListener("click", (e) => copy(inspectorCommand(), e.currentTarget));
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

renderFeed();
refreshHeader();
refreshSafety();
setInterval(refreshHeader, 30000);

// Used by the guided tour (replay mode) and the recorder.
window.carecueWire = {
  clear() { feed = []; expanded = new Set(); renderFeed(); const el = document.getElementById("last-tool"); if (el) el.hidden = true; },
  entries: () => feed,
  headerText,
};
