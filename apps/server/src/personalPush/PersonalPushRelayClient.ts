import {
  RelayAgentActivitySnapshotResponse as RelayAgentActivitySnapshotResponseSchema,
  RelayOkResponse,
  type PersonalPushActivityPublishRequest,
  type RelayAgentActivitySnapshotResponse,
  type RelayDeviceRegistrationRequest,
  type RelayLiveActivityRegistrationRequest,
} from "@t3tools/contracts/relay";
import type { ServerSettings } from "@t3tools/contracts/settings";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as Option from "effect/Option";
import type * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ServerSettingsModule from "../serverSettings.ts";

class PersonalPushRelayRequestError extends Data.TaggedError("PersonalPushRelayRequestError")<{
  readonly operation: string;
  readonly status: number | null;
  readonly cause?: unknown;
}> {}

export interface PersonalPushRelayClient {
  readonly configured: boolean;
  readonly relayUrl: string | null;
  readonly registerDevice: (
    body: RelayDeviceRegistrationRequest,
  ) => Effect.Effect<void, PersonalPushRelayRequestError>;
  readonly registerLiveActivity: (
    body: RelayLiveActivityRegistrationRequest,
  ) => Effect.Effect<void, PersonalPushRelayRequestError>;
  readonly snapshot: () => Effect.Effect<
    RelayAgentActivitySnapshotResponse,
    PersonalPushRelayRequestError
  >;
  readonly publish: (
    body: PersonalPushActivityPublishRequest,
  ) => Effect.Effect<void, PersonalPushRelayRequestError>;
}

export type PersonalPushConfig = Pick<
  ServerConfig.ServerConfig["Service"],
  "personalPushRelayUrl" | "personalPushRelayToken"
>;

function configFromServerConfig(config: ServerConfig.ServerConfig["Service"]): PersonalPushConfig {
  return {
    ...(config.personalPushRelayUrl ? { personalPushRelayUrl: config.personalPushRelayUrl } : {}),
    ...(config.personalPushRelayToken
      ? { personalPushRelayToken: config.personalPushRelayToken }
      : {}),
  };
}

export function configFromSettings(
  settings: ServerSettings,
  fallback: PersonalPushConfig = {},
): PersonalPushConfig {
  const saved = settings.personalPushRelay;
  if (!saved.url && !saved.password && !saved.passwordRedacted) return fallback;
  return {
    ...(saved.url ? { personalPushRelayUrl: saved.url } : {}),
    ...(saved.password ? { personalPushRelayToken: saved.password } : {}),
  };
}

export function makeFromRuntime(
  config: ServerConfig.ServerConfig["Service"],
  settingsService: ServerSettingsModule.ServerSettingsService["Service"],
) {
  return settingsService.getSettings.pipe(
    Effect.option,
    Effect.map((settings) =>
      make(
        Option.isSome(settings)
          ? configFromSettings(settings.value, configFromServerConfig(config))
          : configFromServerConfig(config),
      ),
    ),
  );
}

export const makeFromServices = Effect.all([
  ServerConfig.ServerConfig,
  ServerSettingsModule.ServerSettingsService,
]).pipe(Effect.flatMap(([config, settings]) => makeFromRuntime(config, settings)));

export function make(config: PersonalPushConfig): PersonalPushRelayClient {
  const relayUrl = config.personalPushRelayUrl?.trim().replace(/\/+$/g, "") || null;
  const token = config.personalPushRelayToken?.trim() || null;
  const configured = relayUrl !== null && token !== null;

  const request = <S extends Schema.Top>(
    operation: string,
    path: string,
    responseSchema: S,
    options?: { readonly method?: "GET" | "POST"; readonly body?: unknown },
  ): Effect.Effect<S["Type"], PersonalPushRelayRequestError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      if (!relayUrl || !token) {
        return yield* new PersonalPushRelayRequestError({ operation, status: null });
      }
      const client = yield* HttpClient.HttpClient;
      let request =
        options?.method === "POST"
          ? HttpClientRequest.post(`${relayUrl}${path}`)
          : HttpClientRequest.get(`${relayUrl}${path}`);
      request = HttpClientRequest.setHeader(request, "authorization", `Bearer ${token}`);
      if (options?.body !== undefined) {
        request = yield* HttpClientRequest.bodyJson(request, options.body);
      }
      const response = yield* client.execute(request);
      if (response.status < 200 || response.status >= 300) {
        return yield* new PersonalPushRelayRequestError({ operation, status: response.status });
      }
      return yield* HttpClientResponse.schemaBodyJson(responseSchema)(response);
    }).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) =>
        cause instanceof PersonalPushRelayRequestError
          ? cause
          : new PersonalPushRelayRequestError({ operation, status: null, cause }),
      ),
      Effect.provide(FetchHttpClient.layer),
    );

  return {
    configured,
    relayUrl,
    registerDevice: (body) =>
      request("register-device", "/v1/devices", RelayOkResponse, {
        method: "POST",
        body,
      }).pipe(Effect.asVoid),
    registerLiveActivity: (body) =>
      request("register-live-activity", "/v1/live-activities", RelayOkResponse, {
        method: "POST",
        body,
      }).pipe(Effect.asVoid),
    snapshot: () =>
      request("read-snapshot", "/v1/agent-activity", RelayAgentActivitySnapshotResponseSchema),
    publish: (body) =>
      request("publish-activity", "/v1/agent-activities", RelayOkResponse, {
        method: "POST",
        body,
      }).pipe(Effect.asVoid),
  };
}
