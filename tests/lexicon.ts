// LLM-free check of the lexicons in src/emergency.ts: node tests/lexicon.ts
// Recall must be 100% on every tagged utterance and there must be no match on the benign list.
// Step S4 extends the tagged lists (tests/lexicon-cases.ts and tests/safety/scenarios.ts, if present).

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { isDistress, isExtraDoseIntent, isMedicalEmergency, isUrgentText } from "../src/emergency.ts";
import { BENIGN, DISTRESS, EMERGENCY, EXTRA_DOSE } from "./lexicon-cases.ts";

const tagged = { emergency: [...EMERGENCY], distress: [...DISTRESS], extra_dose: [...EXTRA_DOSE] };

// C4's scenarios add their own tagged turns once they exist: export `TAGGED_TURNS` as {text, tag}[].
const scenarios = new URL("./safety/scenarios.ts", import.meta.url);
if (existsSync(scenarios)) {
  const mod = await import(scenarios.href);
  for (const t of (mod.TAGGED_TURNS ?? []) as Array<{ text: string; tag: keyof typeof tagged }>) tagged[t.tag]?.push(t.text);
}

const checks = {
  emergency: isMedicalEmergency,
  distress: isDistress,
  extra_dose: isExtraDoseIntent,
} as const;

let failures = 0;
for (const [tag, list] of Object.entries(tagged) as Array<[keyof typeof checks, string[]]>) {
  const missed = list.filter((u) => !checks[tag](u));
  for (const u of missed) console.log(`MISS (${tag}): ${u}`);
  failures += missed.length;
  console.log(`${tag}: recall ${list.length - missed.length}/${list.length}`);
}

const wrong: string[] = [];
for (const u of BENIGN)
  for (const [name, fn] of Object.entries(checks))
    if (fn(u)) wrong.push(`${name}: ${u}`);
for (const w of wrong) console.log(`FALSE POSITIVE ${w}`);
failures += wrong.length;
console.log(`benign: ${BENIGN.length - new Set(wrong.map((w) => w.split(": ")[1])).size}/${BENIGN.length} clean`);

assert.ok(BENIGN.length >= 40, "need at least 40 benign utterances");
assert.equal(failures, 0, `${failures} lexicon failures`);

// The rate-limit bypass uses the union of emergency and distress, never extra-dose.
assert.ok(isUrgentText("I have a pain in my chest") && isUrgentText("Soy una carga") && !isUrgentText("I'll take another one"));
assert.ok(!isUrgentText("") && !isUrgentText(undefined as unknown as string));
// A medicine that is not in the built-in list is recognised through the household's own list.
assert.ok(!isExtraDoseIntent("Can I have another Tamsulosin?"), "unknown name, no household list: not matched");
assert.ok(isExtraDoseIntent("Can I have another Tamsulosin?", ["Tamsulosin"]));
assert.ok(isExtraDoseIntent("Quiero otra tamsulosina", ["Tamsulosin"]));
assert.ok(!isExtraDoseIntent("Another prescription arrived", ["Tamsulosin"]));
// A household medicine matches up to a word boundary: no hit on a word that only starts like it ("pillow", "vitamin store").
assert.ok(!isExtraDoseIntent("Can I have another pillow?", ["Pill"]), "pillow is not Pill");
assert.ok(isExtraDoseIntent("Can I have another pill?", ["Pill"]) && isExtraDoseIntent("Dame otra Iron", ["Iron"]) && isExtraDoseIntent("another irons", ["Iron"]));
assert.ok(!isExtraDoseIntent("another ironing board", ["Iron"]) && !isExtraDoseIntent("otro zincado", ["Zinc"]));
assert.ok(!isExtraDoseIntent("Another vitamin shop opened", ["Vit"]) && !isExtraDoseIntent("another pillbox", ["Pill"]), "names under 4 letters are never matched on their own");
assert.ok(isExtraDoseIntent("Quiero otra metformina", []) && isExtraDoseIntent("another Losartán", []) && isExtraDoseIntent("otra tamsulosina", ["Tamsulosin"]));
assert.ok(isExtraDoseIntent("another vitamin D", ["Vitamin D"]), "a long name keeps the 6-letter stem with a short ending");

// Language guess for the canned sentences: bare "me"/"mi" prove nothing; unclear text takes the household's language.
const { speaksSpanish } = await import("../src/lang.ts");
for (const [text, hh, want] of [
  ["Tell me what is next", true, false],
  ["Tell me what is next", false, false],
  ["Give me my pills please", true, false],
  ["What did I take today?", true, false],
  ["Me tome la pastilla", false, true],
  ["¿Qué remedio me toca ahora?", false, true],
  ["ayuda por favor", false, true],
  ["me", true, true],
  ["me", false, false],
  ["mi", true, true],
  ["ok", false, false],
  ["", true, true],
  // accent-free speech-to-text Spanish about health and distress, with a household that is English
  ["me duele el pecho", false, true],
  ["siento mareo", false, true],
  ["estoy mareada", false, true],
  ["me cai en la cocina", false, true],
  ["me duele la cabeza", false, true],
  ["llama a mi hija", false, true],
  ["llama a mi hijo", false, true],
  ["me siento mal", false, true],
  ["me duele", false, true],
  ["siento", false, true],
  // English sentences stay English
  ["My head hurts and I feel dizzy", true, false],
  ["Call my daughter", true, false],
  ["I feel sick", true, false],
] as Array<[string, boolean, boolean]>) assert.equal(speaksSpanish(text, hh), want, `${text} (household es=${hh})`);

console.log("\nLEXICON CHECKS PASSED");
