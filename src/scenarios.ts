// The scenario chips: one source of truth for the web demo, the guided tour and video/record.mjs.
// Setup is deterministic and never calls the model; times are relative to the server clock.
// The client sends `say` through the normal chat route, so a chip costs at most one model turn.

import * as care from "./care.ts";
import { db } from "./db.ts";
import { resetHouseholdData, nowMinutes } from "./sample.ts";

export type ScenarioId = "morning" | "hedged" | "took" | "extra" | "missed" | "chest" | "spanish";
export type Lang = "en" | "es";

type Scenario = {
  lang: Lang;
  /** What the chip says to the assistant, if anything (in `lang`). */
  say?: string;
  /** The same line in Spanish, for a visitor whose page is in Spanish (the tour stays in English and uses `say`). */
  sayEs?: string;
  /** Re-seeds the household for this scenario. Returns "replay" when it cannot run honestly right now. */
  setup: (patientId: number, nowMin: number) => Promise<void | "replay">;
};

// The missed-dose scenario needs 55 minutes of past time on today's date.
const MIDNIGHT_EDGE_MIN = 55;

const fresh = (lateBy: number) => async (patientId: number, nowMin: number) => {
  resetHouseholdData(patientId, { lateBy, nowMin });
  await care.tick(patientId); // the reminder (or the family alert) appears now, not on the next 5 s tick
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  // Losartan and Metformin were due 3 minutes ago: the reminder scene.
  morning: { lang: "en", setup: fresh(3) },
  hedged: { lang: "en", say: "I think I took it, maybe.", sayEs: "Creo que ya me lo tomé, tal vez.", setup: fresh(3) },
  // Same state; the visitor taps "I took it" (the touch path, no model).
  took: { lang: "en", setup: fresh(3) },
  // Both doses already logged through the real guard, then a request for another one.
  extra: {
    lang: "en",
    say: "I'll take another one, just in case.",
    sayEs: "Me voy a tomar otra más, por si acaso.",
    setup: async (patientId, nowMin) => {
      await fresh(3)(patientId, nowMin);
      care.logDose(patientId, "all_due", "taken", "");
      care.clearEvents(patientId); // the reminder that fired before the log is not news any more
    },
  },
  // A dose from 50 minutes ago, then the tick: the family alert exists for Daniel.
  missed: {
    lang: "en",
    setup: async (patientId, nowMin) => {
      if (nowMin < MIDNIGHT_EDGE_MIN) return "replay";
      await fresh(50)(patientId, nowMin);
    },
  },
  chest: { lang: "en", say: "I don't feel good. I have a pain in my chest.", sayEs: "No me siento bien. Me duele el pecho.", setup: fresh(3) },
  spanish: { lang: "es", say: "¿Qué remedio me toca ahora?", setup: fresh(3) },
};

export const isScenarioId = (id: string): id is ScenarioId => Object.hasOwn(SCENARIOS, id);

/** The public list the client and the tour read. */
export function scenarioList() {
  return (Object.keys(SCENARIOS) as ScenarioId[]).map((id) => ({ id, lang: SCENARIOS[id].lang, say: SCENARIOS[id].say ?? null }));
}

/**
 * Re-seeds one household for a scenario. `lang` (when given) is the visitor's language: a scenario that says nothing
 * follows it, one with a Spanish variant says it in Spanish for a Spanish visitor, and the Spanish scenario is always
 * Spanish. Without `lang` (the tour, the recorder, the tests) the English line is used.
 */
export async function applyScenario(patientId: number, id: ScenarioId, lang?: Lang, nowMin = nowMinutes()) {
  const s = SCENARIOS[id];
  const spanishVisitor = lang === "es" && !!s.sayEs;
  const language: Lang = spanishVisitor ? "es" : s.say ? s.lang : (lang ?? s.lang);
  const utterance = spanishVisitor ? s.sayEs! : (s.say ?? null);
  db.prepare("UPDATE patients SET preferred_language = ? WHERE id = ?").run(language, patientId);
  const outcome = await s.setup(patientId, nowMin);
  return { scenario: id, lang: language, utterance, replay: outcome === "replay" };
}
