// Spend guard: one limiter in front of every route that can reach a paid model, plus household
// creation and /mcp. Active only when CARECUE_PUBLIC=1. In memory; counters reset at local midnight.
// Every number can be overridden by env so tests can use tiny limits.

import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Request } from "express";
import "./clock.ts"; // sets TZ before any Date is formatted here
import { isUrgentText } from "./emergency.ts";

const num = (name: string, dflt: number) => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(v) ? v : dflt;
};

export const cfg = {
  ipDay: num("CARECUE_LIMIT_IP_DAY", 40),
  ipBurst: num("CARECUE_LIMIT_IP_BURST", 8),
  burstWindowMin: num("CARECUE_LIMIT_BURST_WINDOW_MIN", 5),
  globalDay: num("CARECUE_LIMIT_GLOBAL_DAY", 500),
  tokenDay: num("CARECUE_LIMIT_TOKEN_DAY", 60),
  createIpHour: num("CARECUE_LIMIT_CREATE_IP_HOUR", 10),
  createGlobalDay: num("CARECUE_LIMIT_CREATE_GLOBAL_DAY", 300),
  mcpIpMin: num("CARECUE_LIMIT_MCP_IP_MIN", 120),
  urgentIpDay: num("CARECUE_LIMIT_URGENT_IP_DAY", 30),
  urgentGlobalDay: num("CARECUE_LIMIT_URGENT_GLOBAL_DAY", 2000),
};

const isPublic = () => process.env.CARECUE_PUBLIC === "1";
const isEval = () => process.env.CARECUE_EVAL === "1";
const DATA_DIR = process.env.CARECUE_DATA_DIR ?? path.join(import.meta.dirname, "..", "data");

/** Called once at boot: eval mode switches limits off, so it must never share a process with a public instance. */
export function assertBootSafe(): void {
  if (isPublic() && process.env.CARECUE_CLOCK_CONTROL === "1") {
    console.error("[limits] Refusing to start: CARECUE_CLOCK_CONTROL=1 together with CARECUE_PUBLIC=1 would let any visitor move the shared clock.");
    process.exit(1);
  }
  if (isEval() && isPublic()) {
    console.error("[limits] Refusing to start: CARECUE_EVAL=1 together with CARECUE_PUBLIC=1 would disable the spend guard.");
    process.exit(1);
  }
}

// ---------- who is calling ----------

const isLoopbackAddr = (a?: string) => !!a && (a === "::1" || a === "127.0.0.1" || a === "::ffff:127.0.0.1");

/** The client address as seen by our own reverse proxy: the LAST X-Forwarded-For entry (a client can forge earlier ones). */
export function clientIp(req: Request): string {
  const peer = req.socket.remoteAddress ?? "unknown";
  const xff = req.headers["x-forwarded-for"];
  if (isLoopbackAddr(peer) && xff) {
    const last = String(Array.isArray(xff) ? xff[xff.length - 1] : xff).split(",").pop()?.trim();
    if (last) return last;
  }
  return peer;
}

/** A request made directly on this machine (no proxy hop). The server's own voice agent calls /mcp this way. */
export function isLoopback(req: Request): boolean {
  return isLoopbackAddr(req.socket.remoteAddress) && !req.headers["x-forwarded-for"];
}

/** Eval hooks (POST /api/eval/tick, bare mode) answer only on a CARECUE_EVAL=1 server, to a direct caller on this machine. */
export function evalHookAllowed(req: Request): boolean {
  return isEval() && !isPublic() && isLoopback(req);
}

function hasRecorderKey(req: Request): boolean {
  const key = process.env.CARECUE_RECORDER_KEY;
  const got = req.headers["x-carecue-recorder"];
  if (!key || typeof got !== "string") return false;
  const a = Buffer.from(got);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Limits apply on a public instance, except for the local recorder and loopback eval runs. */
function limited(req: Request): boolean {
  if (!isPublic()) return false;
  if (hasRecorderKey(req)) return false;
  if (isEval() && isLoopback(req)) return false;
  return true;
}

/** Do the limits apply to this caller? (public instance, and not the recorder or a loopback eval run) */
export const limitsApply = limited;

// ---------- kill switch ----------

export function isPaused(): boolean {
  return process.env.CARECUE_AGENT_PAUSED === "1" || existsSync(path.join(DATA_DIR, "PAUSE"));
}

// ---------- counters ----------

const localDay = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the server time zone
let day = localDay();
const ipDay = new Map<string, number>();
const tokenDay = new Map<string, number>();
const urgentIpDay = new Map<string, number>();
const burst = new Map<string, number[]>(); // timestamps (ms)
const createIpHour = new Map<string, number[]>();
let globalDay = 0;
let urgentGlobalDay = 0;
let createGlobalDay = 0;
const mcpMin = new Map<string, number[]>();

function rollDay() {
  const d = localDay();
  if (d === day) return;
  day = d;
  for (const m of [ipDay, tokenDay, urgentIpDay]) m.clear();
  globalDay = urgentGlobalDay = createGlobalDay = 0;
}

function recent(map: Map<string, number[]>, key: string, windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  const list = (map.get(key) ?? []).filter((t) => t > cutoff);
  if (list.length) map.set(key, list);
  else map.delete(key);
  return list;
}

// Keep the maps small even if a flood of addresses shows up.
setInterval(() => {
  rollDay();
  for (const [m, w] of [[burst, cfg.burstWindowMin * 60_000], [createIpHour, 3_600_000], [mcpMin, 60_000]] as const)
    for (const k of [...m.keys()]) recent(m, k, w);
}, 60_000).unref();

// ---------- model turns ----------

export type Verdict =
  | { ok: true; via: "open" | "normal" | "urgent" | "recorder" }
  | { ok: false; reason: "paused" | "limited" | "urgent_exhausted"; urgent: boolean };

/** Decide whether this chat turn may reach the model, and count it if so. */
export function gateModelTurn(req: Request, text: string, tokenKey?: string): Verdict {
  const urgent = isUrgentText(text);
  if (isPaused()) return { ok: false, reason: "paused", urgent };
  if (!limited(req)) return { ok: true, via: isPublic() ? "recorder" : "open" };
  rollDay();
  const ip = clientIp(req);
  const windowMs = cfg.burstWindowMin * 60_000;
  const burstList = recent(burst, ip, windowMs);
  const ipCount = ipDay.get(ip) ?? 0;
  const tokCount = tokenKey ? (tokenDay.get(tokenKey) ?? 0) : 0;

  const over = ipCount >= cfg.ipDay || burstList.length >= cfg.ipBurst || globalDay >= cfg.globalDay || (!!tokenKey && tokCount >= cfg.tokenDay);
  if (!over) {
    burstList.push(Date.now());
    burst.set(ip, burstList);
    ipDay.set(ip, ipCount + 1);
    globalDay++;
    if (tokenKey) tokenDay.set(tokenKey, tokCount + 1);
    return { ok: true, via: "normal" };
  }
  if (!urgent) return { ok: false, reason: "limited", urgent };
  // Emergency, distress and the like skip the caps, within their own small budget.
  const u = urgentIpDay.get(ip) ?? 0;
  if (u >= cfg.urgentIpDay || urgentGlobalDay >= cfg.urgentGlobalDay) return { ok: false, reason: "urgent_exhausted", urgent };
  urgentIpDay.set(ip, u + 1);
  urgentGlobalDay++;
  return { ok: true, via: "urgent" };
}

export const CANNED = {
  en: "The live demo is resting for today to keep costs down. Press Play Rosa's day to watch a recorded run of the real agent.",
  es: "La demo en vivo está descansando por hoy para cuidar los costos. Toque Reproducir el día de Rosa para ver una grabación del agente real.",
};

// ---------- household creation (POST /api/app/households, later POST /api/sandbox) ----------

/** Returns seconds to wait if creation is throttled, else 0 (and counts it). */
export function gateCreate(req: Request): number {
  if (!limited(req)) return 0;
  rollDay();
  const ip = clientIp(req);
  const list = recent(createIpHour, ip, 3_600_000);
  if (list.length >= cfg.createIpHour) return Math.max(1, Math.ceil((list[0] + 3_600_000 - Date.now()) / 1000));
  if (createGlobalDay >= cfg.createGlobalDay) return 3600;
  list.push(Date.now());
  createIpHour.set(ip, list);
  createGlobalDay++;
  return 0;
}

// ---------- /mcp ----------

/** Seconds to wait if this /mcp request is over the per-IP rate, else 0. The server's own agent (loopback) is exempt. */
export function gateMcp(req: Request): number {
  if (!limited(req) || isLoopback(req)) return 0;
  const ip = clientIp(req);
  const list = recent(mcpMin, ip, 60_000);
  if (list.length >= cfg.mcpIpMin) return Math.max(1, Math.ceil((list[0] + 60_000 - Date.now()) / 1000));
  list.push(Date.now());
  mcpMin.set(ip, list);
  return 0;
}

// ---------- GET /api/limits ----------

export function describe(req: Request, tokenKey?: string) {
  const on = limited(req);
  rollDay();
  const ip = clientIp(req);
  const left = (limit: number, used: number) => Math.max(0, limit - used);
  const burstUsed = recent(burst, ip, cfg.burstWindowMin * 60_000);
  const day_ = left(cfg.ipDay, ipDay.get(ip) ?? 0);
  const burst_ = left(cfg.ipBurst, burstUsed.length);
  const global_ = left(cfg.globalDay, globalDay);
  const token_ = tokenKey ? left(cfg.tokenDay, tokenDay.get(tokenKey) ?? 0) : undefined;
  const turns = Math.min(day_, burst_, global_, token_ ?? Infinity);
  return {
    enabled: on,
    paused: isPaused(),
    recorder: hasRecorderKey(req),
    // null means "not limited for you"
    remaining_turns: on ? turns : null,
    detail: on
      ? {
          day: { limit: cfg.ipDay, remaining: day_ },
          burst: { limit: cfg.ipBurst, remaining: burst_, window_minutes: cfg.burstWindowMin, resets_in_s: burstUsed.length ? Math.max(0, Math.ceil((burstUsed[0] + cfg.burstWindowMin * 60_000 - Date.now()) / 1000)) : 0 },
          global: { limit: cfg.globalDay, remaining: global_ },
          ...(token_ !== undefined ? { token: { limit: cfg.tokenDay, remaining: token_ } } : {}),
          urgent: { limit: cfg.urgentIpDay, remaining: left(cfg.urgentIpDay, urgentIpDay.get(ip) ?? 0) },
          households_per_hour: { limit: cfg.createIpHour, remaining: left(cfg.createIpHour, recent(createIpHour, ip, 3_600_000).length) },
        }
      : null,
  };
}
