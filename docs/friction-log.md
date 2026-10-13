# Friction log

Kept while building CareCue for the Alexa+ track. Each entry: task, steps, expected vs. actual, severity, workaround, suggestion.

---

### 1. Calling Claude on Amazon Bedrock from a brand-new AWS account

- **Task:** First call to `anthropic.claude-opus-5-5` from a new account, us-east-1, using a Bedrock long-term API key (`AWS_BEARER_TOKEN_BEDROCK`) and the `AnthropicBedrockMantle` client.
- **Steps:** Created the account → opened Bedrock → Model catalog → Claude Opus 5.5 → submitted the Anthropic first-time use case form → generated a long-term API key → called the model.
- **Expected:** The call succeeds once the use case form is submitted (the console says models are available by default).
- **Actual:** `403 permission_error: "anthropic.claude-opus-5-5 is not available for this account"`. Same for Sonnet 5.5, Haiku 4.5 and Opus 4.8, on both the Mantle endpoint and bedrock-runtime with `us.` / `global.` inference profiles. The console gives no hint of what is missing (the free-tier page and billing page look normal, and a payment method is on file).
- **Update (2026-10-12):** since then `bedrock-runtime` InvokeModel now answers 200 for Opus 4.6, Opus 4.5, Sonnet 4.6, Sonnet 4.5 and Haiku 4.5 (`docs/bedrock-probe.txt`); the 5.x models and Opus 4.8 still return 403, so the Claude API stays the failover and the baseline.
- **Severity:** Blocker (no model = no voice agent).
- **Workaround:** Opened an "Account and billing → Account Activation → Bedrock Allowlisting" support case. Kept building the MCP server and tested it with a scripted MCP client while waiting.
- **Suggestion:** Return an actionable error (e.g. "account pending activation, typically N hours" or a link to the allowlisting case), and show the account's model eligibility on the model card next to the use case form.

### 2. Finding the Bedrock model allowlisting form

- **Task:** Request access after the 403.
- **Expected:** A link from the error or from the model card.
- **Actual:** Found it only by creating a support case and browsing service → "Account Activation" → category "Bedrock Allowlisting".
- **Severity:** Medium.
- **Suggestion:** Link to it from the Bedrock model catalog when the account isn't eligible.

### 3. Model discovery on the Mantle endpoint

- **Task:** List which Claude models the account can call, to pick one automatically.
- **Actual:** `client.models` is not available on `AnthropicBedrockMantle` in `@anthropic-ai/bedrock-sdk` 0.34.4, so there is no programmatic way from the same client to see what's enabled.
- **Severity:** Low.
- **Workaround:** Probe a list of model IDs and catch 403/404.
- **Suggestion:** Expose a models list on the Mantle client (or document the AWS CLI equivalent next to the Mantle quickstart).

### 4. Running the Alexa+ experience without Alexa+ preview access

- **Task:** Show the MCP server working inside Alexa+.
- **Actual:** Building in Chile, without access to an Alexa+ device or developer preview, there was no way to connect the self-hosted MCP server to a real Alexa+ instance.
- **Severity:** Medium for international builders.
- **Workaround:** Built the simulated Alexa+ path the rules allow: a web device with push-to-talk, a light bar, proactive reminders, and Claude (Bedrock) calling the CareCue MCP server over Streamable HTTP.
- **Suggestion:** A hosted Alexa+ MCP test console (paste an MCP URL, talk to it in the browser) would let builders anywhere test the real integration.

### 5. MCP spec 2025-11-25 support

- **Task:** Confirm the server speaks protocol 2025-11-25 over Streamable HTTP.
- **Actual:** Worked out of the box with `@modelcontextprotocol/sdk` 1.32.1 (`LATEST_PROTOCOL_VERSION = '2025-11-25'`); the smoke test logs the negotiated version.
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
