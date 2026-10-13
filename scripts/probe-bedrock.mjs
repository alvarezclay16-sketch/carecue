// Which Claude models can this Bedrock key call? Converse on bedrock-runtime, one tiny request per id, plus what the Bedrock
// control plane says about the same model (GetFoundationModelAvailability: the "agreement" column explains a 403).
// Run: node --env-file=.env scripts/probe-bedrock.mjs   (prints id / HTTP status / latency / agreement; never the key)
const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
const region = process.env.AWS_REGION ?? "us-east-1";
if (!token) {
  console.log("SKIP no AWS_BEARER_TOKEN_BEDROCK");
  process.exit(0);
}
const CANDIDATES = [
  "us.anthropic.claude-opus-4-6-v1",
  "us.anthropic.claude-opus-4-5-20251101-v1:0",
  "us.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "anthropic.claude-opus-5-5",
  "global.anthropic.claude-opus-4-8",
];
const pad = (s, n) => String(s).padEnd(n);
console.log(`region ${region}  endpoint bedrock-runtime.${region}.amazonaws.com  ${new Date().toISOString().slice(0, 10)}`);
console.log(pad("model id", 48) + pad("status", 8) + pad("latency", 10) + pad("agreement", 15) + "note");

// Same key, control plane (bedrock, not bedrock-runtime). The id has no us./global. prefix there.
async function agreement(id) {
  try {
    const r = await fetch(`https://bedrock.${region}.amazonaws.com/foundation-model-availability/${encodeURIComponent(id.replace(/^(us|eu|apac|global)\./, ""))}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return `HTTP ${r.status}`;
    return (await r.json()).agreementAvailability?.status ?? "?";
  } catch {
    return "ERR";
  }
}
for (const id of CANDIDATES) {
  const t = Date.now();
  let status = "ERR", note = "";
  try {
    const r = await fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(id)}/converse`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: [{ text: "Reply with the single word: ok" }] }], inferenceConfig: { maxTokens: 16 } }),
      signal: AbortSignal.timeout(20000),
    });
    status = r.status;
    const body = await r.json().catch(() => ({}));
    if (r.ok) note = `reply "${(body.output?.message?.content?.[0]?.text ?? "").trim().slice(0, 20)}"`;
    else note = String(body.message ?? body.error?.message ?? "").slice(0, 90);
  } catch (e) {
    note = (e.name === "TimeoutError" ? "timeout" : e.message).slice(0, 90);
  }
  console.log(pad(id, 48) + pad(status, 8) + pad(`${Date.now() - t} ms`, 10) + pad(await agreement(id), 15) + note);
}
