// The voice agent behind the simulated Alexa+ device.
// Claude (Amazon Bedrock, or the Claude API as a fallback) + the CareCue MCP server as its only tools.

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { BetaFallbackState, betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk/lib/middleware";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SERVER_INSTRUCTIONS } from "./mcp.ts";
import { agentToken } from "./agent-token.ts";
import { caregiversOf, crisisLine, emergencyNumber, getPatient, todaySchedule } from "./care.ts";
import { now, spokenTime, spokenTimeEs } from "./clock.ts";
import { patientLanguage } from "./households.ts";

// Explicit CARECUE_PROVIDER wins; otherwise a Claude API key is preferred, then AWS credentials.
const useBedrock =
  process.env.CARECUE_PROVIDER === "bedrock" ||
  (!process.env.CARECUE_PROVIDER &&
    !process.env.ANTHROPIC_API_KEY &&
    !!(process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE));

export const provider = useBedrock ? "Amazon Bedrock" : "Claude API";

// On Bedrock, refusals fall back client-side; on the Claude API the server routes them ("fallbacks: default").
const client: Anthropic = useBedrock
  ? (new AnthropicBedrockMantle({
      awsRegion: process.env.AWS_REGION ?? "us-east-1",
      middleware: [betaRefusalFallbackMiddleware([{ model: "anthropic.claude-opus-4-8" }])],
    }) as unknown as Anthropic)
  : new Anthropic({ maxRetries: 4 });

const MODEL = process.env.CARECUE_MODEL ?? (useBedrock ? "anthropic.claude-opus-5-5" : "claude-opus-5-5");

export const SYSTEM = `You are CareCue, a medication companion running on an Alexa+ device in the home of an older adult.
You are speaking out loud. Reply in the language the person just used (the context line's Language is only the household default) in at most two short sentences, plain words, no lists, no markdown, no emoji.
Every turn starts with a context line from the device: clock, person, language, caregivers, emergency number and today's doses. Use it, but use the CareCue tools for anything you change or anything not in it; never rely on memory of earlier turns for what was taken.
Never mention tools, the log, the app, or what you "just checked". Every word of your reply must be in that same language.
Call independent tools in the same step.
Be warm and patient, like a kind neighbor, never childish. Use the person's name at most once per conversation and don't praise ("well done"); in Spanish say "ya lo anoté".
Don't call tools for what the context line already says; use them to change something or to answer from the log.
Whenever you call notify_caregiver or record_checkin, your message must START with the complete spoken reply as plain text, then the tool call; that text is what the person hears. Never start such a message with a tool call. This applies to every turn, including crisis and emergency turns.

${SERVER_INSTRUCTIONS}`;

// ---------- MCP bridge (one client per household) ----------

type Bridge = { client: Client; tools: Anthropic.Tool[] };
// Changing the prescription list is a caregiver action in the app, never a voice action.
const VOICE_BLOCKED = new Set(["add_medication", "stop_medication"]);
// Tools whose result never changes what is said (unless they fail).
const FIRE_AND_SPEAK = new Set(["notify_caregiver", "record_checkin"]);
const bridges = new Map<number, Promise<Bridge>>();

function bridge(patientId: number): Promise<Bridge> {
  let b = bridges.get(patientId);
  if (!b) {
    b = (async () => {
      const url = new URL(process.env.CARECUE_MCP_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}/mcp`);
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${agentToken(patientId)}` } },
      });
      const client = new Client({ name: "carecue-voice-agent", version: "0.2.0" });
      await client.connect(transport);
      const listed = await client.listTools();
      const tools = listed.tools.filter((t) => !VOICE_BLOCKED.has(t.name)).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));
      return { client, tools };
    })();
    b.catch(() => bridges.delete(patientId));
    bridges.set(patientId, b);
  }
  return b;
}

async function callTool(patientId: number, name: string, input: unknown): Promise<{ text: string; isError: boolean }> {
  if (VOICE_BLOCKED.has(name)) return { text: "Not available by voice: the caregiver manages medicines in the app.", isError: true };
  const { client } = await bridge(patientId);
  try {
    const r = await client.callTool({ name, arguments: (input ?? {}) as Record<string, unknown> });
    const text = (r.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { text: text || "(no output)", isError: !!r.isError };
  } catch (err) {
    return { text: `Tool error: ${(err as Error).message}`, isError: true };
  }
}

// ---------- conversations ----------

type Conversation = { messages: Anthropic.MessageParam[]; fallback: BetaFallbackState; lastUsed: number };
const conversations = new Map<string, Conversation>();
const IDLE_RESET_MS = 20 * 60 * 1000;
const MAX_MESSAGES = 60;

function conversation(id: string): Conversation {
  const existing = conversations.get(id);
  // Start fresh after a pause or a long chat; history is never edited, only replaced.
  if (existing && Date.now() - existing.lastUsed < IDLE_RESET_MS && existing.messages.length < MAX_MESSAGES) {
    existing.lastUsed = Date.now();
    return existing;
  }
  const fresh = { messages: [], fallback: new BetaFallbackState(), lastUsed: Date.now() };
  conversations.set(id, fresh);
  return fresh;
}

export function resetConversation(id: string) {
  conversations.delete(id);
}

/** Fresh facts for every turn, so most answers need no tool call (and no guessing). */
const DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

function contextLine(patientId: number): string {
  const p = getPatient(patientId);
  const es = patientLanguage(p) === "es";
  const emergency = emergencyNumber(patientId);
  const caregivers = caregiversOf(patientId).map((c) => `${c.name} (${c.relationship})`).join(", ") || "none";
  const s = todaySchedule(patientId);
  const sp = (t: string) => (es ? spokenTimeEs(t) : spokenTime(t));
  const brief = (list: typeof s.due_now) =>
    list.map((d) => `${d.medication} ${d.dose} at ${sp(d.time)}${d.status === "missed" ? " (late)" : ""}${d.taken_at ? ` taken ${sp(d.taken_at)}` : ""}`).join("; ") || "none";
  return (
    `[Device: clock ${sp(s.now)}, ${DAY.format(now())} | Person: ${p.name} | Household language: ${es ? "Spanish (Chile)" : "English"} | ` +
    `Caregivers: ${caregivers} | Emergency number: ${emergency} | Crisis line: ${crisisLine(patientId)} | Due now: ${brief(s.due_now)} | ` +
    `Next: ${brief(s.next_up)} | Done today: ${brief(s.done_today)}]`
  );
}

export type AgentTurn = { reply: string; toolCalls: Array<{ name: string; input: unknown; isError: boolean }> };

const locks = new Map<string, Promise<unknown>>();

/** Was this turn spoken in Spanish? (Used only for the few fixed fallback sentences.) */
function speaksSpanish(text: string, patientId: number): boolean {
  if (/[¿¡ñáéíóú]|\b(qué|que|me|mi|tomé|pastilla|remedio|hola|sí|gracias|ayuda)\b/i.test(text)) return true;
  if (/\b(the|what|did|my|pill|take|took|thanks|hello)\b/i.test(text)) return false;
  return patientLanguage(getPatient(patientId)) === "es";
}

export function fallbackReply(kind: "unavailable" | "refusal" | "lost", es: boolean, emergency: string): string {
  const en = {
    unavailable: `I can't help right now and I haven't written anything down. If it's an emergency, call ${emergency}; otherwise please tell your family.`,
    refusal: "I can't help with that one. For anything about your health, please ask your doctor or pharmacist.",
    lost: "Sorry, I got a bit lost. Could you say that again?",
  };
  const sp = {
    unavailable: `Ahora no puedo ayudarle y no anoté nada. Si es una emergencia, llame al ${emergency}; si no, avísele a su familia.`,
    refusal: "Con eso no puedo ayudarle. Para cualquier cosa de su salud, pregúntele a su médico o farmacéutico.",
    lost: "Perdón, me confundí. ¿Me lo puede repetir?",
  };
  return (es ? sp : en)[kind];
}

/** Opens the MCP bridge and writes the prompt cache, so the first spoken turn isn't the slow one. */
export async function warmUp(patientId: number): Promise<void> {
  const { tools } = await bridge(patientId);
  const t = Date.now();
  await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools,
    messages: [{ role: "user", content: "ok" }],
    output_config: { effort: "low" },
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);
  console.log(`[agent] warm-up ${Date.now() - t} ms`);
}

/** One turn at a time per conversation: history must stay append-only (thinking blocks are bound to it). */
export function chat(conversationId: string, userText: string, patientId: number): Promise<AgentTurn> {
  const key = `${patientId}:${conversationId}`;
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => chatTurn(key, userText, patientId));
  locks.set(key, run.catch(() => {}));
  return run;
}

async function chatTurn(key: string, userText: string, patientId: number, retried = false): Promise<AgentTurn> {
  const { tools } = await bridge(patientId);
  const convo = conversation(key);
  const toolCalls: AgentTurn["toolCalls"] = [];
  const es = speaksSpanish(userText, patientId);
  const mark = convo.messages.length;

  const turnText = `${contextLine(patientId)}\n${userText}`;
  const last = convo.messages.at(-1);
  // After a turn that was spoken early, the history ends with tool results: the next words join that message.
  const joined = last?.role === "user" && Array.isArray(last.content);
  if (joined) (last.content as Anthropic.ContentBlockParam[]).push({ type: "text", text: turnText });
  else convo.messages.push({ role: "user", content: turnText });
  // Trailing removal keeps the history append-only.
  const rollback = () => {
    convo.messages.length = mark;
    if (joined) (last.content as Anthropic.ContentBlockParam[]).pop();
  };

  const started = Date.now();
  const timing: string[] = [];
  const logTiming = () => console.log(`[agent] turn ${Date.now() - started} ms (${timing.join(", ")})`);

  try {
    for (let step = 0; step < 8; step++) {
      const params = {
        model: MODEL,
        max_tokens: 4000,
        system: [{ type: "text" as const, text: SYSTEM, cache_control: { type: "ephemeral" as const } }],
        tools,
        messages: convo.messages,
        output_config: { effort: "low" as const },
        ...(useBedrock ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      };
      const t = Date.now();
      const response = (await client.beta.messages.create(
        params as Anthropic.Beta.MessageCreateParamsNonStreaming,
        { fallbackState: convo.fallback } as Anthropic.RequestOptions,
      )) as unknown as Anthropic.Message;
      timing.push(`model ${Date.now() - t}`);

      if (response.stop_reason === "refusal") {
        resetConversation(key);
        return { reply: fallbackReply("refusal", es, emergencyNumber(patientId)), toolCalls };
      }

      convo.messages.push({ role: "assistant", content: response.content });

      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || uses.length === 0) {
        const reply = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        logTiming();
        return { reply: reply || fallbackReply("lost", es, emergencyNumber(patientId)), toolCalls };
      }

      const tt = Date.now();
      const results = await Promise.all(
        uses.map(async (u) => {
          const r = await callTool(patientId, u.name, u.input);
          toolCalls.push({ name: u.name, input: u.input, isError: r.isError });
          return { type: "tool_result" as const, tool_use_id: u.id, content: r.text, is_error: r.isError };
        }),
      );
      timing.push(`tools ${Date.now() - tt}`);
      convo.messages.push({ role: "user", content: results });

      // Alert-only steps: the reply written before the tool call is final, so skip the second model call.
      const early = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      if (!early && uses.every((u) => FIRE_AND_SPEAK.has(u.name))) timing.push("no-early-text");
      if (
        early &&
        uses.every((u) => FIRE_AND_SPEAK.has(u.name)) &&
        results.every((r) => !r.is_error)
      ) {
        timing.push("early-reply");
        logTiming();
        return { reply: early, toolCalls };
      }
    }
    rollback(); // drop the unfinished turn so the next one starts from a valid history
    return { reply: fallbackReply("lost", es, emergencyNumber(patientId)), toolCalls };
  } catch (err) {
    rollback();
    const status = (err as { status?: number }).status;
    if (status === 400 && !retried) {
      // A history the API no longer accepts (e.g. thinking-block binding): start this conversation fresh once.
      console.error("[agent] 400, restarting conversation:", (err as Error).message.slice(0, 160));
      resetConversation(key);
      return chatTurn(key, userText, patientId, true);
    }
    throw err;
  }
}
