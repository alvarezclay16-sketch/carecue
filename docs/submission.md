# Devpost submission (final text)

**Project name:** CareCue
**Tagline:** A voice-first medication companion for older adults, built as an MCP server for Alexa+, with an Alexa skill for every Echo.
**Track:** Alexa+ · **Mini challenges:** AWS Builder, Open Source
**Repo:** https://github.com/alvarezclay16-sketch/carecue (MIT)
**Live demo:** https://98-86-85-249.sslip.io (private demo per visitor, no microphone needed; MCP at `/mcp`, Alexa endpoint at `/alexa`, mobile web app at `/app`)
**Demo video:** _paste the YouTube/Vimeo link here_ (file: `ENTREGA/CareCue-demo.mp4`; the cap is 3:00)

## Try it (for judges, 2 minutes)
1. Open https://98-86-85-249.sslip.io in Chrome. You get a private demo household (Rosa and her son Daniel); nobody else's clicks affect it.
2. Press **Play Rosa's day** (six steps, three live model turns, about 40 seconds) or tap a scenario chip. Typing works if you have no microphone. If the live model is resting to cap costs, the page plays a recorded real run and labels it **Replay of a real run**.
3. Open the **MCP wire** tab: every tool call, tagged MODEL, TOUCH or PROBE, with the MCP annotations of the tool. The *Remove a medicine* probe shows the server's HTTP 403 `insufficient_scope`.
4. Read the safety scorecard: `docs/safety-scorecard.md` (or `GET /api/safety`).
5. Connect your own MCP client: `claude mcp add --transport http carecue https://98-86-85-249.sslip.io/mcp` (details and real request/response captures: `docs/alexa-plus-integration.md`).

## What it does
CareCue helps an older adult living at home take the right medicine at the right time, by voice, and keeps the family in the loop without a phone call every morning.

- Speaks up at each medicine time (*"Rosa, it's time for your medicine: Losartan, 1 tablet, and Metformin, 1 tablet."*). In the simulator the server pushes the reminder to the page; on a real Echo the skill asks permission to create daily Alexa Reminders.
- *"I took my pills"* logs every dose that is due; *"Did I take my Losartan?"* is answered from the log, never from memory.
- **Never confirms a second dose, and tells her clearly not to take another one.** The double-dose guard is code in `log_dose`: a second "taken" for the same dose is refused (`possible_double_dose`). A hedged *"I think I took it, maybe"* is never written down.
- A dose still open 45 minutes after its time alerts the caregiver (it counts as missed after 30); a late confirmation resolves the alert. Refill forecasting and alerts.
- *"I don't feel well"* gets a check-in and a message to the family; an emergency (chest pain, trouble breathing, a fall, fainting, confusion, slurred speech) gets the local emergency number said digit by digit and an urgent alert; hopeless talk gets a direct safety question and the crisis line (*4141 in Chile, 988 in the US).
- English and Spanish (Chile). CareCue is a reminder and a self-reported log, not a medical device, and never gives dosing advice.

## How it's built
- **MCP server** (TypeScript, MCP SDK 1.32.1, protocol **2025-11-25**, **Streamable HTTP**, stateless): **12 tools** with titles and annotations, 1 resource, 1 prompt, and server instructions (the safety rules) that travel in the `initialize` result, so any MCP host receives them. **Roles are enforced by the server**: a patient or anonymous session lists 10 tools, a caregiver token lists 12, and a direct call to `add_medication` or `stop_medication` without that role gets HTTP **403 `insufficient_scope`**. The guard lives in code, not in a prompt.
- **Voice agent for the simulated Alexa+**: Claude with the CareCue MCP server as its only tools. **Claude on the Claude API (`claude-opus-5-5`) with automatic failover to Claude Opus 4.6 on Amazon Bedrock** (`bedrock-runtime` InvokeModel through `AnthropicBedrock`), both measured by the same 60-scenario safety suite. We do not claim CareCue runs on Bedrock alone: on our account the Claude 5.x models return 403 on Bedrock, and no Bedrock model met our stand-alone shipping rule (`docs/aws-integration.md`).
- **Safety suite** (`npm run safety`): 60 adversarial scenarios (35 English, 25 Spanish, 14 hazards), run against the real agent, the real MCP server and a real database, in agent mode and in a bare-client mode that models a generic MCP host. Shipping model: 59/60 first-try passes, 60/60 within two attempts, 0 unsafe replies. The Claude API failing every second call and Bedrock Opus 4.6 taking over: 58/60 and 60/60, 0 unsafe. Bedrock models alone were measured too and fell short of the rule; all numbers, the failures and a safety case are in `docs/safety-scorecard.md` and `docs/safety-case.md`.
- **Echo Show screen in the simulator**: one giant-type scene at a time (reminder, written down, STOP, check first, emergency, support), Day and Night themes, a text-size toggle and EN/ES. The scenes are computed on the server from the MCP tool results, the dose log and the person's own words, never from the model's reply text; a real Alexa+ device cannot be pushed custom scenes through MCP, so on real hardware the same information arrives as speech. The *I took it* button writes through MCP `log_dose` with no model involved. In the video: the simulated Echo renders what the server reports.
- **Alexa custom skill** (ASK SDK v2, signature-verified): en-US, es-US, es-MX, es-ES; logs doses, double-dose answers, refills, 4-digit code linking; asks permission for daily **Alexa Reminders API** reminders (implemented; not yet observed on a physical Echo). Verified with SMAPI `simulate-skill` against the live endpoint.
- **Android app** (Capacitor 8): senior mode for low vision and unsteady hands (Atkinson Hyperlegible, large buttons, one action per screen, spoken confirmations, local notifications) and family mode (status, adherence, alerts, medicines, connection codes).
- **Spend guard and private demo households** so the public demo stays cheap and safe to try: per-address and global limits on every route that reaches a model, a kill switch, and a sandbox household per visitor.

## What was built during the hackathon window
The repository was created on 10 October 2026 and its full history is in `git log`. Built in that time:
- the MCP server (12 tools, annotations, resource, prompt, instructions), the domain logic, the scheduler, SQLite storage;
- the simulated Alexa+ (web device with speech, scenes, wire tab, guided tour, private sandboxes, replay mode, typed fallback), the family phone view and the Android app;
- the Alexa custom skill, its four interaction models and the Reminders API integration;
- the role enforcement and 403, the spend guard, and the provider layer (Claude API plus Bedrock failover, receipts, `GET /api/model`);
- the 60-scenario safety suite, its scorecard and the safety case, and this documentation.

Third-party pieces: the MCP SDK, the Anthropic and Bedrock SDKs, the ASK SDK, Express, Capacitor and its plugins, the Atkinson Hyperlegible font.

## AWS services
- **Amazon Bedrock** (`bedrock-runtime` InvokeModel, Claude Opus 4.6): the automatic failover of the voice agent, measured by the safety suite.
- **Amazon Lightsail**: hosts the whole server (Node 24 under systemd, Caddy for HTTPS on a sslip.io name).
- **Alexa Skills Kit**: SMAPI and ASK CLI to create and test the skill, the skill endpoint, the Reminders API.

For each: what it does, where in the code, credential type, cost and how to verify it: `docs/aws-integration.md`. Not used: Polly, Lambda, SNS/SES, push notifications.

## Product feedback
Every item below happened while building CareCue; the full steps are in `docs/friction-log.md` (12 entries).

- **MCP (spec 2025-11-25 and TypeScript SDK 1.32.1):** The spec and the SDK worked out of the box, tool annotations are easy to declare, and the stateless pattern (a fresh server per request) made per-household auth simple. Friction: a tool that exists but is hidden from a role answers "tool not found" with HTTP 200, so we had to add our own pre-check to return a real 403 `insufficient_scope`; `initialize` advertises `listChanged: true` on a stateless server that never sends it; an unconstrained integer is published with ±9007199254740991 bounds. Wish: a supported way to fail a call for lack of authorization, and a stateless switch for `listChanged`. Would build with it again: yes.
- **Alexa Skills Kit (SMAPI, ASK CLI, ASK SDK v2):** SMAPI and the CLI let us create the skill, upload four interaction models and run real simulations against our own endpoint without opening the console; the Express adapter verifies Amazon's signatures for us; the Reminders API is exactly what a medication use case needs. Friction: the manifest category enum is not listed in the error (entry 6); `ask configure` needs a TTY for an optional step (entry 7); `simulate-skill` can report `SUCCESSFUL` when no request reached the skill, and its output contains the user's consent token (entry 12). Wish: a way to test a self-hosted MCP server inside Alexa+ from outside the US.
- **Amazon Bedrock:** Long-term API keys are a big simplification, and `bedrock-runtime` works with the Claude 4.x models through the Anthropic SDK's Bedrock client. Friction: the 403 is per model (Claude 5.x blocked, 4.x fine, same key) and the message does not say why; the per-model `GetFoundationModelAvailability` call does (`agreementAvailability: NOT_AVAILABLE`) but nothing points to it (entries 1 and 3); bare model ids fail with a 400 until you use an inference-profile id (entry 8); 24 concurrent tiny requests were 79% throttled for Opus 4.6 with no `Retry-After` (entry 9); the Claude API's fallback beta is rejected on InvokeModel (entry 10). Wish: show per-model availability and quotas in the console and in the error.
- **Amazon Lightsail:** Create an instance, attach a static IP, open the ports, done in a handful of CLI calls; a great fit for a hackathon-sized service. We ran Caddy ourselves for automatic HTTPS on a sslip.io name because the Alexa endpoint needs a trusted certificate; a built-in HTTPS endpoint for a single instance would have saved that step.
- **Claude API:** `claude-opus-5-5` was the most reliable model in our suite (59/60 first try, 0 unsafe), the median whole-turn latency was 3.2 s (p95 7.2 s) with the system prompt marked for caching. Friction: the platforms accept different parameters (entry 10). Wish: a single page that lists which parameters and betas each platform accepts.
- **Capacitor 8:** We used it as a thin shell around the same web app that the server serves at `/app`: static assets, no bundler, plugins for speech recognition, text to speech, local notifications and haptics, minSdk 24 and target SDK 36. We have no blocking friction to report. One thing to watch: the community speech-recognition plugin we installed is on major version 7 while the other plugins are on 8 (its peer range allows Capacitor 7 or newer, so it installs).

**Optional feature requests:** (1) a hosted Alexa+ MCP test console where a builder pastes an MCP URL and talks to it in the browser; (2) documentation of how Alexa+ discovers and authenticates a custom MCP server; (3) per-model availability and quota values in the Bedrock console and in the 403 and 429 responses; (4) a distinct simulation status in SMAPI when no request reached the skill.

## Open source
New MIT-licensed project.
- **Repository:** https://github.com/alvarezclay16-sketch/carecue
- **GitHub username:** alvarezclay16-sketch
- **Description:** CareCue: a voice-first medication companion for older adults, built as an MCP server for Alexa+ (spec 2025-11-25, Streamable HTTP, 12 tools, server-enforced roles), with an Alexa skill, an Android app, a simulated Alexa+ device, a 60-scenario adversarial safety suite and its scorecard. MIT.
- Everything needed to run it is in the repo: `npm install`, `.env.example`, `npm start`, `npm test`, `node tests/alexa.ts`, `npm run safety`.

## Friction log
`docs/friction-log.md`: 12 entries, each with steps, expected vs. actual, severity, workaround and suggestion.

## Honest limits
- No real Alexa+ device or preview was available; the Alexa+ path is exercised with generic MCP clients and a simulated Alexa+ (`docs/alexa-plus-integration.md`).
- The skill was verified with SMAPI simulations, not on a physical Echo; Alexa Reminders were not observed on a device.
- Phone push notifications are not configured: alerts appear in the family app (the code can post them to a webhook such as ntfy).
- The safety suite checks behavior on its 60 scenarios; it is not clinical validation, and a self-reported log can be wrong.
