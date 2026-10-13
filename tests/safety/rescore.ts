// Re-judges the stored transcripts with the current checks: node tests/safety/rescore.ts [--check]
//
// For when an invariant or an assertion had a bug (a false positive found by reading transcripts): the same transcripts,
// the corrected checker. It never contacts a model. Scenario ids are matched in scenarios.ts; an attempt that has no
// `before` snapshot is left alone. If a corrected check is STRICTER and an attempt that passed now fails with no retry on
// record, the file needs a new run: rescore says so and exits 1 (--check does the same without writing anything).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { judge } from "./judge.ts";
import { generateReports, summarize, type RunFile } from "./report.ts";
import { SCENARIOS } from "./scenarios.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const dirs = [path.join(ROOT, "docs", "safety-runs"), path.join(ROOT, "docs", "safety-runs", "repeats")];
const checkOnly = process.argv.includes("--check");
let changed = 0;
let stale = 0;
for (const dir of dirs) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const file = path.join(dir, f);
    const run = JSON.parse(readFileSync(file, "utf8")) as RunFile;
    let touched = false;
    for (const r of run.scenarios) {
      const sc = SCENARIOS.find((s) => s.id === r.id);
      if (!sc) continue;
      for (const a of r.attempts) {
        if (a.infra || !a.before || !a.after) continue;
        const v = judge(sc, run.mode, a.turns, a.before, a.after);
        if (JSON.stringify(v) !== JSON.stringify({ pass: a.pass, failures: a.failures, violations: a.violations })) {
          touched = true;
          Object.assign(a, v);
        }
      }
      const pass1 = r.attempts[0].pass;
      const pass2 = r.attempts.some((a) => a.pass);
      // a stricter check can fail an attempt that had no retry
      if (!pass1 && r.attempts.length < run.attempts_max && !r.infra_failure) {
        stale++;
        console.log(`NEEDS A NEW RUN: ${path.relative(ROOT, file)} ${r.id} now fails its only attempt`);
      }
      if (pass1 !== r.pass1 || pass2 !== r.pass2) touched = true;
      r.pass1 = pass1;
      r.pass2 = pass2;
    }
    if (touched) {
      changed++;
      run.summary = summarize(run);
      console.log(`${checkOnly ? "would update" : "updated"} ${path.relative(ROOT, file)}: pass@1 ${run.summary.pass1}/${run.summary.n}, pass@2 ${run.summary.pass2}/${run.summary.n}, unsafe ${run.summary.unsafe.total}`);
      if (!checkOnly) writeFileSync(file, JSON.stringify(run, null, 1));
    }
  }
}
if (!checkOnly && changed) generateReports();
console.log(changed ? `${changed} run file(s) ${checkOnly ? "differ" : "re-judged"}` : "all stored runs agree with the current checks");
process.exit(stale ? 1 : checkOnly && changed ? 1 : 0);
