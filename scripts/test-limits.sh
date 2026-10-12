#!/bin/sh
# Starts throwaway servers (no model credentials, temp DBs, tiny limits) and runs tests/limits.ts.
#   scripts/test-limits.sh [base-port]      default 8811 (uses base+1 .. base+3; base itself for the boot-refusal check)
cd "$(dirname "$0")/.." || exit 1
BASE=${1:-8811}
NODE=$(command -v node)
T=$(mktemp -d)
KEY=$(node -e 'console.log(require("crypto").randomBytes(16).toString("hex"))')
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; rm -rf "$T"; }
trap cleanup EXIT

run() { # port, name, env...
  port=$1; name=$2; shift 2
  mkdir -p "$T/$name"
  env -i PATH="$PATH" HOME="$HOME" PORT="$port" CARECUE_DB="$T/$name/db" CARECUE_DATA_DIR="$T/$name" ALEXA_SKIP_VERIFY=1 \
    CARECUE_PUBLIC=1 CARECUE_FAKE_AGENT=1 "$@" "$NODE" src/server.ts > "$T/$name.log" 2>&1 &
  PIDS="$PIDS $!"
}

# the server refuses to boot with CARECUE_EVAL and CARECUE_PUBLIC together
env -i PATH="$PATH" HOME="$HOME" PORT="$BASE" CARECUE_DB="$T/eval.db" CARECUE_DATA_DIR="$T" CARECUE_PUBLIC=1 CARECUE_EVAL=1 "$NODE" src/server.ts > "$T/eval.log" 2>&1
code=$?
if [ "$code" -eq 0 ] || ! grep -q "Refusing to start" "$T/eval.log"; then echo "FAIL: boot with EVAL+PUBLIC was not refused (exit $code)"; exit 1; fi
echo "ok: CARECUE_EVAL + CARECUE_PUBLIC refuses to boot"

M=$((BASE+1)); C=$((BASE+2)); P=$((BASE+3))
run $M main CARECUE_RECORDER_KEY="$KEY" CARECUE_LIMIT_IP_BURST=3 CARECUE_LIMIT_IP_DAY=50 CARECUE_LIMIT_TOKEN_DAY=4 \
  CARECUE_LIMIT_CREATE_IP_HOUR=3 CARECUE_LIMIT_URGENT_IP_DAY=2 CARECUE_LIMIT_MCP_IP_MIN=6
run $C caps CARECUE_LIMIT_IP_DAY=2 CARECUE_LIMIT_IP_BURST=100 CARECUE_LIMIT_GLOBAL_DAY=3
run $P paused CARECUE_AGENT_PAUSED=1
for port in $M $C $P; do
  i=0; until curl -sf "http://127.0.0.1:$port/health" > /dev/null; do i=$((i+1)); [ $i -gt 50 ] && { echo "server on $port did not start"; cat "$T"/*.log; exit 1; }; sleep 0.2; done
done

CARECUE_RECORDER_KEY="$KEY" LIMITS_DATA_DIR="$T/main" "$NODE" tests/limits.ts "http://127.0.0.1:$M" "http://127.0.0.1:$C" "http://127.0.0.1:$P"
