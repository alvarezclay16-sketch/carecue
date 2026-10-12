// Spend guard checks against RUNNING servers (this file starts nothing; scripts/test-limits.sh does).
//   node tests/limits.ts <main-url> [<caps-url> [<paused-url>]]
// main:   CARECUE_PUBLIC=1 CARECUE_FAKE_AGENT=1 CARECUE_RECORDER_KEY=$KEY CARECUE_DATA_DIR=$LIMITS_DATA_DIR
//         CARECUE_LIMIT_IP_BURST=3 CARECUE_LIMIT_IP_DAY=50 CARECUE_LIMIT_TOKEN_DAY=4 CARECUE_LIMIT_CREATE_IP_HOUR=3
//         CARECUE_LIMIT_URGENT_IP_DAY=2 CARECUE_LIMIT_MCP_IP_MIN=6
// caps:   CARECUE_PUBLIC=1 CARECUE_FAKE_AGENT=1 CARECUE_LIMIT_IP_DAY=2 CARECUE_LIMIT_IP_BURST=100 CARECUE_LIMIT_GLOBAL_DAY=3
// paused: CARECUE_PUBLIC=1 CARECUE_FAKE_AGENT=1 CARECUE_AGENT_PAUSED=1
// The servers have no model credentials, so a reply that is not "[fake agent]" never came from a model.
// Env for this process: CARECUE_RECORDER_KEY (same value as the main server) and LIMITS_DATA_DIR (its CARECUE_DATA_DIR).

import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const main = process.argv[2];
const capsUrl = process.argv[3];
const pausedUrl = process.argv[4];
if (!main) throw new Error("usage: node tests/limits.ts <main-url> [<caps-url> [<paused-url>]]");

const KEY = process.env.CARECUE_RECORDER_KEY ?? "";
const DATA_DIR = process.env.LIMITS_DATA_DIR ?? "";
let n = 0;
const newIp = () => `10.${(Date.now() >> 8) & 255}.${Math.floor(n++ / 250) % 250}.${(n % 250) + 1}`;

type Json = Record<string, any>;
async function call(base: string, p: string, o: { ip?: string; xff?: string; body?: unknown; headers?: Record<string, string>; method?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(o.headers ?? {}) };
  if (o.xff ?? o.ip) headers["x-forwarded-for"] = (o.xff ?? o.ip)!;
  const r = await fetch(base + p, { method: o.method ?? (o.body === undefined ? "GET" : "POST"), headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await r.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, headers: r.headers };
}
const chat = (base: string, ip: string, text: string, headers: Record<string, string> = {}) =>
  call(base, "/api/chat", { ip, body: { text, conversationId: "t" }, headers });
const isFake = (r: { json: Json }) => r.json.reply === "[fake agent] ok" && !r.json.limited;
const isLimited = (r: { status: number; json: Json }) => r.status === 200 && r.json.limited === true && Array.isArray(r.json.toolCalls) && r.json.toolCalls.length === 0;
const ok = (m: string) => console.log("ok:", m);

// ---------- main server ----------
{
  const ip = newIp();
  let lim = (await call(main, "/api/limits", { ip })).json;
  assert.equal(lim.enabled, true);
  assert.equal(lim.remaining_turns, 3);

  // burst of 3, the 4th is answered without a model
  for (let i = 0; i < 3; i++) assert.ok(isFake(await chat(main, ip, "What is next?")), `turn ${i + 1} should reach the agent`);
  const over = await chat(main, ip, "What is next?");
  assert.ok(isLimited(over), "4th turn in the burst window is limited");
  assert.match(over.json.reply, /live demo is resting/);
  assert.match(over.json.reply, /Rosa's day/);
  lim = (await call(main, "/api/limits", { ip })).json;
  assert.equal(lim.remaining_turns, 0);
  assert.equal(lim.detail.burst.remaining, 0);
  ok("burst: 3 turns served, the 4th is limited:true with the canned sentence");

  const es = await chat(main, ip, "¿Qué remedio me toca ahora?");
  assert.ok(isLimited(es));
  assert.match(es.json.reply, /demo en vivo/);
  ok("canned sentence in Spanish for Spanish text");

  assert.ok(isFake(await chat(main, newIp(), "hello")), "another address is not affected");
  ok("limits are per address");

  // The leftmost X-Forwarded-For entry is client-controlled; the bucket is the entry our proxy added.
  const forged = await chat(main, ip, "hello", { "x-forwarded-for": `6.6.6.6, ${ip}` });
  assert.ok(isLimited(forged), "forging the first X-Forwarded-For entry must not reset the bucket");
  ok("forged X-Forwarded-For does not escape the bucket");

  // Emergency text from the exhausted address still reaches the agent, within its own small budget (2/day here).
  for (const t of ["I have a pain in my chest", "me caí en el baño"]) assert.ok(isFake(await chat(main, ip, t)), `urgent text answered: ${t}`);
  const third = await chat(main, ip, "I can't breathe");
  assert.ok(isLimited(third) && third.json.degraded === true, "urgent bypass budget exhausted");
  assert.match(third.json.reply, /\b(131|911)\b/, "exhausted bypass still gives the emergency number");
  assert.doesNotMatch(third.json.reply, /resting/);
  ok("urgent text bypasses the cap (2 here); beyond that the reply carries the emergency number");

  // Recorder key
  for (let i = 0; i < 12; i++) assert.ok(isFake(await chat(main, ip, "hello", { "x-carecue-recorder": KEY })), "recorder never limited");
  assert.ok(isLimited(await chat(main, ip, "hello", { "x-carecue-recorder": KEY + "x" })), "wrong key is limited");
  assert.ok(isLimited(await chat(main, ip, "hello", { "x-carecue-recorder": "" })), "empty key is limited");
  lim = (await call(main, "/api/limits", { ip, headers: { "x-carecue-recorder": KEY } })).json;
  assert.equal(lim.enabled, false);
  assert.equal(lim.recorder, true);
  ok("recorder header bypasses limits; wrong or empty key does not");

  // Household creation throttle and per-IP counter across fresh households
  const c = newIp();
  const tokens: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await call(main, "/api/app/households", { ip: c, body: { patientName: `P${i}`, caregiverName: "C" } });
    assert.equal(r.status, 200);
    tokens.push(r.json.token);
  }
  const blocked = await call(main, "/api/app/households", { ip: c, body: { patientName: "P4", caregiverName: "C" } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal(
    (await call(main, "/api/app/households", { ip: c, body: { patientName: "R", caregiverName: "C" }, headers: { "x-carecue-recorder": KEY } })).status,
    200,
  );
  assert.equal((await call(main, "/api/app/households", { ip: newIp(), body: { patientName: "Q", caregiverName: "C" } })).status, 200);
  // a bad request is a 400, not counted
  assert.equal((await call(main, "/api/app/households", { ip: newIp(), body: {} })).status, 400);
  ok("household creation: 3 per hour per address, then 429 with Retry-After; recorder and other addresses unaffected");

  const appChat = (token: string, ip2: string) =>
    call(main, "/api/app/chat", { ip: ip2, body: { text: "hello" }, headers: { authorization: `Bearer ${token}` } });
  const results = [];
  for (const t of tokens) for (let k = 0; k < 2; k++) results.push(await appChat(t, c));
  assert.deepEqual(results.map((r) => r.json.limited === true), [false, false, false, true, true, true]);
  ok("app chat: tokens of 3 fresh households from one address share the per-address counter (3 then limited)");

  // Per-token cap (4 here) holds even when the addresses differ
  const tk = tokens[0];
  const g1 = newIp(), g2 = newIp(), g3 = newIp();
  const seq = [await appChat(tk, g1), await appChat(tk, g1), await appChat(tk, g1), await appChat(tk, g2), await appChat(tk, g3)];
  // tk already had 2 turns served above (first round); the cap is 4 whatever the address.
  assert.deepEqual(seq.map((r) => r.json.limited === true), [false, false, true, true, true]);
  ok("per-app-token cap is enforced across addresses");

  // /mcp rate: 6 per minute per address (proxied), the server's own loopback agent is exempt
  const mcp = newIp();
  const ping = (ip2?: string) =>
    call(main, "/mcp", { ip: ip2, body: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { accept: "application/json, text/event-stream" } });
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await ping(mcp)).status);
  assert.deepEqual(codes.map((s) => s === 429), [false, false, false, false, false, false, true, true]);
  const direct = [];
  for (let i = 0; i < 10; i++) direct.push((await ping()).status);
  assert.ok(direct.every((s) => s !== 429), "direct loopback /mcp calls are not limited");
  ok("/mcp: per-address rate limit, loopback agent exempt");

  // Kill switch by file
  assert.ok(DATA_DIR, "LIMITS_DATA_DIR is required for the kill-switch check");
  const pauseFile = path.join(DATA_DIR, "PAUSE");
  writeFileSync(pauseFile, "");
  try {
    const p = newIp();
    const r = await chat(main, p, "What is next?");
    assert.ok(isLimited(r) && /resting/.test(r.json.reply), "paused: canned reply, no model");
    const u = await chat(main, p, "I have a pain in my chest");
    assert.ok(isLimited(u) && /\b(131|911)\b/.test(u.json.reply), "paused: urgent text gets the emergency number");
    assert.ok(isLimited(await chat(main, p, "hello", { "x-carecue-recorder": KEY })), "paused applies to the recorder too");
    assert.equal((await call(main, "/api/limits", { ip: p })).json.paused, true);
  } finally {
    rmSync(pauseFile, { force: true });
  }
  assert.ok(isFake(await chat(main, newIp(), "hello")), "resumes when data/PAUSE is removed");
  ok("kill switch: data/PAUSE answers canned at once and resumes when removed");
}

// ---------- day and global caps ----------
if (capsUrl) {
  const a = newIp(), b = newIp(), d = newIp();
  assert.ok(isFake(await chat(capsUrl, a, "hello")));
  assert.ok(isFake(await chat(capsUrl, a, "hello")));
  assert.ok(isLimited(await chat(capsUrl, a, "hello")), "per-address day cap (2)");
  assert.ok(isFake(await chat(capsUrl, b, "hello")), "global turn 3 of 3");
  assert.ok(isLimited(await chat(capsUrl, d, "hello")), "global day cap (3)");
  assert.ok(isFake(await chat(capsUrl, d, "I fell down and I can't get up")), "urgent text still passes the global cap");
  ok("day cap per address and global cap");
}

// ---------- kill switch by env ----------
if (pausedUrl) {
  const p = newIp();
  const r = await chat(pausedUrl, p, "What is next?");
  assert.ok(isLimited(r) && /resting/.test(r.json.reply));
  const u = await chat(pausedUrl, p, "Me duele el pecho");
  assert.ok(isLimited(u) && /\b(131|911)\b/.test(u.json.reply));
  assert.equal((await call(pausedUrl, "/api/limits", { ip: p })).json.paused, true);
  ok("kill switch by CARECUE_AGENT_PAUSED=1");
}

console.log("\nLIMITS CHECKS PASSED");
