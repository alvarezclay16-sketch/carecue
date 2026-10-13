// Sandbox creation counts once against the household-creation limit, a refusal counts nothing, and the per-address
// counter is pruned by the watchdog. In-process, no server, no model: node tests/sandbox-limits.ts

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "carecue-sbl-"));
process.env.CARECUE_DB = path.join(tmp, "t.db");
process.env.CARECUE_DATA_DIR = tmp;
process.env.CARECUE_PUBLIC = "1";
process.env.CARECUE_SANDBOX_IP_HOUR = "2";
process.env.CARECUE_LIMIT_CREATE_IP_HOUR = "5";

const { createSandbox, pruneCreated, createdSize } = await import("../src/sandbox.ts");
const { describe } = await import("../src/limits.ts");

const reqFrom = (ip: string) => ({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": ip } }) as never;
const left = (ip: string) => describe(reqFrom(ip)).detail!.households_per_hour.remaining;

const a = reqFrom("9.9.9.1");
assert.equal(left("9.9.9.1"), 5);
assert.equal((await createSandbox(a)).ok, true);
assert.equal(left("9.9.9.1"), 4, "one sandbox uses one household-creation slot, not two");
assert.equal((await createSandbox(a)).ok, true);
assert.equal(left("9.9.9.1"), 3);
const refused = await createSandbox(a);
assert.ok(!refused.ok && refused.status === 429 && (refused.retry_after_s ?? 0) > 0, "third sandbox in the hour is refused");
assert.equal(left("9.9.9.1"), 3, "a refused sandbox costs no household-creation slot");

// pruning: nothing goes while the entries are fresh; everything goes once they are older than an hour
assert.equal(createdSize(), 1);
assert.equal(pruneCreated(), 0);
assert.equal(createdSize(), 1);
assert.equal(pruneCreated(Date.now() + 3_700_000), 1);
assert.equal(createdSize(), 0, "stale addresses are forgotten");

console.log("ok: sandbox creation counts once; refusals are free; per-address counter is pruned");
rmSync(tmp, { recursive: true, force: true });
process.exit(0);
