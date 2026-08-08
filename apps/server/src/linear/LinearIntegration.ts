import * as NodeCrypto from "node:crypto";

import type {
  LinearConnectionTestResult,
  LinearPrDestinationResolution,
  LinearPrDestinationResolutionStatus,
  LinearResolvePrDestinationsInput,
  ServerSettings,
} from "@t3tools/contracts";
import {
  linearReviewUrlForGitHubPullRequest,
  normalizeLinearReviewRepository,
  parseGitHubPullRequestUrl,
  type GitHubPullRequestLocator,
} from "@t3tools/shared/linear";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import * as ServerSettingsModule from "../serverSettings.ts";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const CACHE_CAPACITY = 1_024;
const SUCCESS_TTL = Duration.hours(1);
const NO_DESTINATION_TTL = Duration.minutes(5);
const FAILURE_BASE_TTL = Duration.seconds(20);
const FAILURE_MAX_TTL = Duration.minutes(15);

const AttachmentIssue = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

const AttachmentsForUrlResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        attachmentsForURL: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              issue: Schema.NullOr(AttachmentIssue),
            }),
          ),
        }),
      }),
    ),
  ),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.String,
      }),
    ),
  ),
});

const OrganizationResponse = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        organization: Schema.Struct({
          name: Schema.String,
        }),
      }),
    ),
  ),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.String,
      }),
    ),
  ),
});

const decodeAttachmentsForUrlResponse = Schema.decodeUnknownEffect(AttachmentsForUrlResponse);
const decodeOrganizationResponse = Schema.decodeUnknownEffect(OrganizationResponse);

const ATTACHMENTS_QUERY = `
  query T3LinearDestinations($url: String!) {
    attachmentsForURL(url: $url) {
      nodes {
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  }
`;

const ORGANIZATION_QUERY = `
  query T3LinearConnectionTest {
    organization {
      name
    }
  }
`;

type LinearRequestFailure =
  | { readonly kind: "unauthorized"; readonly status: number }
  | { readonly kind: "rate_limited"; readonly status: number }
  | { readonly kind: "unreachable" }
  | { readonly kind: "invalid_response"; readonly status?: number };

type CachedResolution = {
  readonly resolution: LinearPrDestinationResolution;
  readonly failureStatus: LinearPrDestinationResolutionStatus | null;
};

function isTransientFailureStatus(status: LinearPrDestinationResolutionStatus): boolean {
  return status === "rate_limited" || status === "unreachable" || status === "invalid_response";
}

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= CACHE_CAPACITY) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

export function linearFailureTtl(consecutiveFailures: number): Duration.Duration {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const backoffMs = Duration.toMillis(FAILURE_BASE_TTL) * Math.pow(2, exponent);
  return Duration.min(Duration.millis(backoffMs), FAILURE_MAX_TTL);
}

function configuredReviewRepositories(settings: ServerSettings): ReadonlySet<string> {
  return new Set(
    settings.linearIntegration.reviewRepositories.flatMap((repository) => {
      const normalized = normalizeLinearReviewRepository(repository);
      return normalized === null ? [] : [normalized];
    }),
  );
}

function reviewDestination(
  locator: GitHubPullRequestLocator,
  settings: ServerSettings,
): LinearPrDestinationResolution["review"] {
  const url = linearReviewUrlForGitHubPullRequest(
    locator.canonicalUrl,
    settings.linearIntegration.reviewRepositories,
  );
  return url === null ? null : { url };
}

function settingsFingerprint(settings: ServerSettings): string {
  const repositories = [...configuredReviewRepositories(settings)].sort();
  return NodeCrypto.createHash("sha256")
    .update(settings.linearIntegration.apiKey)
    .update("\0")
    .update(repositories.join("\0"))
    .digest("base64url");
}

function resolutionFailure(
  failure: LinearRequestFailure,
  review: LinearPrDestinationResolution["review"],
): LinearPrDestinationResolution {
  const status = "status" in failure ? failure.status : undefined;
  return {
    status: failure.kind,
    tickets: [],
    review,
    stale: false,
    ...(status === undefined ? {} : { httpStatus: status }),
  };
}

function testFailure(failure: LinearRequestFailure): LinearConnectionTestResult {
  const status = "status" in failure ? failure.status : undefined;
  return {
    ok: false,
    workspaceName: null,
    failure: failure.kind,
    ...(status === undefined ? {} : { status }),
  };
}

export class LinearIntegration extends Context.Service<
  LinearIntegration,
  {
    readonly resolvePrDestinations: (
      input: LinearResolvePrDestinationsInput,
    ) => Effect.Effect<LinearPrDestinationResolution>;
    readonly testConnection: Effect.Effect<LinearConnectionTestResult>;
  }
>()("t3/linear/LinearIntegration") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const settingsService = yield* ServerSettingsModule.ServerSettingsService;

  const request = (input: {
    readonly apiKey: string;
    readonly query: string;
    readonly variables?: Readonly<Record<string, unknown>>;
  }): Effect.Effect<unknown, LinearRequestFailure> =>
    Effect.gen(function* () {
      const request = HttpClientRequest.post(LINEAR_GRAPHQL_URL).pipe(
        HttpClientRequest.setHeader("authorization", input.apiKey),
        HttpClientRequest.bodyJsonUnsafe({
          query: input.query,
          variables: input.variables ?? {},
        }),
      );
      const response = yield* httpClient.execute(request).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError(() => ({ kind: "unreachable" as const })),
      );
      if (response.status === 401 || response.status === 403) {
        return yield* Effect.fail({ kind: "unauthorized" as const, status: response.status });
      }
      if (response.status === 429) {
        return yield* Effect.fail({ kind: "rate_limited" as const, status: response.status });
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail({ kind: "invalid_response" as const, status: response.status });
      }
      return yield* response.json.pipe(
        Effect.mapError(() => ({ kind: "invalid_response" as const, status: response.status })),
      );
    });

  const readFresh = Effect.fn("LinearIntegration.readFresh")(function* (
    locator: GitHubPullRequestLocator,
    settings: ServerSettings,
  ) {
    const review = reviewDestination(locator, settings);
    const response = yield* Effect.result(
      request({
        apiKey: settings.linearIntegration.apiKey,
        query: ATTACHMENTS_QUERY,
        variables: { url: locator.canonicalUrl },
      }),
    );
    if (Result.isFailure(response)) return resolutionFailure(response.failure, review);
    const decoded = yield* decodeAttachmentsForUrlResponse(response.success).pipe(Effect.option);
    if (decoded._tag === "None" || decoded.value.errors?.length || !decoded.value.data) {
      return resolutionFailure({ kind: "invalid_response" }, review);
    }
    const tickets = [
      ...new Map(
        decoded.value.data.attachmentsForURL.nodes.flatMap((attachment) => {
          const issue = attachment.issue;
          return issue === null ? [] : [[issue.id, issue] as const];
        }),
      ).values(),
    ].sort((left, right) => left.identifier.localeCompare(right.identifier));
    return {
      status: "resolved" as const,
      tickets,
      review,
      stale: false,
    } satisfies LinearPrDestinationResolution;
  });

  const lastSuccessByKey = new Map<string, LinearPrDestinationResolution>();
  const failureStreakByKey = new Map<string, number>();

  const cachedResolution = yield* Cache.makeWith(
    (key: string) =>
      Effect.gen(function* () {
        const separatorIndex = key.indexOf("\0");
        const prUrl = separatorIndex < 0 ? "" : key.slice(separatorIndex + 1);
        const locator = parseGitHubPullRequestUrl(prUrl);
        if (locator === null) {
          return {
            resolution: {
              status: "invalid_pr" as const,
              tickets: [],
              review: null,
              stale: false,
            } satisfies LinearPrDestinationResolution,
            failureStatus: "invalid_pr",
          } satisfies CachedResolution;
        }
        const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
        if (!settings.linearIntegration.apiKey) {
          return {
            resolution: {
              status: "not_configured" as const,
              tickets: [],
              review: null,
              stale: false,
            } satisfies LinearPrDestinationResolution,
            failureStatus: "not_configured",
          } satisfies CachedResolution;
        }
        const fresh = yield* readFresh(locator, settings);
        if (fresh.status === "resolved") {
          failureStreakByKey.delete(key);
          boundedSet(lastSuccessByKey, key, fresh);
          return { resolution: fresh, failureStatus: null } satisfies CachedResolution;
        }
        const lastSuccess = isTransientFailureStatus(fresh.status)
          ? lastSuccessByKey.get(key)
          : undefined;
        return {
          resolution: lastSuccess === undefined ? fresh : { ...lastSuccess, stale: true },
          failureStatus: fresh.status,
        } satisfies CachedResolution;
      }),
    {
      capacity: CACHE_CAPACITY,
      timeToLive: (exit, key) => {
        if (!Exit.isSuccess(exit)) return Duration.zero;
        const cached = exit.value;
        if (cached.failureStatus === null) {
          failureStreakByKey.delete(key);
          return cached.resolution.tickets.length > 0 || cached.resolution.review !== null
            ? SUCCESS_TTL
            : NO_DESTINATION_TTL;
        }
        if (!isTransientFailureStatus(cached.failureStatus)) {
          failureStreakByKey.delete(key);
          return NO_DESTINATION_TTL;
        }
        const streak = (failureStreakByKey.get(key) ?? 0) + 1;
        boundedSet(failureStreakByKey, key, streak);
        return linearFailureTtl(streak);
      },
    },
  );

  const resolvePrDestinations = Effect.fn("LinearIntegration.resolvePrDestinations")(function* (
    input: LinearResolvePrDestinationsInput,
  ) {
    const locator = parseGitHubPullRequestUrl(input.prUrl);
    if (locator === null) {
      return {
        status: "invalid_pr" as const,
        tickets: [],
        review: null,
        stale: false,
      } satisfies LinearPrDestinationResolution;
    }
    const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
    if (!settings.linearIntegration.apiKey) {
      return {
        status: "not_configured" as const,
        tickets: [],
        review: null,
        stale: false,
      } satisfies LinearPrDestinationResolution;
    }
    const key = `${settingsFingerprint(settings)}\0${locator.canonicalUrl}`;
    if (input.refresh) yield* Cache.invalidate(cachedResolution, key);
    return (yield* Cache.get(cachedResolution, key)).resolution;
  });

  const testConnection = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(Effect.orDie);
    if (!settings.linearIntegration.apiKey) {
      return {
        ok: false,
        workspaceName: null,
        failure: "not_configured" as const,
      } satisfies LinearConnectionTestResult;
    }
    const response = yield* Effect.result(
      request({
        apiKey: settings.linearIntegration.apiKey,
        query: ORGANIZATION_QUERY,
      }),
    );
    if (Result.isFailure(response)) return testFailure(response.failure);
    const decoded = yield* decodeOrganizationResponse(response.success).pipe(Effect.option);
    if (decoded._tag === "None" || decoded.value.errors?.length || !decoded.value.data) {
      return testFailure({ kind: "invalid_response" });
    }
    return {
      ok: true,
      workspaceName: decoded.value.data.organization.name,
    } satisfies LinearConnectionTestResult;
  });

  return { resolvePrDestinations, testConnection } satisfies LinearIntegration["Service"];
});

export const layer = Layer.effect(LinearIntegration, make);
