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
 * @module provider/hermes/HermesMaintenance
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  ProviderVersionCache,
  type ProviderMaintenanceCapabilities,
  type ProviderMaintenanceCommandAction,
} from "../providerMaintenance.ts";
import type { HermesGatewayInfo, HermesGatewayRuntime } from "./HermesGatewayRuntime.ts";
import {
  HERMES_DRIVER_KIND,
  HermesGatewayError,
  parseHermesReleaseVersion,
  parseHermesUpdateCommand,
} from "./HermesGatewaySupport.ts";

export const HERMES_UPDATE_LOCK_KEY = "hermes-native";
const LATEST_RELEASE_URL = "https://api.github.com/repos/NousResearch/hermes-agent/releases/latest";
const LATEST_CACHE_KEY = "github:NousResearch/hermes-agent";
const LATEST_CACHE_TTL_MS = 60 * 60 * 1_000;
const LATEST_TIMEOUT_MS = 4_000;
const UPDATING_REASON = "Hermes is updating. Try again when the update finishes.";

const LatestRelease = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

export class HermesUpdateRefusedError extends Schema.TaggedError<HermesUpdateRefusedError>()(
  "HermesUpdateRefusedError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Latest published Hermes Agent version from GitHub releases, cached for an hour. */
export const fetchHermesLatestVersion = Effect.gen(function* () {
  const cache = yield* ProviderVersionCache;
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const cached = cache.get(LATEST_CACHE_KEY);
  if (cached && cached.expiresAt > now) return cached.version;
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
  if (Option.isSome(response) && response.value.status >= 200 && response.value.status < 300) {
    const release = yield* response.value.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(LatestRelease)),
      Effect.orElseSucceed(() => null),
    );
    // Tags are date-shaped (`v2026.9.21`); the release name carries the version.
    version = parseHermesReleaseVersion(release?.name);
  }
  cache.set(LATEST_CACHE_KEY, { expiresAt: now + LATEST_CACHE_TTL_MS, version });
  return version;
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
  readonly fleet: ReadonlySet<HermesGatewayRuntime>;
}): ProviderMaintenanceCapabilities {
  const command = input.info?.updateCommand ?? null;
  const argv = parseHermesUpdateCommand(command, input.binaryPath);
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
