// Tangent(FORK-LAN-001): see docs/fork/lan-fallback.md.
import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import { deriveWsBaseUrl } from "../environment/endpoint.ts";
import type { ConnectionCatalogEntry } from "./catalog.ts";
import type { ConnectionAttemptError } from "./model.ts";

export const StoredLanAddresses = Schema.Struct({
  environmentId: EnvironmentId,
  /** Local-network base URLs the host advertised while reached through its saved address. */
  httpBaseUrls: Schema.Array(Schema.String),
  /** The address that connected last; it gets the head start next time. */
  preferredHttpBaseUrl: Schema.optionalKey(Schema.String),
});
export type StoredLanAddresses = typeof StoredLanAddresses.Type;

/**
 * Platform storage for learned local-network addresses. Optional: clients that don't provide it
 * connect through the saved address only. Implementations log storage failures instead of failing.
 */
export class LanAddressBook extends Context.Service<
  LanAddressBook,
  {
    readonly get: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<Option.Option<StoredLanAddresses>>;
    readonly put: (entry: StoredLanAddresses) => Effect.Effect<void>;
  }
>()("@t3tools/client-runtime/connection/lanFallback/LanAddressBook") {}

type BearerAuthorizationInput = Parameters<
  RemoteEnvironmentAuthorization["Service"]["authorizeBearer"]
>[0];

interface BaseUrls {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

/** Tailscale failures usually hang rather than fail, so alternates start after a short head start. */
export const LAN_FALLBACK_HEAD_START_MS = 750;

/** The saved address plus learned alternates, with the address that connected last first. */
export function lanFallbackCandidates(
  saved: BaseUrls,
  stored: StoredLanAddresses | undefined,
): ReadonlyArray<BaseUrls> {
  const candidates = [
    saved,
    ...(stored?.httpBaseUrls ?? [])
      .filter((httpBaseUrl) => httpBaseUrl !== saved.httpBaseUrl)
      .map((httpBaseUrl) => ({ httpBaseUrl, wsBaseUrl: deriveWsBaseUrl(httpBaseUrl) })),
  ];
  const preferred = candidates.findIndex(
    (candidate) => candidate.httpBaseUrl === stored?.preferredHttpBaseUrl,
  );
  return preferred <= 0
    ? candidates
    : [candidates[preferred]!, ...candidates.filter((_, index) => index !== preferred)];
}

/**
 * What to store after connecting, or null when nothing changed. Only the saved address may
 * replace the learned list, so trust never extends from an address the user didn't pair.
 */
export function nextStoredLanAddresses(input: {
  readonly environmentId: EnvironmentId;
  readonly savedHttpBaseUrl: string;
  readonly connectedHttpBaseUrl: string;
  readonly advertisedHttpBaseUrls: ReadonlyArray<string> | undefined;
  readonly stored: StoredLanAddresses | undefined;
}): StoredLanAddresses | null {
  const httpBaseUrls =
    input.connectedHttpBaseUrl === input.savedHttpBaseUrl &&
    input.advertisedHttpBaseUrls !== undefined
      ? input.advertisedHttpBaseUrls
      : (input.stored?.httpBaseUrls ?? []);
  if (httpBaseUrls.length === 0 && input.stored === undefined) return null;
  const next: StoredLanAddresses = {
    environmentId: input.environmentId,
    httpBaseUrls: [...httpBaseUrls],
    preferredHttpBaseUrl: input.connectedHttpBaseUrl,
  };
  const unchanged =
    input.stored !== undefined &&
    input.stored.preferredHttpBaseUrl === next.preferredHttpBaseUrl &&
    input.stored.httpBaseUrls.join("\n") === next.httpBaseUrls.join("\n");
  return unchanged ? null : next;
}

export const make = Effect.gen(function* () {
  const book = yield* Effect.serviceOption(LanAddressBook);

  const stored = (environmentId: EnvironmentId) =>
    (Option.isNone(book) ? Effect.succeedNone : book.value.get(environmentId)).pipe(
      Effect.map(Option.getOrUndefined),
    );

  /**
   * Authorizes through the saved address and any learned local-network addresses at once. The
   * first address to answer as the expected environment wins and the rest are interrupted. When
   * all fail, the saved address's error is reported, exactly as without the fallback.
   */
  const authorizeBearer = Effect.fn("clientRuntime.connection.lanFallback.authorizeBearer")(
    function* (remote: RemoteEnvironmentAuthorization["Service"], input: BearerAuthorizationInput) {
      const candidates = lanFallbackCandidates(input, yield* stored(input.expectedEnvironmentId));
      if (candidates.length === 1) return yield* remote.authorizeBearer(input);

      const headStartOver = yield* Deferred.make<void>();
      const failures = new Map<string, ConnectionAttemptError>();
      const attempts = candidates.map((candidate, index) => {
        const attempt = remote
          .authorizeBearer({ ...input, ...candidate })
          .pipe(
            Effect.tapError((error) =>
              Effect.sync(() => failures.set(candidate.httpBaseUrl, error)),
            ),
          );
        return index === 0
          ? attempt.pipe(Effect.tapError(() => Deferred.succeed(headStartOver, undefined)))
          : Deferred.await(headStartOver).pipe(
              Effect.timeoutOrElse({
                duration: LAN_FALLBACK_HEAD_START_MS,
                orElse: () => Effect.void,
              }),
              Effect.andThen(attempt),
            );
      });
      return yield* Effect.raceAll(attempts).pipe(
        Effect.mapError((error) => failures.get(input.httpBaseUrl) ?? error),
      );
    },
  );

  /** Records which address connected and, through the saved address, what the host advertised. */
  const remember = Effect.fn("clientRuntime.connection.lanFallback.remember")(function* (
    entry: ConnectionCatalogEntry,
    connectedHttpBaseUrl: string,
    descriptor: ExecutionEnvironmentDescriptor,
  ) {
    const profile = Option.getOrUndefined(entry.profile);
    if (
      Option.isNone(book) ||
      entry.target._tag !== "BearerConnectionTarget" ||
      profile?._tag !== "BearerConnectionProfile"
    ) {
      return;
    }
    const next = nextStoredLanAddresses({
      environmentId: entry.target.environmentId,
      savedHttpBaseUrl: profile.httpBaseUrl,
      connectedHttpBaseUrl,
      advertisedHttpBaseUrls: descriptor.lanHttpBaseUrls,
      stored: yield* stored(entry.target.environmentId),
    });
    if (next !== null) yield* book.value.put(next);
  });

  return { authorizeBearer, remember };
});
