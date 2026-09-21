#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 <server-port> <base-dir> <mobile-origin> <agent-device-command> <target-args...>" >&2
  exit 2
}

[[ $# -ge 5 ]] || usage

server_port="$1"
base_dir="$2"
mobile_origin="$3"
agent_device_command="$4"
shift 4

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

mobile_identity="$(node --input-type=module - "$@" <<'NODE'
import { PERSONAL_MOBILE_DISTRIBUTION } from "./downstream/mobile-config.ts";
const args = process.argv.slice(2);
const platform = args[args.indexOf("--platform") + 1];
if (platform !== "ios" && platform !== "android") {
  throw new Error("AgentDevice target arguments must include --platform ios or android.");
}
console.log(platform === "ios"
  ? `${PERSONAL_MOBILE_DISTRIBUTION.iosBundleIdentifier}.dev`
  : "com.t3tools.t3code.dev");
NODE
)"

if ! pairing_output="$({
  T3CODE_PORT="$server_port" node apps/server/src/bin.ts auth pairing create \
    --base-dir "$base_dir" \
    --base-url "$mobile_origin" \
    --ttl 15m \
    --label "agent-mobile"
} 2>&1)"; then
  echo "Could not mint a mobile pairing credential." >&2
  exit 1
fi

pairing_url="$(printf '%s\n' "$pairing_output" | sed -n 's/^Pair URL: //p' | tail -n 1)"
if [[ -z "$pairing_url" ]]; then
  echo "Could not parse the mobile pairing URL." >&2
  exit 1
fi

deep_link="$(PAIRING_URL="$pairing_url" node - <<'NODE'
const { PERSONAL_MOBILE_DISTRIBUTION } = require("./downstream/mobile-config.ts");
const query = new URLSearchParams({
  pairingUrl: process.env.PAIRING_URL,
  autoConnect: "1",
});
process.stdout.write(`${PERSONAL_MOBILE_DISTRIBUTION.developmentScheme}://connections/new?${query}`);
NODE
)"

if ! "$agent_device_command" open "$mobile_identity" "$deep_link" "$@" \
  >/dev/null 2>&1; then
  echo "AgentDevice could not open the pairing route. Check the Device panel and retry with a fresh credential." >&2
  exit 1
fi

echo "Opened the existing Add Environment route with a fresh pairing credential."
