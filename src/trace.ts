// What one MCP tool call did, in a form the wire tab, the tests and the safety suite can all read.
// Pure functions only (no database, no network), so tests/trace.ts can run without a server.

export type ToolSource = "model" | "probe" | "touch";
export type Guard = "unconfirmed" | "possible_double_dose" | "too_early" | "nothing_due" | "not_found";
export type Effect = "read" | "refused" | "notified" | "error" | "wrote";
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolTrace = {
  name: string;
  input: unknown;
  isError: boolean;
  ms: number;
  result: unknown; // parsed JSON when the tool returned JSON, else the text; long strings are capped
  ok: boolean | null; // result.ok, or null when the tool has no ok field
  guard: Guard | null; // first known code in result.warnings
  effect: Effect;
  annotations: ToolAnnotations | null;
  source: ToolSource;
};

export const GUARDS: readonly Guard[] = ["unconfirmed", "possible_double_dose", "too_early", "nothing_due", "not_found"];
const STRING_CAP = 4000;

/** Same value with every string cut to `cap` characters (arrays and objects are copied, never changed in place). */
export function capStrings(value: unknown, cap = STRING_CAP): unknown {
  if (typeof value === "string") return value.length > cap ? `${value.slice(0, cap)}…` : value;
  if (Array.isArray(value)) return value.map((v) => capStrings(v, cap));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, capStrings(v, cap)]));
  return value;
}

export function parseResult(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function guardOf(result: unknown): Guard | null {
  const w = (result as { warnings?: unknown } | null)?.warnings;
  if (!Array.isArray(w)) return null;
  return GUARDS.find((g) => w.includes(g)) ?? null;
}

/** What the call did to the world. A failed call is an error, whatever kind of tool it was. */
export function effectOf(name: string, ok: boolean | null, isError: boolean, annotations: ToolAnnotations | null): Effect {
  if (isError) return "error";
  if (annotations?.readOnlyHint) return "read";
  if (name === "notify_caregiver") return ok === false ? "error" : "notified";
  if (ok === false) return "refused"; // log_dose (and any other write) that wrote nothing
  return "wrote";
}

export function buildToolTrace(args: {
  name: string;
  input: unknown;
  text: string;
  isError: boolean;
  ms: number;
  annotations?: ToolAnnotations | null;
  source?: ToolSource;
}): ToolTrace {
  const parsed = parseResult(args.text);
  const ok = typeof (parsed as { ok?: unknown } | null)?.ok === "boolean" ? ((parsed as { ok: boolean }).ok) : null;
  const annotations = args.annotations ?? null;
  return {
    name: args.name,
    input: args.input,
    isError: args.isError,
    ms: Math.round(args.ms),
    result: capStrings(parsed),
    ok,
    guard: guardOf(parsed),
    effect: effectOf(args.name, ok, args.isError, annotations),
    annotations,
    source: args.source ?? "model",
  };
}
