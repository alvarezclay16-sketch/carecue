// Provider tests against running servers (live model calls, a few cents):
//   node tests/bedrock.ts <liveBase> [failoverBase]
//   liveBase:     a server started with CARECUE_PROVIDER=bedrock or auto (default env + the bearer token). Prints SKIP when it has no Bedrock.
//   failoverBase: a server started with CARECUE_PROVIDER=auto CARECUE_EVAL=1 CARECUE_FAKE_PRIMARY_FAIL=1 (primary throws a 429-like error).
import assert from "node:assert/strict";

const post = (base: string, path: string, body: unknown, token?: string) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const modelOf = (base: string) => fetch(base + "/api/model").then((r) => r.json());

type Turn = { reply: string; toolCalls: Array<{ name: string }>; ms: number; model: { provider: string; id: string }; degraded?: boolean };
async function household(base: string) {
  const h = await post(base, "/api/app/households", { patientName: "Provider Test", caregiverName: "Caro", language: "en" });
  assert.ok(h.token, "household created");
  return (text: string) => post(base, "/api/app/chat", { text }, h.token) as Promise<Turn>;
}

const [liveBase, failBase] = [process.argv[2], process.argv[3]];
assert.ok(liveBase, "usage: node tests/bedrock.ts <liveBase> [failoverBase]");

// ---------- live Bedrock ----------
const m0 = await modelOf(liveBase);
assert.equal(typeof m0.failover_count, "number");
assert.ok(!JSON.stringify(m0).match(/ABSK|Bearer|sk-ant/i), "/api/model carries no secrets");
if (m0.configured?.primary !== "Amazon Bedrock") {
  console.log(`SKIP live Bedrock: the server's primary is ${m0.configured?.primary} (no credentials)`);
} else {
  const say = await household(liveBase);
  const turns: Turn[] = [];
  for (const t of ["I took my pills", "What day is it today?", "Did I take my medicines today?"]) {
    const r = await say(t);
    assert.ok(r.reply && !r.degraded, `a real reply to "${t}": ${JSON.stringify(r).slice(0, 200)}`);
    turns.push(r);
    console.log(`  "${t}" -> "${r.reply}" (${r.ms} ms, ${r.model.provider}, tools: ${r.toolCalls.map((c) => c.name).join(",") || "none"})`);
  }
  for (const r of turns) assert.equal(r.model.provider, "Amazon Bedrock", "every turn answered by Bedrock");
  assert.ok(turns.some((r) => r.toolCalls.length > 0), "at least one turn used the CareCue tools");
  const m = await modelOf(liveBase);
  assert.equal(m.provider, "Amazon Bedrock");
  assert.equal(m.model, m0.configured.model);
  assert.ok(m.region, "region reported");
  assert.ok(m.last_receipt?.request_id && m.last_receipt.request_id.length > 8, "receipt carries the real x-amzn-requestid");
  assert.ok(m.last_receipt.latency_ms > 0 && m.last_receipt.at);
  assert.equal(m.failover_count, 0, "no failover on a healthy primary");
  console.log("ok: live Bedrock (provider, receipt, tools)");
}

// ---------- forced failover ----------
if (!failBase) console.log("SKIP failover: no second server given");
else {
  const f0 = await modelOf(failBase);
  assert.equal(f0.configured?.primary, "Amazon Bedrock");
  assert.ok(f0.configured?.fallback, "a fallback is configured");
  const say = await household(failBase);
  const turns: Turn[] = [];
  for (const t of ["I took my pills", "What day is it today?", "Hello again", "One more"]) {
    const r = await say(t);
    assert.ok(r.reply && !r.degraded, `fallback answered "${t}"`);
    assert.equal(r.model.provider, "Claude API (failover)");
    turns.push(r);
  }
  const f = await modelOf(failBase);
  assert.equal(f.provider, "Claude API (failover)");
  assert.equal(f.failover_count, f0.failover_count + 4, "one failover counted per turn");
  assert.ok(f.last_receipt?.request_id, "receipt from the fallback call");
  assert.equal(f.last_receipt.provider, "Claude API (failover)");
  assert.equal(f.breaker_open, true, "three failures in a row park the primary");
  console.log("ok: forced failover (fallback answered, count incremented, breaker open)");
}
console.log("bedrock tests passed");
