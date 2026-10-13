# CareCue

**A voice-first medication companion for older adults, built as an MCP server for Alexa+.**

Rosa is 78 and lives alone. CareCue is a [Model Context Protocol](https://modelcontextprotocol.io) server (spec **2025-11-25**, **Streamable HTTP**, 12 tools) that lets Alexa+, or any MCP host, run her medicine routine by voice: it says when a dose is due, writes down only what she says without doubt that she took, never confirms a second dose and tells her clearly not to take another one, and tells her son Daniel when something is wrong. The rules that keep her safe live in server code, not in a prompt: a hedged *"I think I took it"* is never logged, a double dose is refused, and only a family member's session can even see the tools that change her medicines. A committed 60-scenario adversarial suite measures all of it on the model that ships. CareCue is a reminder and a self-reported log, not a medical device.

> Track: **Alexa+** · Mini challenges: **AWS Builder** (Amazon Lightsail, Alexa Skills Kit, Amazon Bedrock as automatic failover) · **Open Source** (MIT)

---

## Try it in 60 seconds

**https://98-86-85-249.sslip.io** (open it in Chrome; no account, no microphone needed)

Every visitor gets a **private demo household** (Rosa and Daniel), so nobody else's clicks change yours. Press **Play Rosa's day** (six steps, three live model turns, about 40 seconds), or tap one of the five scenario chips: *Extra dose*, *Hedged answer*, *Missed dose to family*, *Chest pain*, *Spanish*. Each chip costs at most one model turn. Prefer typing? The box under the device works without a microphone. If the live model is resting (rate limit or spend guard), the page plays a recorded real run and says so on screen: **Replay of a real run**.

### What to look at

1. **The MCP wire tab** (right column, key `X`). Every tool call the device makes, as the server reports it, tagged `MODEL`, `TOUCH` (the *I took it* button, no model) or `PROBE` (a labelled direct call, no model), with the MCP annotations of each tool and the handshake (protocol 2025-11-25, tools by role from `GET /api/mcp-info`).
2. **Server-enforced roles.** A patient session sees **10 tools**, a caregiver session sees **12**; `add_medication` and `stop_medication` exist only for the caregiver, and a patient calling one directly gets **HTTP 403 `insufficient_scope`** before any tool runs. The *Remove a medicine* probe on the wire tab shows it, or run it yourself:
   ```bash
   curl -si -X POST https://98-86-85-249.sslip.io/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"stop_medication","arguments":{"medication":"Metformin"}}}'
   ```
3. **The safety scorecard.** [`docs/safety-scorecard.md`](docs/safety-scorecard.md) (also `GET /api/safety`): 60 scenarios, 35 in English and 25 in Spanish, every number generated from the committed run files. On the shipping model: **59/60 pass on the first try, 60/60 within two, 0 unsafe replies**. The failure rows are in the scorecard too.

### Connect any MCP client in 30 seconds

```bash
claude mcp add --transport http carecue https://98-86-85-249.sslip.io/mcp     # Claude Code
npx @modelcontextprotocol/inspector                                             # MCP Inspector: Streamable HTTP, same URL
```

No header means the **patient** role on a shared playground household that resets itself after 30 idle minutes. A caregiver token, example requests and responses captured from the real server, and what is and is not verified about Alexa+ are in [`docs/alexa-plus-integration.md`](docs/alexa-plus-integration.md).

---

## What it does

| Moment | What happens |
|---|---|
| **A dose is due** | The device speaks up: *"Rosa, it's time for your medicine: Losartan, 1 tablet, and Metformin, 1 tablet."* In the simulator the server pushes it to the page; on a real Echo the skill creates daily Alexa Reminders (the Reminders API, with her permission). |
| **"I took my pills."** | Logs every dose that is due, decrements the supply, confirms what comes next. |
| **"Did I take my Losartan?"** | Answers from the dose log, never from memory, with the time it was logged. |
| **"I think I took it, maybe."** | Nothing is written. It asks one yes-or-no question and, if she stays unsure, tells Daniel it is not in the log. |
| **"I'll take another one, just in case."** | The device does not confirm it: it says it can't tell her to take another, to check the bottles with Daniel or ask her pharmacist, and warns the family. When the log already shows the dose taken, it tells her clearly not to take another one, and `log_dose` refuses a second "taken" with `possible_double_dose`. |
| **Nobody answers** | A dose still open 30 minutes after its time counts as missed; after 45 minutes Daniel gets an alert in the family app (a phone push only if a webhook such as ntfy is configured, which the live demo does not do). A late confirmation resolves it. |
| **4 tablets left** | Refill alert to the family; *"I picked up 30 more"* adds them back. |
| **"I feel dizzy."** | Saves a check-in and messages the caregiver. Chest pain, trouble breathing, a fall, fainting, confusion or slurred speech: the emergency number (131 for Chilean households, 911 otherwise) said digit by digit, plus an urgent alert. |
| **"How is Mom doing?"** (caregiver) | One-shot briefing: today's doses, 7-day adherence, refills, open alerts, how she said she felt. |
| **Spanish** | Answers in the language she speaks; the simulator has an EN / ES (Chile) switch. |

**What it never does:** decide anything medical. CareCue only follows the schedule on the prescription. Dosing or side-effect questions get *"please ask your doctor or pharmacist."*

## Architecture

```
   Echo + Alexa skill ───────────────── /alexa      ASK SDK v2, Reminders API ──┐
   Simulated Alexa+ in web/ (browser) ─ /api/*      Web Speech API ─────────────┤
   Any MCP host (Alexa+ in principle) ─ /mcp        Streamable HTTP, 2025-11-25 ┤
   Daniel's Android / web family app ── /api/app/*                              │
                                                                                ▼
                                   ┌───────────────────────────────────────────────┐
                                   │ CareCue server (Node, one process)            │
                                   │   12 tools · 1 resource · 1 prompt            │
                                   │   scheduler: remind → missed → family alert   │
                                   │   SQLite (node:sqlite)                        │
                                   └───────────────────────┬───────────────────────┘
                     built-in voice agent (src/agent.ts), an MCP client of /mcp
                                   ├─ primary   Claude API      claude-opus-5-5
                                   └─ failover  Amazon Bedrock  us.anthropic.claude-opus-4-6-v1
                                                (bedrock-runtime InvokeModel)
```

- `src/mcp.ts`: the MCP server: tools with titles and annotations, resource, prompt, server instructions (the safety rules for the model), roles and the 403.
- `src/care.ts`: the domain logic: schedule, dose log, double-dose guard, adherence, refill forecast, escalation. Both front doors (MCP and Alexa) call it.
- `src/agent.ts`: the simulated Alexa+ brain and its two model providers (below). `src/scene.ts` and `src/trace.ts`: what the device screen and the wire tab show, computed from tool results.
- `src/alexa.ts`: the Alexa custom skill. `src/limits.ts`, `src/sandbox.ts`: spend guard and private demo households.
- `web/`: the simulated Echo Show (giant type, EN/ES, Day/Night) and Daniel's phone. `mobile/`: the Android app. `tests/safety/`: the adversarial suite.

### The MCP server

- **Spec 2025-11-25, Streamable HTTP, stateless** (a fresh server per request, so it scales horizontally). MCP TypeScript SDK 1.32.1.
- **12 tools**, each with a title and annotations (read-only, destructive, idempotent, open-world): `get_today_schedule`, `log_dose`, `check_what_i_took`, `list_medications`, `get_refill_status`, `record_refill`, `notify_caregiver`, `record_checkin`, `get_adherence`, `caregiver_briefing`, and the caregiver-only `add_medication` and `stop_medication`. Resource `carecue://schedule/today`, prompt `morning_checkin`.
- **Roles 10/12**: patient and anonymous sessions list 10 tools, a caregiver token lists 12. A direct call to a hidden tool gets **403 `insufficient_scope`** with `WWW-Authenticate: Bearer error="insufficient_scope", scope="care:admin"`. Browser requests from other origins get 403.
- **Server instructions** (about 13,000 characters, byte-frozen and hash-checked) travel in the `initialize` result, so a host other than ours receives the safety rules too. The household facts a generic host lacks (emergency number, crisis line, family first names) come back in the `household` object of `get_today_schedule` and `notify_caregiver`.
- Tokens: household-scoped app tokens (stored as SHA-256 hashes), an internal HMAC token for the built-in agent, an optional shared `CARECUE_MCP_TOKEN`. No OAuth.

### The model behind the voice agent

**Claude on the Claude API (`claude-opus-5-5`) with automatic failover to Claude Opus 4.6 on Amazon Bedrock, both measured by the same 60-scenario safety suite.** The failover is `bedrock-runtime` InvokeModel through `AnthropicBedrock`. When the Claude API times out (12 s), is rate limited or errors, the same turn goes to Bedrock; three failures in a row park the primary for 60 s. `GET /api/model` shows which provider answered, the failover count and the last request id.

We do **not** say CareCue runs on Bedrock: on our account the Claude 5.x models return 403 on Bedrock, and no Bedrock model met the stand-alone shipping rule in the scorecard. Measured, agent mode, 60 scenarios (pass@1 / pass@2 / unsafe replies):

| Configuration | pass@1 | pass@2 | Unsafe |
|---|---|---|---|
| Claude Opus 5.5, Claude API (primary) | 59/60 | 60/60 | 0 |
| Claude API failing every second call, continued by Bedrock Opus 4.6 (the shipping failover) | 58/60 | 60/60 | 0 |
| Claude Opus 4.6 on Bedrock alone | 56/60 | 59/60 | 0 |
| Claude Sonnet 4.5 on Bedrock alone | 55/60 | 59/60 | 1 |
| Claude Haiku 4.5 on Bedrock alone | 51/60 | 57/60 | 1 |

When Bedrock answers, a short addendum (`BEDROCK_ADDENDUM`, hash-pinned) follows the system prompt; the Claude API never sees it. Details: [`docs/aws-integration.md`](docs/aws-integration.md).

## Safety by design

- **Code that cannot be talked out of it:** `log_dose` writes nothing unless `person_was_certain` is true, refuses a second "taken" for a dose already taken and refuses doses more than 60 minutes early; the schedule alerts the family about an open dose without the model; medicine changes are caregiver-only on the server (above).
- **Instructions every client receives** (`SERVER_INSTRUCTIONS`): check the log before answering, never advise on doses, the emergency script (local number digit by digit, urgent alert), the distress script (a direct safety question, the crisis line *4141 in Chile, 988 elsewhere), never claim the family "knows".
- **A committed adversarial suite** (`npm run safety`): 60 scenarios, 14 hazards, agent mode and a bare-client mode that gives the model only what a generic MCP host would, with 10 invariants and honest reporting (a failure is rerun once; pass@1, pass@2 and open failures are all reported). On the shipping model in bare mode no hard invariant was violated in 60 scenarios, and the emergency number was spoken in 115 of 120 first replies when the 10 emergency scenarios were repeated (95.8%, 95% interval 90.6 to 98.2): the scorecard says what that does and does not support.
- Hazards, mitigations, residual risks and the intended-use statement: [`docs/safety-case.md`](docs/safety-case.md). Results: [`docs/safety-scorecard.md`](docs/safety-scorecard.md). The suite checks behavior on the scenarios it contains; it is not clinical validation.

## AWS

Amazon Bedrock (`bedrock-runtime` InvokeModel, Claude Opus 4.6, the automatic failover), Amazon Lightsail (hosting), Alexa Skills Kit (SMAPI, the skill endpoint, the Reminders API). A table with where each is in the code, its credential type, cost and how to verify it, a diagram and the measured results are in [`docs/aws-integration.md`](docs/aws-integration.md). Not used: Polly, Lambda, SNS/SES, push notifications.

## Works on any Alexa, and on Android

The same household data powers three front doors:

1. **Alexa+ (MCP)**: `/mcp`, the hackathon track. We had no Alexa+ device or preview, so this path is exercised with generic MCP clients and the simulated Alexa+ in `web/`, not with a real Alexa+. See [`docs/alexa-plus-integration.md`](docs/alexa-plus-integration.md).
2. **Alexa custom skill**: `/alexa`, for any Echo. Checked with real Alexa Skills Kit simulations against the live endpoint (development stage). English (*"Alexa, open Care Cue"*) and Spanish (*"Alexa, abre mi pastillero"*): logs doses by voice, guards double doses, answers "did I take it?", tracks refills, and asks permission to create **daily Alexa reminders** at each medicine time (Reminders API; implemented, not yet observed on a physical Echo). Interaction models for en-US, es-US, es-MX and es-ES are in `skill-package/`.
3. **CareCue mobile app (Android)**: `mobile/`, a Capacitor 8 app (also served as a web app at `/app`):
   - **Senior mode:** large clock, the next medicine in big type, one huge *"I took it"* button with a full-screen confirmation read aloud, *"I don't feel well"*, *"I need help"* and *"Call Daniel"* buttons, adjustable text size, daily local notifications. Typeface: Atkinson Hyperlegible, built for low-vision readers.
   - **Family mode:** today at a glance, 7-day adherence, refill warnings, alerts with "mark as seen", add and remove medicines, and **4-digit codes** to connect the home's Alexa or the senior's phone.

Connecting Alexa takes one sentence: the family app shows a code, and the senior says *"Alexa, my code is 4 8 2 1"*.

## Run it locally

Requires **Node 22.13+** (built-in `node:sqlite` and native TypeScript; we develop on Node 26 and run Node 24 on the server).

```bash
npm install
cp .env.example .env      # add a Claude API key and/or a Bedrock key; every variable is documented in the file
npm start                 # http://localhost:8787  (simulator at /, family web app at /app, MCP at /mcp)
```

- **MCP endpoint:** `http://localhost:8787/mcp`. Set `CARECUE_MCP_TOKEN` to require a bearer token.
- **Simulator:** open `http://localhost:8787` in Chrome. Press the mic (or space bar) and talk, or use *Play Rosa's day* and the chips. On a local server with `CARECUE_CLOCK_CONTROL=1` the **demo clock** buttons move time to 8:01 AM, 8:50 PM and so on.
- **Shipping configuration** (the public demo): `CARECUE_PROVIDER=anthropic-first`, `CARECUE_ANTHROPIC_MODEL=claude-opus-5-5`, `CARECUE_MODEL=us.anthropic.claude-opus-4-6-v1`, both keys set, `CARECUE_PUBLIC=1`. `npm run probe:bedrock` prints which Bedrock models your key can call.
- **Real push alerts:** `CARECUE_ALERT_WEBHOOK=https://ntfy.sh/<your-private-topic>` posts every alert to that topic. It is not configured on the live demo.

### Tests

`npm test` runs the lexicon, tool-trace, wire, i18n, scene, contrast and sandbox checks, the safety-suite unit checks (no model), and then an end-to-end check of the MCP server, which needs a **local server started like this** in another terminal:

```bash
CARECUE_CLOCK_CONTROL=1 ALEXA_SKIP_VERIFY=1 CARECUE_FAKE_AGENT=1 CARECUE_DB=/tmp/carecue-test.db npm start
```

Also: `node tests/alexa.ts <url>` (the Alexa endpoint, same server), `sh scripts/test-limits.sh <port>` and `node tests/demo-guard.ts <port> <port>` (start their own servers, no model), `npm run safety` (starts its own server, calls the model in your `.env`, costs a few US dollars per full pass and writes `docs/safety-scorecard.md` and `docs/safety-results.json`; `--cell opus-5-5`, `--mode bare`, `--tag core20`, `--dry`), `npm run safety:matrix` (every model of the matrix) and `node tests/bedrock.ts <url> [<failover-url>]` (live provider checks against running servers, a few cents).

### Operating a public instance

- **Spend guard:** `CARECUE_PUBLIC=1` turns on `src/limits.ts` for every route that can reach a model (`/api/chat`, `/api/app/chat`), for household creation and for `/mcp` (120 requests a minute per address). Over a limit the chat answers `limited: true` with a canned sentence and no model call; emergency text still gets through. Defaults: 40 turns a day and 8 per 5 minutes per address, 500 a day in total. Tune with `CARECUE_LIMIT_*`, stop all model traffic with `CARECUE_AGENT_PAUSED=1` or a `data/PAUSE` file, see your own remaining turns at `GET /api/limits`.
- **Private demo per visitor:** `POST /api/sandbox` creates a sandbox household (Rosa and Daniel, sample history labelled "Sample history (demo)"); the browser sends its id in the `x-carecue-sandbox` header. Idle sandboxes are deleted after `CARECUE_SANDBOX_TTL_S` (default 2 h); an unknown id answers 404 `sandbox_expired`. Sandbox alerts are never delivered outside the server. A public instance never moves the clock: `POST /api/clock` and `POST /api/reset` need `CARECUE_CLOCK_CONTROL=1`, and the server refuses to boot with that together with `CARECUE_PUBLIC=1` (the same goes for `CARECUE_EVAL=1`).

### Deploy

The demo runs on a single Amazon Lightsail instance: Node 24 under systemd, with Caddy in front for automatic HTTPS on a `sslip.io` name.

```
# Caddyfile
98-86-85-249.sslip.io {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
```

```
# carecue.service (systemd unit)
[Service]
User=ubuntu
WorkingDirectory=/opt/carecue
EnvironmentFile=/opt/carecue/.env
ExecStart=/usr/bin/node src/server.ts
Restart=always
```

Run the server with `HOST=127.0.0.1` so nothing reaches it around the proxy; the Alexa endpoint verifies Amazon's request signatures (set `ALEXA_SKILL_ID` to pin the skill).

**Reverse proxy and `X-Forwarded-For`:** the spend guard and the sandbox limits key on the client address. The proxy MUST set `X-Forwarded-For` to the real client address; the server trusts only the **last** entry of that header, and only when the TCP peer is the loopback address. Without it every visitor looks like one address and one person can use up everyone's limit. Caddy's `reverse_proxy` sets it by default; with nginx add `proxy_set_header X-Forwarded-For $remote_addr;`.

The Android app is built to talk to the public URL above, so it needs that instance running.

## Privacy

CareCue stores only what a family enters: first names, medicine names, doses, times and the dose log. App and Alexa links are stored as SHA-256 hashes. No data is sold. Delete a household and everything about it is deleted. Each voice turn is sent to the model provider (the Claude API, or Amazon Bedrock on failover) together with the household's names, medicine list and today's doses; the chat itself is not written to the database (it lives in server memory, and a conversation restarts after 20 idle minutes), but what the tools record is: dose notes, check-ins and alerts that quote her words. Alerts are also printed to the server log. The public demo uses made-up data in private sandbox households, so please do not type real health information into it.

## Documentation

[`docs/aws-integration.md`](docs/aws-integration.md) · [`docs/alexa-plus-integration.md`](docs/alexa-plus-integration.md) · [`docs/safety-scorecard.md`](docs/safety-scorecard.md) · [`docs/safety-case.md`](docs/safety-case.md) · [`docs/friction-log.md`](docs/friction-log.md) · [`docs/submission.md`](docs/submission.md)

## Built with

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) 1.32.1 (protocol 2025-11-25, Streamable HTTP)
- Claude via `@anthropic-ai/sdk` 0.133 (Claude API) and `@anthropic-ai/bedrock-sdk` 0.34.4 (Amazon Bedrock)
- ASK SDK v2 (`ask-sdk-core` 2.14), Express 5, Node `node:sqlite`, Web Speech API, Capacitor 8

## License

MIT
