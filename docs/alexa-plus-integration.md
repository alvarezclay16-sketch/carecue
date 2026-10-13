# Alexa+ and MCP: how CareCue connects, and what is verified

CareCue speaks MCP at `/mcp`. This page says how a host (Alexa+ or any other MCP client) connects, who may call what, shows real requests and responses, and states plainly which parts were tested against real Amazon services and which are simulated.

## What is verified and what is not

| Path | What runs | Status |
|---|---|---|
| **Alexa custom skill** (`/alexa`) | A real Alexa Skills Kit simulation (`ask smapi simulate-skill`, development stage) calls our live endpoint; ASK SDK v2 verifies Amazon's signature | **Verified with SMAPI simulate-skill** on 12 and 13 October 2026 (details in `docs/aws-integration.md`). Not run on a physical Echo for this document |
| **Alexa+ through MCP** | Alexa+ calling `/mcp` as a tool server | **Not verified.** We had no access to an Alexa+ device or preview, so nothing in this repository was run against a real Alexa+ (see friction-log entry 4). We do not know how Alexa+ discovers or authenticates a self-hosted MCP server, and we make no claim about it |
| **Simulated Alexa+** (`web/`, the Echo Show screen at the live URL) | A browser page plays the device: speech in and out, a light bar, scenes. Its brain is Claude with the CareCue MCP server as its **only** tools, over the same Streamable HTTP endpoint | Real code, real model, real MCP calls; the device is a simulation of Alexa+, not Alexa+ |
| **Any generic MCP client** | `@modelcontextprotocol/sdk` client (`tests/smoke.ts`, the voice agent's own bridge in `src/agent.ts`) and raw `curl` (captured below) | **Verified** against a local server. Other hosts (Claude Code, MCP Inspector) use the standard transport and should work; the commands for them below were not run here |

**Proactive speech.** MCP is request and response: a tool server cannot make an assistant speak on its own. On the skill path, CareCue gets Alexa to speak at each medicine time with the Reminders API (`syncReminders`, permission `alexa::alerts:reminders:skill:readwrite`, asked on the device). That code exists and a SMAPI simulation reaches the skill, but a reminder created on a physical Echo was not observed. On the MCP path, a host would have to call `get_today_schedule` on its own schedule (for example from a routine); whether Alexa+ can do that we could not check. In the simulator, the server pushes reminders to the page (`GET /api/events`) and the page speaks them.

## Connect any MCP client

- **URL:** `https://98-86-85-249.sslip.io/mcp` (or `http://localhost:8787/mcp` locally)
- **Transport:** Streamable HTTP, MCP spec **2025-11-25**, stateless: each POST is self-contained, there is no `Mcp-Session-Id`. `GET` and `DELETE` answer `405`.
- **Headers:** `Content-Type: application/json` and `Accept: application/json, text/event-stream`. Replies are one-event server-sent streams (`event: message` / `data: {...}`).
- **No account needed:** with no `Authorization` header you are the **patient** role on a shared playground household (Rosa and Daniel). The playground resets itself after 30 idle minutes if someone changed it. For your own private household and the caregiver role, see "Tokens and roles".

```bash
# Claude Code
claude mcp add --transport http carecue https://98-86-85-249.sslip.io/mcp
# MCP Inspector
npx @modelcontextprotocol/inspector      # transport "Streamable HTTP", URL as above
```

```json
{ "mcpServers": { "carecue": { "type": "http", "url": "https://98-86-85-249.sslip.io/mcp" } } }
```

(The two commands and the `.mcp.json` snippet are those clients' documented syntax; they were not run for this document. The SDK snippet below was.)

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-host", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://98-86-85-249.sslip.io/mcp")));
const { tools } = await client.listTools();                       // 10 tools as the patient role
const r = await client.callTool({ name: "get_today_schedule", arguments: {} });
```

On a public instance `/mcp` is limited to 120 requests a minute per client address (`429` with `Retry-After`).

## Tokens and roles

`resolveScope` in `src/mcp.ts` decides who is calling:

| You send | You are | Tools you see |
|---|---|---|
| No `Authorization` header (server without `CARECUE_MCP_TOKEN`) | the **patient** of the shared playground household | 10 |
| `Bearer <app token>` of a **caregiver** link | a family member of that household | 12 |
| `Bearer <app token>` of a **patient** link (the senior's phone) | the patient of that household | 10 |
| `Bearer agent.<id>.<hmac>` | the built-in voice agent, for one household (internal, HMAC-signed with `CARECUE_SECRET`) | 10 |
| `Bearer <CARECUE_MCP_TOKEN>` (set on a single-home server) | the default household, as the patient | 10 |
| Any other bearer, server with `CARECUE_MCP_TOKEN` set | nobody: `401` | none |
| Any other bearer, server without `CARECUE_MCP_TOKEN` | treated as no header: the playground patient (captured below) | 10 |

- **Get your own household and a caregiver token** (one `curl`; the public server allows 10 new households an hour per address): `POST /api/app/households` with `{"patientName":"Test","caregiverName":"Me","language":"en"}` returns `{token, role: "caregiver", patient_id}`. Tokens are stored as SHA-256 hashes. This is a household of your own that has no medicines yet; add them with the caregiver-only `add_medication` tool.
- **Only a caregiver can see or call `add_medication` and `stop_medication`.** A patient session does not list them, and a direct `tools/call` for one answers **HTTP 403** with `WWW-Authenticate: Bearer error="insufficient_scope", scope="care:admin"` and JSON-RPC error `-32003`, before any tool runs. (Left to the MCP SDK it would answer HTTP 200 with a "tool not found" result, which hides what really happened. The server-side check is the point: the guard is code, not a prompt.) The built-in voice agent also blocks the two tools on its own side.
- **Browser origins:** a request with an `Origin` header that is not the server's own site (or `CARECUE_ALLOWED_ORIGINS`) answers `403` `-32003`. Requests without `Origin` (every non-browser client) are accepted.
- There is no OAuth. Tokens are opaque bearer strings.

## The 12 tools and their annotations

Annotations are the MCP 2025-11-25 hints, read from a live `tools/list` (also at `GET /api/mcp-info`). `R` = readOnlyHint, `I` = idempotentHint, `D` = destructiveHint, `O` = openWorldHint (reaches people outside the server).

| Tool | Role | Hints | Purpose |
|---|---|---|---|
| `get_today_schedule` | patient, caregiver | R I | What is due now, next, and done; also returns the household facts (emergency number, crisis line, family first names) |
| `log_dose` | patient, caregiver | I (writes) | Log taken or skipped; hedged answer writes nothing; double-dose and 60-minute-early guards |
| `check_what_i_took` | patient, caregiver | R I | "Did I take it?" answered from the log |
| `list_medications` | patient, caregiver | R I | Active prescriptions with dose, instructions and times |
| `get_refill_status` | patient, caregiver | R I | Days of supply left per medicine |
| `record_refill` | patient, caregiver | writes | Add tablets after a pharmacy run |
| `notify_caregiver` | patient, caregiver | writes, O | Message the family (info, warning or urgent) |
| `record_checkin` | patient, caregiver | writes | How the person says they feel |
| `get_adherence` | patient, caregiver | R I | Taken, missed and skipped over N days |
| `caregiver_briefing` | patient, caregiver | R I | Everything a family member asks for, in one call |
| `add_medication` | **caregiver only** | writes | Add a prescribed medicine |
| `stop_medication` | **caregiver only** | I D | Remove a medicine the doctor stopped |

One resource, `carecue://schedule/today` (`application/json`), and one prompt, `morning_checkin`. The `initialize` result also carries the server instructions (about 13,000 characters of safety rules, byte-frozen and hash-checked), so a client that is not our own agent receives them too. Responses do not declare an `outputSchema`.

## Real exchanges

Captured on 13 October 2026 from a local server with the shipping configuration and the demo clock set to 08:01 (`CARECUE_CLOCK_CONTROL=1`). Responses are shown as the JSON in the `data:` line of the event stream; long values are shortened with `…`.

**initialize**

```json
→ {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl-demo","version":"1.0"}}}
← {"result":{"protocolVersion":"2025-11-25",
    "capabilities":{"tools":{"listChanged":true},"resources":{"listChanged":true},"prompts":{"listChanged":true}},
    "serverInfo":{"name":"carecue","title":"CareCue medication companion","version":"0.1.0"},
    "instructions":"CareCue is a medication companion for an older adult living at home, used by voice.\nFacts\n- Answer \"did I take it?\" only from …"},
   "jsonrpc":"2.0","id":1}
```

**tools/list** (patient role: 10 tools; one entry shown)

```json
→ {"jsonrpc":"2.0","id":2,"method":"tools/list"}
← {"result":{"tools":[ …,
    {"name":"log_dose","title":"Log a dose",
     "description":"Record that the person took (or chose to skip) a medication. Only call it when that dose is due now and the person clearly says they took it; …",
     "inputSchema":{"type":"object","properties":{"medication":{"type":"string", …},"status":{"default":"taken","type":"string","enum":["taken","skipped"]},"note":{"type":"string", …},"person_was_certain":{"type":"boolean", …},"patient_id":{"type":"integer", …}},"required":["medication","person_was_certain"]},
     "annotations":{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false},
     "execution":{"taskSupport":"forbidden"}},
    … ]},"jsonrpc":"2.0","id":2}
```

**tools/call get_today_schedule**

```json
→ {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_today_schedule","arguments":{}}}
← {"result":{"content":[{"type":"text","text":"{\n  \"now\": \"08:01\",\n  \"spoken_now\": \"8:01 AM\",\n  \"date\": \"2026-10-13\",\n  \"due_now\": [\n    {\"dose_id\":59,\"medication\":\"Losartan\",\"dose\":\"50 mg, 1 tablet\",\"time\":\"08:00\",\"status\":\"reminded\", …},\n    {\"dose_id\":57,\"medication\":\"Metformin\", … } ],\n  \"next_up\": [ … ],\n  \"done_today\": [],\n  \"all_today\": [ … ],\n  \"household\": {\"language\":\"en\",\"emergency_number\":\"131\",\"crisis_line\":\"*4141\",\"caregivers\":[\"Daniel\"]}\n}"}]},"jsonrpc":"2.0","id":3}
```

**tools/call log_dose**: a hedged answer is never written, a certain one is, and a second "taken" for the same dose is refused

```json
→ {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"log_dose","arguments":{"medication":"all_due","status":"taken","person_was_certain":false}}}
← {"result":{"content":[{"type":"text","text":"{\n  \"ok\": false,\n  \"message\": \"Nothing was written down: the person wasn't sure. Ask for a clear yes or the name on the bottle.\",\n  \"logged\": [],\n  \"warnings\": [\n    \"unconfirmed\"\n  ]\n}"}]},"jsonrpc":"2.0","id":4}

→ {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"log_dose","arguments":{"medication":"all_due","status":"taken","person_was_certain":true}}}
← … "ok": true, "message": "Logged: Losartan (8 AM) and Metformin (8 AM) taken.", "logged": [{"medication":"Losartan","time":"08:00","status":"taken"},{"medication":"Metformin","time":"08:00","status":"taken"}], "warnings": [] …

→ {"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"log_dose","arguments":{"medication":"Losartan","status":"taken","person_was_certain":true}}}
← … "ok": false, "message": "Losartan is already logged as taken today at 8:01 AM. There are no more Losartan doses scheduled today, so please don't take another one.", "logged": [], "warnings": ["possible_double_dose"] …
```

**The 403 `insufficient_scope`** (a patient session calls a caregiver tool)

```
POST /mcp                       (no Authorization header)
→ {"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"stop_medication","arguments":{"medication":"Metformin"}}}

HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", scope="care:admin"
← {"jsonrpc":"2.0","error":{"code":-32003,"message":"insufficient_scope: care:admin required, enforced by the server"},"id":7}
```

**Caregiver token**: `tools/list` returns 12 tools, and `add_medication` works

```json
→ (Authorization: Bearer <token from POST /api/app/households>)  {"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"add_medication","arguments":{"name":"Vitamin D","dose":"1000 IU, 1 capsule","times":["09:00"],"units_on_hand":30}}}
← {"result":{"content":[{"type":"text","text":"{\n  \"ok\": true,\n  \"medication_id\": 4,\n  \"times\": [\n    \"09:00\"\n  ]\n}"}]},"jsonrpc":"2.0","id":11}
```

Other responses from the same capture: `resources/list` returns `carecue://schedule/today`, `prompts/list` returns `morning_checkin`, and a wrong bearer on a server without `CARECUE_MCP_TOKEN` returns the same 10 tools as no header.

## What the simulated Alexa+ in `web/` does

Open the live URL. The page is an Echo Show-style device plus a family phone:

1. **Hears and speaks** with the browser's Web Speech API (Chrome): push-to-talk, a light bar, spoken replies with the current word highlighted. There is a typed fallback when the browser has no speech recognition, and an EN / ES (Chile) switch.
2. **Thinks** with Claude: each turn goes to `POST /api/chat`, which runs the voice agent (`src/agent.ts`). The agent is an MCP client of this very server's `/mcp` (Streamable HTTP, the `agent.<id>.<hmac>` token for the household), lists the tools, passes the 10 patient tools to the model and returns the tool results. It never sees `add_medication` or `stop_medication`.
3. **Shows what the server reports.** The big-type scenes (reminder, written down, STOP, check first, emergency, support) are computed on the server from the MCP tool results, the dose log and the person's own words, never from the model's reply text. The "I took it" button is a touch that the server writes through MCP `log_dose` with no model involved. A real Alexa+ device cannot be pushed custom scenes through MCP; on real hardware the same information would arrive as speech.
4. **Shows the protocol.** The **MCP wire** tab lists every `tools/call` with its result, annotations and a `MODEL`, `TOUCH` or `PROBE` tag, the handshake (protocol version, tool count by role from `GET /api/mcp-info`), and three labelled probes that call the server directly with no model: "Log a hedged dose", "Log a dose twice" (the double-dose guard) and "Remove a medicine" (a patient asking for `stop_medication`: the 403 above).
5. **Is private per visitor.** Each page load creates a sandbox household (`POST /api/sandbox`, deleted after 2 idle hours) so nobody else's clicks change your demo.

## Skill path and MCP path side by side

| | Alexa custom skill (`/alexa`) | MCP (`/mcp`) |
|---|---|---|
| Who calls it | Alexa, on any Echo | An MCP host: Alexa+ in principle, any client today |
| Language understanding | Alexa's interaction models (en-US, es-US, es-MX, es-ES) | The host's model, guided by the server instructions |
| Speaks proactively | Yes, with Reminders API reminders (permission asked on the device) | No: the host decides when to call a tool |
| Safety guards | The same `care.ts` code (double-dose guard, certainty, early window) | The same, plus server instructions and role enforcement |
| Tested | SMAPI simulate-skill against the live endpoint; `tests/alexa.ts` | `tests/smoke.ts`, the 60-scenario safety suite |
