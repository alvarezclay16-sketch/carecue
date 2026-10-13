// LLM-free check of the safety invariants: node tests/safety/invariants.test.ts
// Every fixture in fixtures.ts says which violation codes must be reported (positive and negative cases for G1-G8, G10).

import assert from "node:assert/strict";
import { CODES, claimsIn, firstAid, numberRegex, overlap, percentile, plain, runInvariants } from "./invariants.ts";
import { FIXTURES } from "./fixtures.ts";

let bad = 0;
const seen = new Set<string>();
for (const f of FIXTURES) {
  const got = [...new Set(runInvariants(f.t).map((v) => v.code))].sort();
  const want = [...f.expect].sort();
  got.forEach((c) => seen.add(c));
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`FAIL ${f.name}: expected [${want}] got [${got}]`);
    for (const v of runInvariants(f.t)) console.log(`   ${v.code} turn ${v.turn ?? "-"}: ${v.msg}`);
  }
}
assert.equal(bad, 0, `${bad} fixtures disagree`);

// every invariant is exercised by at least one negative fixture
for (const code of CODES) assert.ok(seen.has(code), `no fixture produces ${code}`);
// ...and by at least one clean one
for (const code of ["G1", "G2", "G3a", "G3b", "G4", "G5", "G6", "G7", "G8"])
  assert.ok(FIXTURES.some((f) => f.name.startsWith(code) && f.name.includes("clean") && f.expect.length === 0), `no clean fixture for ${code}`);

// helpers
assert.ok(numberRegex("131").test("llame al 1 3 1 ahora") && numberRegex("131").test("call 131") && numberRegex("131").test("llame al 1-3-1") && numberRegex("131").test("uno tres uno"));
assert.ok(!numberRegex("131").test("a las 11:31") && !numberRegex("131").test("call 1131") && !numberRegex("911").test("call 1 3 1"));
assert.equal(overlap("I'm a burden to everyone", 'Rosa said: "I\'m a burden to everyone". Please call'), 6);
assert.equal(overlap("nothing matters anymore", "Rosa seems sad"), 0);
assert.ok(firstAid("Please lie down and stay still").length === 2 && firstAid("Call 9 1 1 now. I sent Daniel a message.").length === 0);
assert.deepEqual(claimsIn("Yes, I sent Daniel the message.", { caregivers: ["Daniel"] }), []);
assert.ok(claimsIn("Daniel is on his way.", { caregivers: ["Daniel"] }).length === 1);
assert.equal(plain("Acuéstese’"), "acuestese'");
assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
assert.equal(percentile([], 50), 0);

console.log(`INVARIANT CHECKS PASSED (${FIXTURES.length} fixtures)`);
