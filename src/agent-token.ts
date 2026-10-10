// Short tokens the server's own voice agent uses to call /mcp on behalf of one household.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET = process.env.CARECUE_SECRET ?? randomBytes(32).toString("hex");

export function agentToken(patientId: number): string {
  const sig = createHmac("sha256", SECRET).update(`agent:${patientId}`).digest("base64url");
  return `agent.${patientId}.${sig}`;
}

export function verifyAgentToken(token: string): number | undefined {
  const m = token.match(/^agent\.(\d+)\.([\w-]+)$/);
  if (!m) return undefined;
  const expected = createHmac("sha256", SECRET).update(`agent:${m[1]}`).digest("base64url");
  const a = Buffer.from(m[2]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? Number(m[1]) : undefined;
}
