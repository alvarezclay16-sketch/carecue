// Shared types of the safety suite (tests/safety). Types only, so this file has no runtime code.

export type Lang = "en" | "es";

/** A medicine in a scenario's household. `at` is minutes relative to the server clock: -5 due now, -40 missed, +150 upcoming. */
export type MedSetup = {
  name: string;
  dose: string; // as written on the label, e.g. "850 mg, 1 tablet"
  at: number | number[];
  taken?: boolean; // logged as taken before the first turn
  note?: string; // note stored with that pre-logged dose
  units?: number; // units on hand (default 60, so no refill alert)
  instructions?: string;
};

export type Setup = { patient: string; caregiver: string; relationship: string; phone: string; meds: MedSetup[] };

export type Turn = {
  say: string;
  /** This utterance must be recognised by the lexicon of that name (src/emergency.ts): tests/lexicon.ts checks it. */
  lex?: "emergency" | "distress" | "extra_dose";
};

export type ToolCallLite = {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
  ok: boolean | null;
  guard: string | null;
  effect: string;
  result: unknown;
  ms: number;
};

export type TurnRec = {
  user: string;
  reply: string;
  toolCalls: ToolCallLite[];
  ms: number; // wall time seen by the client
  server_ms?: number;
  model?: { provider: string; id: string };
  infra?: string; // set when the turn did not reach a model (HTTP error, degraded or limited answer)
};

export type DoseRow = { medication: string; time: string; status: string; taken_at: string | null };
export type StateSnap = {
  clock: string;
  doses: DoseRow[];
  alerts: Array<{ kind: string; severity: string; message: string; acknowledged: number; delivered_to: string }>;
  checkins: Array<{ mood: string; note: string }>;
  medications: Array<{ name: string; dose: string; units_on_hand: number }>;
  notes: Array<{ medication: string; time: string; status: string; note: string }>;
};

/** Everything an invariant or an assertion may look at. */
export type Transcript = {
  id: string;
  lang: Lang;
  tags: string[];
  setup: Setup;
  turns: TurnRec[];
  before: StateSnap;
  after: StateSnap;
  caregivers: string[]; // first names
  emergencyNumber: string; // "131" | "911"
  crisisLine: string; // "*4141" | "988"
  emergencyTurn?: number;
  distressTurn?: number;
  optOut?: string[];
};

export type Scenario = {
  id: string;
  lang: Lang;
  tags: string[]; // see TAGS in scenarios.ts
  hazard: string[]; // H1..H13 (docs/safety-case.md)
  setup: Setup;
  turns: Turn[];
  /** Scenario-specific assertions on tool calls and state: returns one message per failure. */
  assert?: (t: Transcript) => string[];
  /** Invariants this scenario does not take part in, each with a one-line reason in scenarios.ts. */
  optOut?: string[];
  emergencyTurn?: number; // turn in which the emergency is first said (default 0)
  distressTurn?: number;
};

export type Violation = { code: string; msg: string; turn?: number };
