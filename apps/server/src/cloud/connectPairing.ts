/**
 * Tangent(FORK-CONNECT-001): `t3 pair --connect` pairs a device through the
 * public address T3 Connect gives this machine.
 *
 * Tangent's phone does not sign in to T3 Connect. The managed tunnel is a
 * plain HTTPS route to this server, so an ordinary pairing link pointed at it
 * works like one for a LAN or tailnet address. The server never stores that
 * address, so it is read from the relay's list of linked environments with
 * the credential `t3 connect` saved.
 */
import { type EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import {
  type RelayClientEnvironmentRecord,
  RelayListEnvironmentsResponse,
} from "@t3tools/contracts/relay";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ExternalLauncher from "../process/externalLauncher.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import { RELAY_URL_SECRET } from "./config.ts";
import { filterRelayResponse, relayRequestError } from "./relayResponse.ts";

const RELAY_LIST_TIMEOUT = Duration.seconds(15);
const TUNNEL_PROBE_TIMEOUT = Duration.seconds(5);
const WELL_KNOWN_ENVIRONMENT_PATH = "/.well-known/t3/environment";

export class ConnectPairingNotLinkedError extends Schema.TaggedError<ConnectPairingNotLinkedError>()(
  "ConnectPairingNotLinkedError",
  {},
) {
  override get message(): string {
    return "This machine is not linked to T3 Connect. Run `t3 connect`, wait for the server to start, then run `t3 pair --connect` again.";
  }
}

export class ConnectPairingRelayError extends Schema.TaggedError<ConnectPairingRelayError>()(
  "ConnectPairingRelayError",
  { description: Schema.String },
) {
  override get message(): string {
    return `Could not read this machine's T3 Connect address. ${this.description}`;
  }
}

export class ConnectPairingNoAddressError extends Schema.TaggedError<ConnectPairingNoAddressError>()(
  "ConnectPairingNoAddressError",
  {},
) {
  override get message(): string {
    return "T3 Connect has no public address for this machine. A link made with `--publish-only` has no managed tunnel; run `t3 connect` to add one. A new link can take a moment to provision.";
  }
}

export class ConnectPairingWrongServerError extends Schema.TaggedError<ConnectPairingWrongServerError>()(
  "ConnectPairingWrongServerError",
  { baseUrl: Schema.String },
) {
  override get message(): string {
    return `${this.baseUrl} answers, but not as this server, so no pairing link was made. Check \`t3 connect status\`.`;
  }
}

/**
 * The managed tunnel address of one linked environment. A publish-only link
 * reports a manual endpoint, which is the machine's own local origin and no
 * use to another device.
 */
function connectPairingBaseUrl(
  environments: ReadonlyArray<RelayClientEnvironmentRecord>,
  environmentId: EnvironmentId,
): string | null {
  const endpoint = environments.find(
    (environment) => environment.environmentId === environmentId,
  )?.endpoint;
  if (endpoint?.providerKind !== "cloudflare_tunnel") return null;
  try {
    const url = new URL(endpoint.httpBaseUrl);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Who answers at the tunnel address: an environment, nobody yet, or something
 * else. Cloudflare answers 530 while a tunnel has no connected origin and
 * other 5xx codes while one comes up, so a server error means "not there
 * yet", never "someone else".
 */
const probeTunnel = Effect.fn("pair.probeConnectTunnel")(function* (baseUrl: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.get(
    new URL(WELL_KNOWN_ENVIRONMENT_PATH, baseUrl).toString(),
  ).pipe(httpClient.execute, Effect.timeout(TUNNEL_PROBE_TIMEOUT), Effect.option);
  if (Option.isNone(response) || response.value.status >= 500) {
    return { _tag: "unreachable" } as const;
  }
  return yield* HttpClientResponse.filterStatusOk(response.value).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(ExecutionEnvironmentDescriptor)),
    Effect.map(({ environmentId }) => ({ _tag: "environment", environmentId }) as const),
    Effect.orElseSucceed(() => ({ _tag: "other" }) as const),
  );
});

/**
 * The base URL for a pairing link that goes through T3 Connect. An address
 * that answers as anything but this server is refused. One that does not
 * answer yet is used with a warning: the relay is the only source for it, and
 * a tunnel can take a moment to come up.
 */
export const resolveConnectPairingBase = Effect.fn("pair.resolveConnectPairingBase")(
  function* (input: { readonly environmentId: EnvironmentId }) {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const tokens = yield* CliTokenManager.CloudCliTokenManager;
    const httpClient = yield* HttpClient.HttpClient;

    // The link belongs to the relay it was made against, which is the URL the
    // server saved, not whatever this build would use for a new link.
    const relayUrl = yield* secrets.get(RELAY_URL_SECRET).pipe(
      Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes).replace(/\/+$/, ""))),
      Effect.mapError(
        () =>
          new ConnectPairingRelayError({
            description: "The saved T3 Connect link could not be read.",
          }),
      ),
    );
    // A sign-in that exists but cannot be refreshed is not "not linked":
    // sending the owner back through `t3 connect` would not say why.
    const token = yield* tokens.getExisting.pipe(
      Effect.mapError(
        () =>
          new ConnectPairingRelayError({
            description:
              "The saved T3 Connect sign-in could not be refreshed. Run `t3 connect login`, then retry.",
          }),
      ),
    );
    if (Option.isNone(relayUrl) || relayUrl.value === "" || Option.isNone(token)) {
      return yield* new ConnectPairingNotLinkedError();
    }

    const { environments } = yield* HttpClientRequest.get(`${relayUrl.value}/v1/environments`).pipe(
      HttpClientRequest.bearerToken(token.value.accessToken),
      httpClient.execute,
      Effect.flatMap(filterRelayResponse),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(RelayListEnvironmentsResponse)),
      Effect.timeout(RELAY_LIST_TIMEOUT),
      Effect.mapError(
        (cause) => new ConnectPairingRelayError({ description: relayRequestError(cause).message }),
      ),
    );
    const baseUrl = connectPairingBaseUrl(environments, input.environmentId);
    if (baseUrl === null) {
      return yield* new ConnectPairingNoAddressError();
    }

    const answer = yield* probeTunnel(baseUrl);
    if (answer._tag === "unreachable") {
      return {
        baseUrl,
        notes: [
          "The T3 Connect address has not answered yet. A tunnel can take a moment to come up; if pairing fails, check `t3 connect status` and that the server is running.",
        ],
      };
    }
    if (answer._tag === "other" || answer.environmentId !== input.environmentId) {
      return yield* new ConnectPairingWrongServerError({ baseUrl });
    }
    return { baseUrl, notes: [] };
  },
);

/** What `resolveConnectPairingBase` needs beyond an HTTP client. */
export const layerConnectPairing = (config: ServerConfig.ServerConfig["Service"]) =>
  Layer.mergeAll(
    ServerSecretStore.layer,
    CliTokenManager.layer.pipe(
      Layer.provide(ServerSecretStore.layer),
      Layer.provide(ExternalLauncher.layer),
    ),
  ).pipe(Layer.provide(ServerConfig.layer(config)));
