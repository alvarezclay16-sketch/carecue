// Appends CARECUE_RECORDER_KEY (random) to .env if it is missing. Never prints the value.
// node scripts/ensure-recorder-key.mjs [path-to-.env]
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const file = process.argv[2] ?? new URL("../.env", import.meta.url).pathname;
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
if (/^CARECUE_RECORDER_KEY=.+/m.test(text)) {
  console.log("CARECUE_RECORDER_KEY already present");
} else {
  const sep = text && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(file, `${sep}CARECUE_RECORDER_KEY=${randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
  console.log("CARECUE_RECORDER_KEY added");
}
