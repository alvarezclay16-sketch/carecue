# CareCue

**A voice-first medication companion for older adults, built as an MCP server for Alexa+.**

Grandma doesn't need another app. She needs someone in the kitchen who says *"Rosa, it's time for your Metformin"*, remembers whether she already took it, stops her from taking it twice, and quietly tells her son when a dose goes missing.

CareCue is that someone. It is a self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server (spec **2025-11-25**, **Streamable HTTP**) that gives Alexa+ the tools to run a household's medication routine by voice, plus a caregiver view for the family.

> Track: **Alexa+** · Mini challenges: **AWS Builder** (Claude on Amazon Bedrock, Amazon Lightsail) · **Open Source** (MIT)

---

## Why

Roughly half of people with chronic conditions don't take their medicines as prescribed (WHO, *Adherence to Long-Term Therapies*, 2003). For older adults living alone the two most common failures are simple and dangerous: **forgetting a dose** and **taking it twice** because they don't remember taking it the first time. Pill boxes don't talk, phone apps need a phone in hand, and family members can't call every morning.

A voice assistant that is already in the kitchen is the most natural place for this to live.

## What it does

| Moment | What happens |
|---|---|
| **8:00 AM** | Alexa+ speaks up on its own: *"Rosa, it's time for your medicine: Losartan, 50 mg… Metformin, 850 mg, with breakfast."* |
| **"I took my pills."** | Logs every dose that is due, decrements the supply, confirms what comes next. |
| **"Did I take my Losartan?"** | Answers from the dose log, never from memory, with the exact time it was logged. |
| **"I'll take another one just in case."** | **Double-dose guard:** refuses to log it and tells her clearly not to take another. |
| **Nobody answers by 8:45 PM** | Dose marked missed; Daniel (her son) gets a push alert: *"Rosa hasn't confirmed the 8 PM Metformin."* |
| **Late confirmation** | Logs it as late and resolves Daniel's alert automatically. |
| **4 tablets left** | Refill alert to the family, and *"I picked up 30 more"* adds them back. |
| **"I feel dizzy."** | Saves a check-in and messages the caregiver; anything that sounds like an emergency → *call emergency services now* + urgent alert. |
| **"How is Mom doing?"** (caregiver) | One-shot briefing: today's doses, 7-day adherence, refills, open alerts, how she said she felt. |
| **Spanish** | Answers in the language the person speaks; the simulator has an EN / ES (Chile) switch. |

**What it never does:** decide anything medical. CareCue only follows the schedule on the prescription. Dosing or side-effect questions → *"please ask your doctor or pharmacist."*

## Architecture

```
   ┌────────────────────┐   voice    ┌─────────────────────────┐   MCP (Streamable HTTP,   ┌──────────────────────────────┐
   │  Rosa, in her      │ ─────────▶ │  Alexa+                 │   spec 2025-11-25)        │  CareCue MCP server          │
   │  kitchen           │ ◀───────── │  (or the simulator:     │ ────────────────────────▶ │  12 tools · 1 resource ·     │
   └────────────────────┘   speech   │  Claude on Bedrock +    │ ◀──────────────────────── │  1 prompt                    │
                                     │  Web Speech API)        │                           │                              │
                                     └─────────────────────────┘                           │  scheduler: remind → missed  │
                                                                                           │  → escalate → refill alerts  │
   ┌────────────────────┐   push (ntfy / webhook)                                          │                              │
   │  Daniel's phone    │ ◀──────────────────────────────────────────────────────────────── │  SQLite (node:sqlite)        │
   │  caregiver view    │                                                                  └──────────────────────────────┘
   └────────────────────┘
```

- `src/mcp.ts` — the MCP server: tools, resource, prompt, server instructions (safety rules for the model).
- `src/care.ts` — the domain logic: schedule, dose log, double-dose guard, adherence, refill forecast, escalation.
- `src/agent.ts` — the simulated Alexa+ brain: **Claude on Amazon Bedrock** (`AnthropicBedrockMantle`) with the MCP server as its only tools; falls back to the Claude API if no AWS credentials are set.
- `src/server.ts` — one process serving `/mcp`, `/api/*` and the web device.
- `web/` — the Alexa+ device simulator (Echo Show-style screen, light bar, push-to-talk) and the caregiver phone.

### MCP tools

| Tool | Purpose |
|---|---|
| `get_today_schedule` | What's due now, what's next, what's done |
| `log_dose` | Log taken / skipped (`all_due` for "I took my pills"); double-dose and too-early guards |
| `check_what_i_took` | "Did I take it?" from the log |
| `list_medications` | Active prescriptions with dose, instructions, times |
| `get_refill_status` | Days of supply left per medicine |
| `record_refill` | Add tablets after a pharmacy run |
| `notify_caregiver` | Message the family (info / warning / urgent) |
| `record_checkin` | How she feels today |
| `get_adherence` | Taken / missed / skipped over N days |
| `caregiver_briefing` | Everything a family member asks for, in one call |
| `add_medication` | Caregiver setup from the prescription label |
| `stop_medication` | When the doctor stops a medicine |

Resource: `carecue://schedule/today` · Prompt: `morning_checkin`

The server is **stateless** (a fresh MCP server per request), so it can scale horizontally behind a load balancer.

## Run it

Requires **Node 22.13+** (uses the built-in `node:sqlite` and native TypeScript).

```bash
npm install
cp .env.example .env      # add AWS (Bedrock) or Claude API credentials for the voice agent
npm start                 # http://localhost:8787
npm test                  # end-to-end check of the MCP server (in another terminal)
```

- **MCP endpoint:** `http://localhost:8787/mcp` — point Alexa+ or any MCP client (MCP Inspector, Claude Desktop, Kiro) at it. Set `CARECUE_MCP_TOKEN` to require a bearer token.
- **Simulator:** open `http://localhost:8787` in Chrome, press the mic (or space bar) and talk. The **demo clock** buttons at the bottom move time to 8:01 AM, 8:50 PM, etc. so the whole day plays out in two minutes.
- **Real push alerts:** set `CARECUE_ALERT_WEBHOOK=https://ntfy.sh/<your-private-topic>` and install the ntfy app on the caregiver's phone.

## Works today on any Alexa, and on Android

The same household data powers three front doors:

1. **Alexa+ (MCP)** — `/mcp`, the hackathon track: Alexa+ or any MCP client calls the 12 CareCue tools.
2. **Alexa custom skill** — `/alexa`, live on every Echo and in the Alexa app today. English (*"Alexa, open Care Cue"*) and Spanish (*"Alexa, abre mi pastillero"*): logs doses by voice, guards double doses, answers "did I take it?", tracks refills, and creates **daily Alexa reminders** at each medicine time (Reminders API, with the user's permission). Interaction models for en-US, es-US, es-MX and es-ES are in `skill-package/`.
3. **CareCue mobile app (Android)** — `mobile/`, a Capacitor app (also served as a web app at `/app`):
   - **Senior mode:** large clock, the next medicine in big type, one huge *"I took it"* button with a full-screen confirmation read out loud, *"I don't feel well"*, *"I need help"* and *"Call Daniel"* buttons, adjustable text size, daily local notifications. Typeface: Atkinson Hyperlegible, built for low-vision readers.
   - **Family mode:** today at a glance, 7-day adherence, refill warnings, alerts with "mark as seen", add/remove medicines, and **4-digit codes** to connect the home's Alexa or the senior's phone.

Connecting Alexa takes one sentence: the family app shows a code, and the senior says *"Alexa, my code is 4 8 2 1"*.

### Deploy

The demo server runs on a single Amazon Lightsail instance (Node 24 + Caddy for automatic HTTPS). `npm start` with `HOST=127.0.0.1`, behind any TLS reverse proxy; the Alexa endpoint verifies Amazon's request signatures (set `ALEXA_SKILL_ID`).

### Privacy

CareCue stores only what a family enters: first names, medicine names, doses, times and the dose log. App and Alexa links are stored as SHA-256 hashes. No data is sold or shared; delete a household and everything about it is deleted.

## Safety by design

- The model gets **server instructions** with hard rules: check the log before answering, never suggest changing a dose, escalate emergencies.
- The **double-dose guard** lives in code, not in the prompt: `log_dose` refuses a second "taken" for a dose that is already taken, and refuses doses more than 60 minutes early.
- Every caregiver alert is stored and visible; a late confirmation resolves it so families aren't left worrying.
- Medication changes (`add_medication`, `stop_medication`) are marked as caregiver setup and require confirmation.

## Built with

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) 1.32 (protocol 2025-11-25, Streamable HTTP)
- Claude on **Amazon Bedrock** via `@anthropic-ai/bedrock-sdk`
- Node 26, `node:sqlite`, Express, Web Speech API

## License

MIT
