# Demo video script (target 2:40, English)

Screen: the CareCue simulator full screen (Alexa+ device on the left, Daniel's phone on the right). Voice-over in English. No third-party music; use a royalty-free or original bed.

| Time | On screen | Voice-over / audio |
|---|---|---|
| 0:00–0:12 | Black → title "CareCue" + subtitle "A medication companion for Alexa+" | "Half of people with chronic conditions don't take their medicine as prescribed. For an older adult living alone, the two big risks are simple: forgetting a dose… and taking it twice." |
| 0:12–0:22 | Simulator, clock 7:58 AM, card "Next: Losartan + Metformin at 8 AM" | "Meet Rosa. She's 78, and CareCue lives in her kitchen, on Alexa+." |
| 0:22–0:38 | Click **8:01 AM** → light bar turns amber, device speaks the reminder; phone shows "reminded" | Device audio: "Rosa, it's time for your medicine: Losartan… Metformin, with breakfast. Tell me when you've taken it." |
| 0:38–0:55 | Press mic: "I took my pills." → reply; phone timeline turns green "taken 8:02 AM" | Device: "Got it, Rosa. I logged your Losartan and Metformin. Next is Metformin at 8 PM." |
| 0:55–1:15 | Press mic: "Did I take my Losartan?" → answer. Then: "I'll take another one just in case." → refusal | Device: "Yes, you took it at 8:02 this morning." / "You already took today's Losartan, so please don't take another one." VO: "The double-dose guard lives in code, not in a prompt." |
| 1:15–1:35 | Click **8:01 PM** (reminder), then **8:50 PM** without answering → phone notification drops in | VO: "If Rosa doesn't confirm, CareCue waits. After 45 minutes, it quietly tells her son." Phone toast: "Rosa hasn't confirmed the 8 PM Metformin…" |
| 1:35–1:50 | Press mic: "Sorry, I took it a bit late." → alert on the phone turns "resolved" | VO: "A late confirmation resolves the alert, so Daniel isn't left worrying." |
| 1:50–2:05 | Refill alert on the phone; mic: "I picked up 30 more Losartan." | Device: "Added 30 Losartan. That's about a month of supply." |
| 2:05–2:20 | Switch to ES, mic in Spanish: "¿Qué me toca ahora?" → Spanish answer | VO: "It answers in the language Rosa speaks." |
| 2:20–2:40 | Architecture slide: Alexa+ → MCP (Streamable HTTP, 2025-11-25) → CareCue server; Claude on Amazon Bedrock; tools list | VO: "Under the hood, CareCue is a self-hosted MCP server with twelve tools. Alexa+ — or here, Claude on Amazon Bedrock — calls them to remind, log, guard, and escalate. It never gives medical advice: it only follows the prescription. CareCue. Peace of mind, on the kitchen counter." |

## Recording notes
- Reset the demo first ("Reset demo"), set the window to 1920×1080, Chrome at 100 % zoom.
- Record screen + system audio (the device voice comes from the browser's speech synthesis).
- Keep each spoken command short and clear; re-take any that the speech recognizer mishears.
- Voice-over can be recorded separately and mixed after (−16 LUFS).
