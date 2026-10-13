# AWS in CareCue

What CareCue really runs on AWS, where it is in the code, what credential it needs, what it costs and how to check each claim yourself. Everything here was checked against the code and against live calls on 13 October 2026. Where something could not be checked, it says so.

## The short version

- **Amazon Bedrock** is the automatic **failover** of the voice agent: Claude Opus 4.6 through `bedrock-runtime` InvokeModel. It is not the primary. The primary is Claude on the Claude API (`claude-opus-5-5`).
- **Amazon Lightsail** hosts the whole server.
- **Alexa Skills Kit** (SMAPI, the skill endpoint and the Reminders API) is the Echo front door.
- Not used, and never claimed: Amazon Polly, Lambda, SNS/SES, Strands, Cedar, push notifications. (CareCue can post alerts to a webhook such as ntfy, but none is configured on the live demo.)

The sentence to use about the model: **Claude on the Claude API with automatic failover to Claude Opus 4.6 on Amazon Bedrock, both measured by the same 60-scenario safety suite.** Do not say "runs on Bedrock": no Bedrock model met the stand-alone shipping rule (see below).

## Diagram

```
  Rosa's Echo ─ Alexa Skills Kit ─┐      (custom skill, Reminders API, SMAPI to build and test it)
  Simulated Alexa+ (web/) ────────┤
  Any MCP client ─────────────────┼──▶ HTTPS
  Android / family app ───────────┘        │
                                           ▼
        ┌─────────────────── Amazon Lightsail: one small instance with a static IP ───────────────────┐
        │  Caddy (automatic HTTPS, sslip.io name)  ──▶  node src/server.ts on 127.0.0.1:8787            │
        │     /alexa   ASK SDK v2: signature check, four locales, Reminders API client                  │
        │     /mcp     MCP server, Streamable HTTP, spec 2025-11-25                                     │
        │     /api/*   web simulator, family app, /api/model, /api/safety, /api/mcp-info                │
        │                                                                                               │
        │  voice agent (src/agent.ts), an MCP client of this server's own /mcp                          │
        └──────────────┬───────────────────────────────────────────────┬────────────────────────────────┘
                       │ primary                                       │ failover
                       ▼                                               ▼
              Claude API                                      Amazon Bedrock (bedrock-runtime, us-east-1)
              claude-opus-5-5                                 InvokeModel  us.anthropic.claude-opus-4-6-v1
```

## Services actually used

| Service | What it does for CareCue | Where in the code | Permission / credential | Cost | How to verify |
|---|---|---|---|---|---|
| **Amazon Bedrock** `bedrock-runtime` **InvokeModel**, Claude Opus 4.6 (`us.anthropic.claude-opus-4-6-v1`, region us-east-1) | Automatic failover for the voice agent: when the Claude API cannot answer a turn (timeout, 429, 5xx, 401/403/404, connection error) the same turn is sent to Opus 4.6 on Bedrock, with the history copied without thinking blocks | `src/agent.ts`: `clientFor` (builds `new AnthropicBedrock({ awsRegion })`, which posts to `/model/{id}/invoke`), `callOne` (plain `messages.create`, request id read from `x-amzn-requestid`), `callModel` (primary, failover, circuit breaker), `providerDown`, `stripThinking`, `promptFor` + `BEDROCK_ADDENDUM`, `modelStatus` (feeds `GET /api/model`). Also `scripts/probe-bedrock.mjs` and `tests/bedrock.ts` | A Bedrock API key (long-term bearer token, `AWS_BEARER_TOKEN_BEDROCK`) or IAM credentials. The call needs `bedrock:InvokeModel` on the inference profile; we did not narrow the key's policy, and the key we use can also call the control-plane read operations (`ListFoundationModels`, `GetFoundationModelAvailability`). The key is in the server's `.env`, never in the repo | On-demand Bedrock token pricing (see the Bedrock pricing page; no figure is quoted here). The number of model calls a day is capped by the spend guard (`src/limits.ts`: 500 chat turns a day in total by default, 40 per visitor address). A full 60-scenario safety pass costs a few US dollars | `GET /api/model` shows `configured.fallback` and `failover_count`; after a failover turn `last_receipt` holds the Bedrock request id. `npm run probe:bedrock` prints which models your key can call. `node tests/bedrock.ts <url> <failover-url>` runs real turns through each provider. The measured results are in `docs/safety-scorecard.md` (rows "Amazon Bedrock" and "failover") |
| **Amazon Lightsail** | Hosts everything: Node 24 running `node src/server.ts` under systemd, Caddy in front for automatic HTTPS on a `sslip.io` name (no domain needed), SQLite on the instance's disk | No application code. The deploy shape is in the README ("Deploy"). The proxy must set `X-Forwarded-For` (`clientIp` in `src/limits.ts`) | An AWS account that can create a Lightsail instance, a static IP and open ports 80 and 443. The server holds no AWS credential for Lightsail itself | A fixed monthly bundle price for the smallest instance (the current figure is on the Lightsail pricing page and was not re-checked for this document) | `curl https://98-86-85-249.sslip.io/health` answers `{"ok":true,...}`; `GET /api/model` and `GET /api/mcp-info` show the running build |
| **Alexa Skills Kit**: SMAPI + ASK CLI, the custom-skill endpoint, the **Reminders API** | Echo front door: the skill logs doses by voice, guards double doses, answers "did I take it?", tracks refills and creates one daily Alexa reminder per medicine time. Four interaction models (en-US, es-US, es-MX, es-ES) | `src/alexa.ts`: `alexaHandlers` (ASK SDK v2.14 express adapter, signature and timestamp verification on unless `ALEXA_SKIP_VERIFY=1`), `askForReminders` (permission consent card, scope `alexa::alerts:reminders:skill:readwrite`), `syncReminders` (`getReminderManagementServiceClient().createReminder` / `deleteReminder`, `getUpsServiceClient().getSystemTimeZone`). `skill-package/skill.json` (manifest, endpoint, permission) and `skill-package/interactionModels/custom/*.json` | Developer side: the ASK CLI profile (Login with Amazon) that created and updates the skill. Runtime: the `apiAccessToken` and consent token Alexa sends in each request; nothing is stored except hashed account links. Optional `ALEXA_SKILL_ID` pins the skill | No AWS resource is created for the skill (the endpoint is our own HTTPS server, not Lambda), so nothing is billed on the AWS side for it | `ask smapi simulate-skill --skill-id <id> --stage development --input-content "ask care cue what's next" --device-locale en-US` then `ask smapi get-skill-simulation` (results below). `node tests/alexa.ts <url>` drives the endpoint with fake requests: linking by code, a dose, the double-dose answer, "did I take it", refills, a feeling check-in, in Spanish and English (needs a local server with `ALEXA_SKIP_VERIFY=1` and `CARECUE_CLOCK_CONTROL=1`) |

### Verified on 13 October 2026

- `npm run probe:bedrock` (output kept in `docs/bedrock-probe.txt`): the five Claude 4.x ids below answer 200 with the shipping key; `anthropic.claude-opus-5-5` and `global.anthropic.claude-opus-4-8` answer 403.
- A real SMAPI simulation against the live skill endpoint (development stage): the utterance "ask care cue what's next" came back as an `IntentRequest` answered with *"Your next medicine is Losartan and Metformin at 8 AM. Anything else?"*. On 12 October the same method was run for four English and Spanish utterances (what's next, did I take my Losartan, I feel dizzy, and the Spanish "qué me toca ahora"); all four were `SUCCESSFUL`.
- `ask smapi get-skill-status`: manifest and the four interaction models (en-US, es-US, es-MX, es-ES) built with every step `SUCCEEDED`; the manifest holds the `alexa::alerts:reminders:skill:readwrite` permission and the endpoint `https://98-86-85-249.sslip.io/alexa`. The skill is used in the development stage only.
- The Reminders API path (`askForReminders`, `syncReminders`) is implemented as described above, but `tests/alexa.ts` does not exercise it (it needs Alexa's consent token and service). **A reminder created on a physical Echo was not observed** for this document.

## Amazon Bedrock in detail

### Which models can this key call

`docs/bedrock-probe.txt`, produced by `scripts/probe-bedrock.mjs` (one tiny `converse` request per id, plus `GetFoundationModelAvailability` for the same model):

| Model id | HTTP status | Agreement (control plane) |
|---|---|---|
| `us.anthropic.claude-opus-4-6-v1` | 200 | AVAILABLE |
| `us.anthropic.claude-opus-4-5-20251101-v1:0` | 200 | AVAILABLE |
| `us.anthropic.claude-sonnet-4-6` | 200 | AVAILABLE |
| `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | 200 | AVAILABLE |
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` | 200 | AVAILABLE |
| `anthropic.claude-opus-5-5` | **403** `not available for this account` | NOT_AVAILABLE |
| `global.anthropic.claude-opus-4-8` | **403** | NOT_AVAILABLE |

Honest note: **the Claude 5.x models (and Opus 4.8) return 403 on Amazon Bedrock for this account.** The 403 is per model, not per account: the same key, the same endpoint and the same client library answer 200 for the 4.x family. `anthropic.claude-sonnet-5-5` also answers 403 (checked on 13 October). That is why Bedrock is the failover and not the primary: the model chosen as primary is measured to be the best one, and it is not available on Bedrock for us.

### What was measured

All from `docs/safety-scorecard.md` / `docs/safety-results.json` (also served at `GET /api/safety`): 60 scenarios (35 English, 25 Spanish) against the real agent, the real MCP server and a real database, agent mode.

| Configuration | pass@1 | pass@2 | Unsafe replies | p50 | p95 |
|---|---|---|---|---|---|
| Claude Opus 5.5, Claude API (shipping primary) | 59/60 | 60/60 | 0 | 3.2 s | 7.2 s |
| Claude Opus 4.6, Amazon Bedrock, alone | 56/60 | 59/60 | 0 | 3.9 s | 6.1 s |
| Claude Sonnet 4.5, Amazon Bedrock, alone | 55/60 | 59/60 | 1 | 4.3 s | 6.7 s |
| Claude Haiku 4.5, Amazon Bedrock, alone | 51/60 | 57/60 | 1 | 1.9 s | 4.0 s |
| **Claude API, failing every second model call, continued by Bedrock Opus 4.6 (the shipping failover)** | **58/60** | **60/60** | **0** | 3.5 s | 6.4 s |

In that failover run 28 turns were answered by Bedrock and 50 by the Claude API, so single conversations, and even single turns, crossed providers.

The shipping rule for a Bedrock model on its own was: pass@2 100%, zero unsafe replies, pass@1 within 2 scenarios of the baseline, p50 at most 4.5 s and p95 at most 9 s, in every recorded run with the Bedrock-only addendum. **No Bedrock model met it** (Opus 4.6: pass@2 59/60 and pass@1 gap of 3). That is the reason Bedrock is not the primary, and why the failover claim is worded as above.

The Bedrock-only addendum (`BEDROCK_ADDENDUM`, sha256 `9715467211ea…`, hash-pinned in `tests/frozen.json`) is appended to the system prompt only when Bedrock answers; `SERVER_INSTRUCTIONS` and `SYSTEM` are unchanged and the Claude API never sees it. The addendum was written after reading the failures of these same 60 scenarios, so its "after" numbers are in-sample (the scorecard says this too).

### Failover behaviour (src/agent.ts)

Primary: 12 s timeout, one retry. When it cannot answer, the same turn goes to the other provider (60 s timeout, two retries). After 3 failures in a row the primary is skipped for 60 s. A turn that crossed over is labelled "Amazon Bedrock (failover)" in `/api/model` and in the wire tab, and `failover_count` goes up once per turn. In evaluation only (`CARECUE_EVAL=1`), `CARECUE_FAKE_PRIMARY_FAIL=1` or `alt` makes the primary fail so this path can be measured.

### Limits we hit (details in `docs/friction-log.md`)

- **Throttling.** Twenty-four concurrent tiny InvokeModel requests to Opus 4.6 gave 5 x 200 and 19 x 429 ("Too many requests, please wait before trying again."); to Sonnet 4.5, 10 x 200 and 14 x 429 (13 October). In the safety runs every Bedrock-only 60-scenario run at concurrency 2 needed 38 to 67 infrastructure retries, where a reason was kept it reads "degraded answer (model unavailable)" (26 in the failover run), against none for the Claude API; the runner treats them as throttling, but the HTTP status is not stored in the run files. As a failover this is acceptable for one household; it is not a place to send a burst.
- **Ids.** Bare ids such as `anthropic.claude-opus-4-6-v1` answer 400 (on-demand throughput not supported); the `us.` and `global.` inference-profile ids work.

## Honest limits of this page

- Nothing in this repository has been run against a real Alexa+ device (see `docs/alexa-plus-integration.md`).
- The Lightsail price and the exact IAM policy of the Bedrock key were not looked up for this document.
- Polly was considered for video narration and is not used anywhere.
