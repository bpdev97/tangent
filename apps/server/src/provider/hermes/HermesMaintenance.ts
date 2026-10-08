/**
 * One-click Hermes updates through the shared provider maintenance runner.
 *
 * The command is the gateway-reported `update_command` (install methods
 * differ; a git checkout, Docker, and Nix each report their own), run under
 * the lock key `hermes-native`. The update replaces the install every Hermes
 * instance runs from, so the guard refuses while any Hermes turn is running,
 * stops every instance's gateway, and blocks restarts until the command ends.
 * Gateways restart on their next request, which re-reads version and contract.
 *
 * `hermes update` only follows a branch, so it fails on a checkout pinned to a
 * release tag. That one command therefore runs through
 * `HERMES_RELEASE_UPDATE_SCRIPT`, which moves a pinned checkout to the latest
 * release itself and hands every other install to `hermes update` unchanged.
 *
 * @module provider/hermes/HermesMaintenance
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import {
  ProviderVersionCache,
  type ProviderMaintenanceCapabilities,
  type ProviderMaintenanceCommandAction,
} from "../providerMaintenance.ts";
import type { HermesGatewayInfo, HermesGatewayRuntime } from "./HermesGatewayRuntime.ts";
import {
  HERMES_DRIVER_KIND,
  HermesGatewayError,
  parseHermesReleaseTag,
  parseHermesReleaseVersion,
  parseHermesUpdateCommand,
} from "./HermesGatewaySupport.ts";

export const HERMES_UPDATE_LOCK_KEY = "hermes-native";
const LATEST_RELEASE_URL = "https://api.github.com/repos/NousResearch/hermes-agent/releases/latest";
const LATEST_CACHE_KEY = "github:NousResearch/hermes-agent";
const LATEST_TAG_CACHE_KEY = `${LATEST_CACHE_KEY}#tag`;
const LATEST_CACHE_TTL_MS = 60 * 60 * 1_000;
const LATEST_TIMEOUT_MS = 4_000;
const UPDATING_REASON = "Hermes is updating. Try again when the update finishes.";

const LatestRelease = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  tag_name: Schema.optional(Schema.NullOr(Schema.String)),
});

/**
 * Run as `sh -c <script> <label> <hermes> <latest release tag or "">`.
 *
 * A checkout is pinned when HEAD is detached exactly on a release tag. It moves
 * to the latest release tag, then the package is reinstalled into the
 * environment Hermes runs from, because a release can add packages and entry
 * points that an editable install does not pick up. That environment is the
 * launcher's own interpreter, or the installer's `venv` when the launcher is a
 * shell shim. A failed reinstall puts the checkout back. The snapshot matches
 * the one `hermes update` takes before it changes anything.
 */
const HERMES_RELEASE_UPDATE_SCRIPT = `set -eu
hermes=$1
tag=\${2-}
dir=$("$hermes" --version 2>/dev/null | sed -n 's/^Install directory: //p' | head -n 1)
if [ -z "$dir" ] || git -C "$dir" symbolic-ref -q HEAD >/dev/null 2>&1 \\
  || ! pinned=$(git -C "$dir" describe --tags --exact-match --match 'v[0-9]*' HEAD 2>/dev/null); then
  exec "$hermes" update
fi
if [ -z "$tag" ]; then
  echo "Hermes is pinned to release $pinned, and the latest release could not be read from GitHub." >&2
  exit 1
fi
python=$(sed -n '1s/^#! *//p' "$(command -v "$hermes")" | cut -d ' ' -f 1)
case "\${python##*/}" in
  python*) ;;
  *) python=$dir/venv/bin/python ;;
esac
if [ ! -x "$python" ]; then
  echo "Hermes is pinned to release $pinned, but the Python environment it runs from was not found. Nothing was changed." >&2
  exit 1
fi
if command -v uv >/dev/null 2>&1; then uv=uv; else uv=\${HERMES_HOME:-$HOME/.hermes}/bin/uv; fi
echo "Hermes is pinned to release $pinned. Moving it to $tag."
"$hermes" backup --quick --label pre-update || echo "Pre-update snapshot failed. Continuing." >&2
git -C "$dir" fetch --depth 1 origin tag "$tag"
git -C "$dir" -c advice.detachedHead=false checkout --detach "refs/tags/$tag"
if ! "$uv" pip install --python "$python" --editable "$dir"; then
  git -C "$dir" -c advice.detachedHead=false checkout --detach "refs/tags/$pinned"
  echo "Reinstalling Hermes failed. The checkout is back on $pinned." >&2
  exit 1
fi
echo "Hermes is now on release $tag."
`;

export class HermesUpdateRefusedError extends Schema.TaggedError<HermesUpdateRefusedError>()(
  "HermesUpdateRefusedError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Latest published Hermes Agent release from GitHub, cached for an hour. */
export const fetchHermesLatestRelease = Effect.gen(function* () {
  const cache = yield* ProviderVersionCache;
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const cached = cache.get(LATEST_CACHE_KEY);
  if (cached && cached.expiresAt > now) {
    return { version: cached.version, tag: cache.get(LATEST_TAG_CACHE_KEY)?.version ?? null };
  }
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(
      HttpClientRequest.get(LATEST_RELEASE_URL).pipe(
        HttpClientRequest.setHeader("accept", "application/vnd.github+json"),
      ),
    )
    .pipe(
      Effect.timeoutOption(LATEST_TIMEOUT_MS),
      Effect.orElseSucceed(() => Option.none()),
    );
  let version: string | null = null;
  let tag: string | null = null;
  if (Option.isSome(response) && response.value.status >= 200 && response.value.status < 300) {
    const release = yield* response.value.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(LatestRelease)),
      Effect.orElseSucceed(() => null),
    );
    // Tags are date-shaped (`v2026.9.21`); the release name carries the version.
    version = parseHermesReleaseVersion(release?.name);
    tag = parseHermesReleaseTag(release?.tag_name);
  }
  const expiresAt = now + LATEST_CACHE_TTL_MS;
  cache.set(LATEST_CACHE_KEY, { expiresAt, version });
  cache.set(LATEST_TAG_CACHE_KEY, { expiresAt, version: tag });
  return { version, tag };
});

/** Drain-before-update: see the module comment. */
function makeHermesUpdateGuard(
  fleet: ReadonlySet<HermesGatewayRuntime>,
): NonNullable<ProviderMaintenanceCommandAction["guard"]> {
  return <A, E, R>(run: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const runtimes = Array.from(fleet);
      const unblock = Effect.forEach(runtimes, (runtime) => runtime.blockStarts(null), {
        discard: true,
      });
      yield* Effect.forEach(runtimes, (runtime) => runtime.blockStarts(UPDATING_REASON), {
        discard: true,
      });
      return yield* Effect.gen(function* () {
        const running = yield* Effect.forEach(runtimes, (runtime) => runtime.activeTurns);
        if (running.some((count) => count > 0)) {
          return yield* new HermesUpdateRefusedError({
            detail:
              "A Hermes turn is running. Stop it or wait for it to finish, then update Hermes.",
          });
        }
        yield* Effect.forEach(runtimes, (runtime) => runtime.stop, { discard: true });
        return yield* run;
      }).pipe(Effect.ensuring(unblock));
    });
}

export function hermesMaintenanceCapabilities(input: {
  readonly info: HermesGatewayInfo | null;
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly latestVersion: string | null;
  readonly latestTag: string | null;
  readonly fleet: ReadonlySet<HermesGatewayRuntime>;
}): ProviderMaintenanceCapabilities {
  const command = input.info?.updateCommand ?? null;
  const reported = parseHermesUpdateCommand(command, input.binaryPath);
  const argv =
    reported !== null && command?.trim() === "hermes update"
      ? {
          executable: "/bin/sh",
          args: [
            "-c",
            HERMES_RELEASE_UPDATE_SCRIPT,
            "hermes-update",
            reported.executable,
            input.latestTag ?? "",
          ],
        }
      : reported;
  return {
    provider: HERMES_DRIVER_KIND,
    packageName: null,
    update:
      command === null || argv === null
        ? null
        : {
            command,
            executable: argv.executable,
            args: argv.args,
            lockKey: HERMES_UPDATE_LOCK_KEY,
            env: input.environment,
            guard: makeHermesUpdateGuard(input.fleet),
          },
    latestVersion: input.latestVersion,
  };
}

export const readHermesInfoOrNull = (
  readInfo: Effect.Effect<HermesGatewayInfo | null, HermesGatewayError>,
) =>
  readInfo.pipe(
    Effect.catch((error) =>
      Effect.logWarning("Hermes gateway self-description unavailable", {
        method: error.method,
      }).pipe(Effect.as(null)),
    ),
  );
