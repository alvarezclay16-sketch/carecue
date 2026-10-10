// The voice agent behind the simulated Alexa+ device.
// Claude (Amazon Bedrock, or the Claude API as a fallback) + the CareCue MCP server as its only tools.

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { BetaFallbackState, betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk/lib/middleware";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SERVER_INSTRUCTIONS } from "./mcp.ts";
import { agentToken } from "./agent-token.ts";
import { localTime, now, spokenTime } from "./clock.ts";

const useBedrock =
  process.env.CARECUE_PROVIDER === "bedrock" ||
  (!process.env.CARECUE_PROVIDER &&
    !!(process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE));

export const provider = useBedrock ? "Amazon Bedrock" : "Claude API";

// On Bedrock, refusals fall back client-side; on the Claude API the server routes them ("fallbacks: default").
const client: Anthropic = useBedrock
  ? (new AnthropicBedrockMantle({
      awsRegion: process.env.AWS_REGION ?? "us-east-1",
      middleware: [betaRefusalFallbackMiddleware([{ model: "anthropic.claude-opus-4-8" }])],
    }) as unknown as Anthropic)
  : new Anthropic();

const MODEL = process.env.CARECUE_MODEL ?? (useBedrock ? "anthropic.claude-opus-5-5" : "claude-opus-5-5");

const SYSTEM = `You are CareCue, a medication companion running on an Alexa+ device in the home of an older adult.
You talk out loud: answer in 1-3 short sentences, plain words, no lists, no markdown, no emoji.
Reply in the language the person speaks.
Use the CareCue tools for every fact about medicines, doses, times and refills. Do not rely on memory of earlier turns for what was taken: check the log.
When the person says they took their medicine, log it right away, then confirm in one sentence what you logged and what comes next.
Be warm and patient, like a kind neighbor, never childish.

${SERVER_INSTRUCTIONS}`;

// ---------- MCP bridge (one client per household) ----------

type Bridge = { client: Client; tools: Anthropic.Tool[] };
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
      const tools = listed.tools.map((t) => ({
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

export type AgentTurn = { reply: string; toolCalls: Array<{ name: string; input: unknown; isError: boolean }> };

export async function chat(conversationId: string, userText: string, patientId: number): Promise<AgentTurn> {
  const { tools } = await bridge(patientId);
  const convo = conversation(`${patientId}:${conversationId}`);
  const toolCalls: AgentTurn["toolCalls"] = [];

  convo.messages.push({
    role: "user",
    content: `[Device clock: ${spokenTime(localTime(now()))}]\n${userText}`,
  });

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
    const response = (await client.beta.messages.create(
      params as Anthropic.Beta.MessageCreateParamsNonStreaming,
      { fallbackState: convo.fallback } as Anthropic.RequestOptions,
    )) as unknown as Anthropic.Message;

    if (response.stop_reason === "refusal") {
      // Start the next turn clean and give a safe spoken answer.
      resetConversation(`${patientId}:${conversationId}`);
      return {
        reply: "I'm not able to help with that one. For anything about your health, please talk to your doctor or pharmacist.",
        toolCalls,
      };
    }

    convo.messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      return { reply: reply || "Okay.", toolCalls };
    }

    const results = await Promise.all(
      uses.map(async (u) => {
        const r = await callTool(patientId, u.name, u.input);
        toolCalls.push({ name: u.name, input: u.input, isError: r.isError });
        return { type: "tool_result" as const, tool_use_id: u.id, content: r.text, is_error: r.isError };
      }),
    );
    convo.messages.push({ role: "user", content: results });
  }
  return { reply: "Sorry, I got a bit lost there. Could you say that again?", toolCalls };
}
