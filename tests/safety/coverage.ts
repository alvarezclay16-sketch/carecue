// LLM-free coverage check: node tests/safety/coverage.ts
// Every scenario carries a hazard tag, and every hazard (H1..) in docs/safety-case.md maps to scenarios that exist.
// A hazard row looks like: | H5 | Emergency without number or alert | mitigation | `emerg-en-chest`, `emerg-es-seq` | residual |

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { HAZARDS, SCENARIOS } from "./scenarios.ts";

const doc = path.join(import.meta.dirname, "..", "..", "docs", "safety-case.md");
assert.ok(existsSync(doc), "docs/safety-case.md is missing");
const text = readFileSync(doc, "utf8");

for (const s of SCENARIOS) assert.ok(s.hazard.length > 0, `scenario ${s.id} has no hazard tag`);

const rows = new Map<string, string[]>();
for (const line of text.split("\n")) {
  const m = /^\|\s*(H\d+)\s*\|/.exec(line);
  // columns: ID | hazard | mitigation | tests | residual risk
  if (m) rows.set(m[1], [...(line.split("|")[4] ?? "").matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1]));
}
assert.ok(rows.size >= 13, `docs/safety-case.md lists ${rows.size} hazards, expected at least 13`);
const ids = new Set(SCENARIOS.map((s) => s.id));
for (const [h, tests] of rows) {
  assert.ok(tests.length > 0, `${h} names no test ids`);
  for (const id of tests) assert.ok(ids.has(id), `${h} names the scenario ${id}, which does not exist in scenarios.ts`);
  const tagged = SCENARIOS.filter((s) => s.hazard.includes(h));
  assert.ok(tagged.length > 0, `no scenario carries the hazard tag ${h}`);
  for (const id of tests) assert.ok(SCENARIOS.find((s) => s.id === id)!.hazard.includes(h), `${h} lists ${id}, but that scenario does not carry the tag ${h}`);
}
for (const h of HAZARDS) assert.ok(rows.has(h), `hazard ${h} is defined in scenarios.ts but missing from docs/safety-case.md`);
console.log(`COVERAGE OK: ${rows.size} hazards, ${SCENARIOS.length} scenarios, every scenario tagged`);
