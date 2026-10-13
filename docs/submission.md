# Devpost submission (draft)

**Project name:** CareCue
**Tagline:** A voice-first medication companion for older adults, built for Alexa+, with an Alexa skill for Echo devices.
**Track:** Alexa+ · **Mini challenges:** AWS Builder, Open Source
**Repo:** https://github.com/alvarezclay16-sketch/carecue (MIT)
**Live server:** https://98-86-85-249.sslip.io (simulator at `/`, mobile web app at `/app`, MCP at `/mcp`, Alexa endpoint at `/alexa`)
**Demo video (2:42):** _paste the YouTube/Vimeo link here_ (file: `ENTREGA/CareCue-demo.mp4`)

## What it does
CareCue helps an older adult living at home take the right medicine at the right time, by voice, and keeps the family in the loop without phone calls every morning.

- Speaks up at each medicine time ("Rosa, it's time for your Metformin…").
- "I took my pills" logs every dose that's due; "Did I take my Losartan?" is answered from the log, never from memory.
- **Double-dose guard** in code: a second "taken" for the same dose is refused with a clear "please don't take another one".
- Missed dose → after 45 minutes the caregiver gets an alert; a late confirmation resolves it.
- Refill forecasting and alerts; "I picked up 30 more" adds them back.
- Safety rules tested over seven manual QA rounds plus a committed adversarial suite (`npm run safety`; scenarios, pass rates and open failures are in `docs/safety-scorecard.md`, hazards in `docs/safety-case.md`): a hedged "I think I took it" is never logged; emergencies get the local number (131 in Chile, 911 in the US) and an urgent family alert; hopeless talk gets a direct safety question and the crisis line (*4141 / 988).
- "I don't feel well" → check-in + caregiver alert; emergencies → "call emergency services now" + urgent alert.
- English and Spanish.

## How it's built
- **MCP server** (TypeScript, MCP SDK 1.32, protocol **2025-11-25**, **Streamable HTTP**, stateless): 12 tools, 1 resource, 1 prompt, server instructions with safety rules. Household-scoped auth (app tokens, internal agent tokens, optional shared token).
- **Alexa+ simulated experience**: web device with push-to-talk, light bar and proactive reminders; the brain is **Claude** with the CareCue MCP server as its only tools. The same code runs on Amazon Bedrock (Mantle endpoint); the demo uses the Claude API while our account waits for Bedrock model access.
- **Alexa custom skill** (ASK SDK v2, signature-verified): en-US, es-US, es-MX, es-ES; daily **Alexa Reminders API** reminders at each medicine time; 4-digit code linking.
- **Android app** (Capacitor 8): senior mode designed for low vision and unsteady hands (Atkinson Hyperlegible, 72–96 px buttons, one action per screen, spoken confirmations, adjustable text size, local notifications) and family mode (status, adherence, alerts, medicines, connection codes).
- **AWS**: Amazon Lightsail (Node 24 + Caddy, automatic HTTPS), Alexa Skills Kit (SMAPI, Reminders API); Bedrock-ready via `CARECUE_PROVIDER=bedrock`.

## Product feedback
- **Alexa+ / MCP:** Building against MCP 2025-11-25 with Streamable HTTP was straightforward; the stateless pattern (fresh server per request) made auth scoping per household easy. What we missed most: a way to test a self-hosted MCP server inside Alexa+ from outside the US. A hosted "paste your MCP URL and talk to it" console would remove that gap. Would build with it again: yes.
- **Alexa Skills Kit:** SMAPI + ASK CLI let us create the skill, upload four interaction models and run real simulations against our endpoint without touching the console. The Reminders API is exactly what medication use cases need. Friction: the manifest category enum isn't discoverable from the error; `ask configure` requires an interactive TTY for an optional step.
- **Amazon Bedrock (AWS Builder):** The Mantle client and long-term API keys are a big simplification. Friction: a brand-new account got `403 not available for this account` for every Anthropic model even after the use-case form; the fix (an "Account Activation → Bedrock Allowlisting" support case) isn't linked from the error or the console. See `docs/friction-log.md`.
- **Amazon Lightsail:** create → static IP → open ports → done in four CLI calls; a great fit for hackathon-sized services.

## Open source
New MIT-licensed project: https://github.com/alvarezclay16-sketch/carecue — MCP server, Alexa skill, Android app, simulator and tests (`npm test`, `node tests/alexa.ts`).

## Friction log
See `docs/friction-log.md` (5 entries with steps, expected vs. actual, severity, workaround and suggestion).
