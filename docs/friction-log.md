# Friction log (v2)

Kept while building CareCue for the Alexa+ track. Each entry has a task, steps, expected vs. actual, severity, workaround and suggestion. Entries 1 and 3 were rewritten on 13 October 2026 with measurements; entries 8 to 12 were added after those measurements. Every entry describes something that happened while building this project, and where a number is given it was measured (the commands are named so you can repeat them). 12 entries in total.

---

### 1. Calling Claude on Amazon Bedrock from a brand-new AWS account: the 403 is per model, not per account

- **Task:** First call to Claude from a new account (us-east-1) with a Bedrock long-term API key (`AWS_BEARER_TOKEN_BEDROCK`), first with `anthropic.claude-opus-5-5` on the `AnthropicBedrockMantle` client, later on `bedrock-runtime` InvokeModel through `AnthropicBedrock`.
- **Steps:** Created the account, opened Bedrock, Model catalog, Claude Opus 5.5, submitted the Anthropic first-time use case form, generated the API key, called the model. Later, on 12 and 13 October, ran `npm run probe:bedrock` (`scripts/probe-bedrock.mjs`, output in `docs/bedrock-probe.txt`) to try every model id we cared about with the same key.
- **Expected:** After the use case form, every Claude model the console lists is callable (the console says models are available by default).
- **Actual:** At first every Anthropic id returned `403 permission_error: "anthropic.claude-opus-5-5 is not available for this account"`, on both endpoints, Haiku 4.5 included. By 12 October `bedrock-runtime` answered 200 for the Claude 4.x family, and this is the state on 13 October with the same key and the same SDK:

  | Model | bedrock-runtime |
  |---|---|
  | Opus 4.6, Opus 4.5, Sonnet 4.6, Sonnet 4.5, Haiku 4.5 (`us.` inference profiles) | 200 |
  | Opus 5.5, Sonnet 5.5 (`anthropic.claude-opus-5-5`, `us.`/`global.` variants), Opus 4.8 | 403 |

  The Mantle endpoint (`bedrock-mantle.us-east-1.api.aws/anthropic`) answers 403 for Opus 5.5 and **404 "The model '...' does not exist"** for the 4.x ids that work on `bedrock-runtime`, without saying which ids it does know. We do not know what changed between the first 403s and 12 October (time passing, or the support case in entry 2); the console showed nothing in between. The 403 text names the model but only points to "AWS Sales" for "additional access options". The control plane does know why (entry 3): for the blocked models `agreementAvailability` is `NOT_AVAILABLE`.
- **Severity:** Blocker for the model we wanted as the voice agent (Opus 5.5); none for the 4.x family.
- **Workaround:** The Claude API is the primary model (`claude-opus-5-5`, 59/60 on our safety suite) and Claude Opus 4.6 on Bedrock is the automatic failover, measured by the same suite (`docs/aws-integration.md`). We never describe the product as running on Bedrock alone.
- **Suggestion:** Say in the error which requirement is missing (agreement, regional access, allow-listing) and link to the form or support case that fixes it; show the account's per-model availability on the model card next to the use case form.

### 2. Finding the Bedrock model allowlisting form

- **Task:** Request access after the 403.
- **Expected:** A link from the error or from the model card.
- **Actual:** Found it only by creating a support case and browsing service, "Account Activation", category "Bedrock Allowlisting". The current 403 text still points to AWS Sales, not to that case.
- **Severity:** Medium.
- **Suggestion:** Link to it from the Bedrock model catalog when the account is not eligible.

### 3. Finding out which models a Bedrock bearer key can call

- **Task:** List which Claude models the account can call, to pick one automatically.
- **Steps:** Looked for a models list on the Mantle client; called the Bedrock control plane with the same bearer key (`GET /foundation-models?byProvider=Anthropic`, `GET /foundation-model-availability/{id}`, equivalent to `aws bedrock list-foundation-models` and `aws bedrock get-foundation-model-availability`).
- **Expected:** One call that says what this key can invoke.
- **Actual:** `client.models` is `undefined` on `AnthropicBedrockMantle` in `@anthropic-ai/bedrock-sdk` 0.34.4, and `GET .../anthropic/v1/models` on the Mantle endpoint answers 404. The control plane does answer 200 to the bearer key, but `ListFoundationModels` lists 16 Anthropic entries as `ACTIVE`, including Opus 5.5 and Sonnet 5.5, which then 403. The truthful answer is in the per-model `GetFoundationModelAvailability`: `agreementAvailability.status` is `AVAILABLE` for Opus 4.6 and `NOT_AVAILABLE` for Opus 5.5 and Sonnet 5.5, while `authorizationStatus` says `AUTHORIZED` and `entitlementAvailability` says `AVAILABLE` for both. Nothing in the 403 mentions this endpoint.
- **Severity:** Low (a probe works), but it cost us time.
- **Workaround:** `scripts/probe-bedrock.mjs` tries one tiny request per id and prints the agreement status next to the HTTP status.
- **Suggestion:** Make the model list say "callable by you", and put the failing field (`agreementAvailability`) in the 403 body or link to the availability call.

### 4. Running the Alexa+ experience without Alexa+ preview access

- **Task:** Show the MCP server working inside Alexa+.
- **Actual:** Building in Chile, without access to an Alexa+ device or developer preview, there was no way to connect the self-hosted MCP server to a real Alexa+ instance. We also could not find out how Alexa+ discovers or authenticates a custom MCP server.
- **Severity:** Medium for international builders.
- **Workaround:** Built the simulated Alexa+ path the rules allow: a web device with push-to-talk, a light bar, proactive reminders, and Claude calling the CareCue MCP server over Streamable HTTP, and tested the MCP endpoint with generic MCP clients. The Echo path is a real Alexa skill checked with SMAPI simulations (`docs/alexa-plus-integration.md` says what is verified and what is not).
- **Suggestion:** A hosted Alexa+ MCP test console (paste an MCP URL, talk to it in the browser) would let builders anywhere test the real integration.

### 5. MCP spec 2025-11-25 support

- **Task:** Confirm the server speaks protocol 2025-11-25 over Streamable HTTP.
- **Actual:** Worked out of the box with `@modelcontextprotocol/sdk` 1.32.1 (`LATEST_PROTOCOL_VERSION = '2025-11-25'`); the smoke test and `GET /api/mcp-info` report the negotiated version.
- **Severity:** None (positive note).

### 6. Skill manifest category

- **Task:** Create the skill with `ask smapi create-skill-for-vendor`.
- **Actual:** `INVALID_ENUM_VALUE` for `publishingInformation.category: "HEALTH_AND_FITNESS"`; the error doesn't list the allowed values.
- **Severity:** Low. **Workaround:** removed the category (set it later in the console).
- **Suggestion:** Include the allowed enum values in the violation message.

### 7. `ask configure` without an interactive terminal

- **Task:** Log in the ASK CLI from a scripted environment.
- **Actual:** Step 1 (LWA login) succeeds, then the optional "link your AWS account?" prompt crashes with `readline was closed` when stdin isn't a TTY.
- **Severity:** Low. **Workaround:** the profile from step 1 is saved and works.
- **Suggestion:** A `--no-aws` flag (or skip the prompt when stdin isn't a TTY).

### 8. Inference-profile ids on Bedrock

- **Task:** Pick the right model id for `bedrock-runtime`.
- **Steps:** Called the same models with the plain, `us.` and `global.` forms of the id (Converse and InvokeModel, 13 October).
- **Expected:** The model id from the catalog works.
- **Actual:** `anthropic.claude-opus-4-6-v1` and `anthropic.claude-sonnet-4-5-20250929-v1:0` answer **400** "Invocation of model ID ... with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile". `us.anthropic.claude-opus-4-6-v1` and `global.anthropic.claude-opus-4-6-v1` both answer 200. The id shapes are not uniform (`us.anthropic.claude-sonnet-4-6` has no date or `-v1:0`, `us.anthropic.claude-sonnet-4-5-20250929-v1:0` has both), and the 403 for `us.anthropic.claude-opus-5-5` names the model without the prefix (`anthropic.claude-opus-5-5`).
- **Severity:** Low. **Workaround:** the probe script lists the working ids; `CARECUE_MODEL` takes the inference-profile id.
- **Suggestion:** In the 400, name the profile ids that contain the model; show them on the model card.

### 9. Bedrock throttles (HTTP 429) in small bursts

- **Task:** Run the 60-scenario safety suite against Bedrock models, and size the failover.
- **Steps:** (a) Safety runs at concurrency 2. (b) On 13 October, 24 concurrent tiny InvokeModel requests (`max_tokens` 8) per model.
- **Expected:** A handful of parallel requests from a new account are fine.
- **Actual:** (b) Opus 4.6: 5 x 200 and 19 x 429 `{"message":"Too many requests, please wait before trying again."}`; Sonnet 4.5: 10 x 200 and 14 x 429. No `Retry-After` header. (a) Every Bedrock-only 60-scenario run needed 38 to 67 infrastructure retries, where a reason was kept it reads "degraded answer (model unavailable)" (the runner treats them as throttling; it does not store the HTTP status), against none for the Claude API baseline.
- **Severity:** Medium for evaluation, Low as a failover for one household.
- **Workaround:** The runner runs two scenarios at a time with a shared cool-down and retries infrastructure errors in a fresh household without counting them against the model (`tests/safety/run.ts`, plus `--resume`); the server's Bedrock calls retry twice and sit behind the Claude API (`src/agent.ts`).
- **Suggestion:** Show the account's current quota next to each model, add `Retry-After`, and name the limit that was hit.

### 10. Claude API features that Bedrock InvokeModel rejects

- **Task:** Use the same request for both providers so a turn can fail over.
- **Steps:** The Claude API call uses the `server-side-fallback-2026-07-01` beta (`fallbacks`). Sent the same shapes to `us.anthropic.claude-opus-4-6-v1` through `AnthropicBedrock` (13 October).
- **Actual:** `fallbacks: "default"` answers **400** "fallbacks: Extra inputs are not permitted"; the `anthropic-beta: server-side-fallback-2026-07-01` header answers **400** "invalid beta flag". `output_config: {effort: "low"}` is accepted (200). To be safe with provider-specific thinking blocks, `src/agent.ts` (`stripThinking`) copies the history without them when a conversation crosses from one provider to the other.
- **Severity:** Low (known, handled in code). **Workaround:** two request shapes in `callOne`: beta fields only on the Claude API, plain `messages.create` on Bedrock.
- **Suggestion:** One page listing which Messages API parameters and betas each platform accepts.

### 11. A tool hidden from a role answers "tool not found" with HTTP 200

- **Task:** Make `add_medication` and `stop_medication` caregiver-only, enforced by the server.
- **Steps:** Registered the two tools only for the caregiver role in `buildServer` and called `stop_medication` as a patient (in memory with the SDK's own client, 13 October).
- **Expected:** An authorization error.
- **Actual:** The SDK answers with a normal result, `isError: true`, text "MCP error -32602: Tool stop_medication not found". Over HTTP that is status 200, which makes a refused call look like a model typo and gives a gateway nothing to key on. Smaller observations on the same server: `initialize` advertises `listChanged: true` for tools, resources and prompts although a stateless server never sends such a notification, and an unconstrained `z.number().int()` is published with `minimum`/`maximum` of +-9007199254740991.
- **Severity:** Low. **Workaround:** `handleMcp` (`src/mcp.ts`) inspects `tools/call` before the SDK and answers HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope", scope="care:admin"` and JSON-RPC error -32003; `tests/smoke.ts` checks it, including a batch with an admin call hidden inside.
- **Suggestion:** A supported way to return an authorization failure from a role-filtered tool, and a way to turn `listChanged` off for stateless servers.

### 12. `simulate-skill` can report SUCCESSFUL when no skill code ran

- **Task:** Check the live skill with `ask smapi simulate-skill`, then `ask smapi get-skill-simulation`.
- **Steps:** Ran "ask care cue what's next" in the development stage (13 October, three attempts).
- **Expected:** `SUCCESSFUL` means the skill answered.
- **Actual:** The first attempt came back `SUCCESSFUL` with an empty `alexaResponses` list and a single `SessionEndedRequest` (reason `USER_INITIATED`): our endpoint was never asked a question. The next attempt of the same utterance returned the right sentence. Also, `simulate-skill` is asynchronous (the call returns an id that has to be polled), the result of `get-skill-simulation` contains the request that was sent to the endpoint, including the user's `consentToken`, which is easy to paste into a log by accident, and the utterance "open care cue" arrived as an `IntentRequest` that our fallback answered, not as a `LaunchRequest`.
- **Severity:** Low. **Workaround:** poll `get-skill-simulation` until it is no longer `IN_PROGRESS`, and check the `invocations` array, not only the status.
- **Suggestion:** Report a distinct status when no invocation reached the endpoint, and redact tokens in the simulation output.
