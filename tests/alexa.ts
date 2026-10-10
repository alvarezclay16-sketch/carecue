// Drives the Alexa skill endpoint with fake requests (server must run with ALEXA_SKIP_VERIFY=1).
// node tests/alexa.ts [baseUrl]

import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:8787";
const userId = `amzn1.ask.account.TEST${Date.now()}`;

const json = (p: string, body: unknown, token?: string) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());

function envelope(locale: string, request: Record<string, unknown>) {
  return {
    version: "1.0",
    session: { new: false, sessionId: "s1", application: { applicationId: "amzn1.ask.skill.test" }, user: { userId } },
    context: {
      System: {
        application: { applicationId: "amzn1.ask.skill.test" },
        user: { userId },
        device: { deviceId: "d1", supportedInterfaces: {} },
        apiEndpoint: "https://api.amazonalexa.com",
        apiAccessToken: "x",
      },
    },
    request: { requestId: "r1", timestamp: new Date().toISOString(), locale, ...request },
  };
}

const intent = (locale: string, name: string, slots: Record<string, string> = {}) =>
  json(
    "/alexa",
    envelope(locale, {
      type: "IntentRequest",
      intent: { name, confirmationStatus: "NONE", slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, value: v }])) },
    }),
  );
const say = (r: { response: { outputSpeech?: { ssml?: string } } }) => r.response.outputSpeech?.ssml?.replace(/<\/?speak>/g, "") ?? "";

// A family creates a household in the app and adds medicines (in Spanish).
const h = await json("/api/app/households", { patientName: "Rosa", caregiverName: "Daniel", relationship: "hijo", phone: "+56900000000", language: "es" });
assert.ok(h.token);
await json("/api/app/medications", { name: "Losartán", dose: "50 mg, 1 comprimido", times: ["08:00"], units_on_hand: 30 }, h.token);
await json("/api/app/medications", { name: "Metformina", dose: "850 mg", times: ["08:00", "20:00"], units_on_hand: 4 }, h.token);

// Alexa before linking asks for the code.
let r = await json("/alexa", envelope("es-US", { type: "LaunchRequest" }));
console.log("launch (unlinked):", say(r));
assert.match(say(r), /código/);

const { code } = await json("/api/app/pair-codes", { target: "alexa" }, h.token);
r = await intent("es-US", "LinkDeviceIntent", { code });
console.log("link:", say(r));
assert.match(say(r), /conectado/);

r = await intent("es-US", "WhatsNextIntent");
console.log("next:", say(r));

await json("/api/clock", { time: "08:05" });
r = await intent("es-US", "TookMedsIntent");
console.log("took:", say(r));
assert.match(say(r), /anoté/);

r = await intent("es-US", "TookMedsIntent", { medication: "losartan" });
console.log("double:", say(r));
assert.match(say(r), /no te tomes otra/);

r = await intent("es-US", "DidITakeIntent", { medication: "metformina" });
console.log("did I:", say(r));
assert.match(say(r), /Sí/);

r = await intent("es-US", "RefillIntent");
console.log("refill:", say(r));

r = await intent("es-US", "FeelingIntent", { feeling: "un poco mareada" });
console.log("feeling:", say(r));

const state = await fetch(base + "/api/app/state", { headers: { authorization: `Bearer ${h.token}` } }).then((x) => x.json());
assert.equal(state.alexa_linked, true);
assert.ok(state.alerts.some((a: { kind: string }) => a.kind === "wellbeing"));
console.log("caregiver sees", state.alerts.length, "alerts; adherence", state.adherence.adherence_percent);

// English locale for the same account.
r = await intent("en-US", "WhatsNextIntent");
console.log("en next:", say(r));

await json("/api/clock", { reset: true });
console.log("\nALEXA CHECKS PASSED");
