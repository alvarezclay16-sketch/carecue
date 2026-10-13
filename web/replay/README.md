# Replay of a real run

`tour.json` is what the public demo plays when the live model cannot be used: the visitor is rate limited, the demo is
paused, the model is not configured or not answering, a step takes longer than 25 s, or the "missed dose" set-up needs
more past time than today has (just after midnight). The page then shows the badge
**Replay of a real run (the live demo is resting)** and draws the recorded answers through the same renderers it uses for a
live turn (device scene, captions, MCP wire entries, Daniel's phone). Nothing in it is written by hand.

## How it is made

`video/record-replay.mjs` opens the page of a LOCAL server that uses the real agent, runs "Play Rosa's day" and the Spanish
scenario, and writes this file. It refuses to write unless every step ran live, so a recording never contains a replay.

    env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN PORT=8904 CARECUE_DB=<tmp db> node --env-file=.env src/server.ts
    node video/record-replay.mjs http://localhost:8904

## Format (version 1)

    { "version": 1, "recorded_at": ISO time, "note": text, "model": {provider, id}, "duration_s": n, "steps": [ ... ] }

| step kind | fields | what the page does |
|-----------|--------|--------------------|
| `setup` (`morning`, `missed`) | `scenario`, `scene`, `alert` | shows the scene the set-up produced; for `missed`, drops Daniel's alert on the phone |
| `touch` (`took`) | `reply`, `response` | the "I took it" button: the server's `log_dose` answer (TOUCH chip on the wire) |
| `say` (`hedged`, `extra`, `chest`, `spanish`) | `text`, `reply`, `response`, `unchanged`, `lang?` | one real model turn: the words, the server's full answer (tool calls, scene) and the wire's "dose log unchanged" chip |

`id`s map to the five chips: `extra`, `hedged`, `missed`, `chest`, `spanish`; the tour uses `morning`, `hedged`, `took`,
`extra`, `missed`, `chest`. A step with `lang: "es"` is shown in Spanish.
