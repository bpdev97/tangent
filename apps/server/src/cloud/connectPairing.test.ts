import { EnvironmentId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import { RELAY_URL_SECRET } from "./config.ts";
import { type ConnectPairingProbe, resolveConnectPairingBase } from "./connectPairing.ts";

const THIS_ENVIRONMENT = EnvironmentId.make("environment-this");
const OTHER_ENVIRONMENT = EnvironmentId.make("environment-other");
const TUNNEL_URL = "https://prod-0123456789abcdef.tunnel.example.test";

const tunnelRecord = (environmentId: EnvironmentId, hostname: string) => ({
  environmentId,
  label: "Host",
  endpoint: {
    httpBaseUrl: `https://${hostname}/`,
    wsBaseUrl: `wss://${hostname}/ws`,
    providerKind: "cloudflare_tunnel",
  },
  linkedAt: "2026-10-07T00:00:00.000Z",
});

type Probe = (baseUrl: string) => Effect.Effect<ConnectPairingProbe>;

const answersAs =
  (environmentId: EnvironmentId): Probe =>
  () =>
    Effect.succeed({ _tag: "descriptor", descriptor: { environmentId } });

const resolve = (options: {
  readonly linked?: boolean;
  readonly signedIn?: boolean;
  readonly relay?: { readonly status: number; readonly body: unknown };
  readonly probe?: Probe;
}) => {
  const requests: Array<{ readonly url: string; readonly authorization: string | undefined }> = [];
  const probed: Array<string> = [];
  const probe = options.probe ?? answersAs(THIS_ENVIRONMENT);
  const layer = Layer.mergeAll(
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: (name) =>
        Effect.succeed(
          name === RELAY_URL_SECRET && options.linked !== false
            ? Option.some(new TextEncoder().encode("https://relay.example.test/"))
            : Option.none(),
        ),
    }),
    Layer.mock(CliTokenManager.CloudCliTokenManager)({
      getExisting: Effect.succeed(
        options.signedIn === false
          ? Option.none()
          : Option.some({
              accessToken: "cli-access-token",
              refreshToken: "cli-refresh-token",
              expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
            }),
      ),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push({ url: request.url, authorization: request.headers.authorization });
          const relay = options.relay ?? {
            status: 200,
            body: {
              environments: [
                tunnelRecord(OTHER_ENVIRONMENT, "prod-ffffffffffffffff.tunnel.example.test"),
                tunnelRecord(THIS_ENVIRONMENT, "prod-0123456789abcdef.tunnel.example.test"),
              ],
            },
          };
          return HttpClientResponse.fromWeb(
            request,
            Response.json(relay.body, { status: relay.status }),
          );
        }),
      ),
    ),
  );
  return resolveConnectPairingBase({
    environmentId: THIS_ENVIRONMENT,
    probe: (baseUrl) => {
      probed.push(baseUrl);
      return probe(baseUrl);
    },
  }).pipe(
    Effect.provide(layer),
    Effect.map((result) => ({ result, requests, probed })),
    Effect.mapError((error) => ({ error, requests, probed })),
  );
};

it.effect("pairs through this machine's tunnel, not another linked machine's", () =>
  Effect.gen(function* () {
    const { result, requests, probed } = yield* resolve({});

    assert.deepEqual(result, { baseUrl: TUNNEL_URL, notes: [] });
    assert.deepEqual(requests, [
      {
        url: "https://relay.example.test/v1/environments",
        authorization: "Bearer cli-access-token",
      },
    ]);
    assert.deepEqual(probed, [TUNNEL_URL]);
  }),
);

it.effect("asks for `t3 connect` before contacting the relay when the machine is not linked", () =>
  Effect.gen(function* () {
    const neverLinked = yield* resolve({ linked: false }).pipe(Effect.flip);
    const signedOut = yield* resolve({ signedIn: false }).pipe(Effect.flip);

    assert.strictEqual(neverLinked.error._tag, "ConnectPairingNotLinkedError");
    assert.strictEqual(signedOut.error._tag, "ConnectPairingNotLinkedError");
    assert.include(neverLinked.error.message, "t3 connect");
    assert.deepEqual([...neverLinked.requests, ...signedOut.requests], []);
  }),
);

it.effect("refuses a publish-only link, whose address is the machine's own origin", () =>
  Effect.gen(function* () {
    const { error, probed } = yield* resolve({
      relay: {
        status: 200,
        body: {
          environments: [
            {
              ...tunnelRecord(THIS_ENVIRONMENT, "ignored.example.test"),
              endpoint: {
                httpBaseUrl: "http://127.0.0.1:3773/",
                wsBaseUrl: "ws://127.0.0.1:3773/ws",
                providerKind: "manual",
              },
            },
          ],
        },
      },
    }).pipe(Effect.flip);

    assert.strictEqual(error._tag, "ConnectPairingNoAddressError");
    assert.deepEqual(probed, []);
  }),
);

it.effect("reports no address when the relay does not list this machine", () =>
  Effect.gen(function* () {
    const { error } = yield* resolve({
      relay: {
        status: 200,
        body: {
          environments: [tunnelRecord(OTHER_ENVIRONMENT, "prod-ffffffffffffffff.example.test")],
        },
      },
    }).pipe(Effect.flip);

    assert.strictEqual(error._tag, "ConnectPairingNoAddressError");
  }),
);

it.effect("passes on the relay's own explanation when the sign-in was revoked", () =>
  Effect.gen(function* () {
    const { error } = yield* resolve({
      relay: {
        status: 401,
        body: {
          _tag: "RelayAuthInvalidError",
          code: "auth_invalid",
          reason: "invalid_bearer",
          traceId: "trace-auth",
        },
      },
    }).pipe(Effect.flip);

    assert.strictEqual(error._tag, "ConnectPairingRelayError");
    assert.include(error.message, "t3 connect login");
    assert.notInclude(error.message, "cli-access-token");
  }),
);

it.effect("makes no link for an address that reaches a different server", () =>
  Effect.gen(function* () {
    const otherServer = yield* resolve({ probe: answersAs(OTHER_ENVIRONMENT) }).pipe(Effect.flip);
    const notT3 = yield* resolve({
      probe: () => Effect.succeed({ _tag: "not-a-t3-server" }),
    }).pipe(Effect.flip);

    assert.strictEqual(otherServer.error._tag, "ConnectPairingWrongServerError");
    assert.strictEqual(notT3.error._tag, "ConnectPairingWrongServerError");
    assert.include(otherServer.error.message, TUNNEL_URL);
  }),
);

it.effect("still pairs, with a warning, while a new tunnel has not answered yet", () =>
  Effect.gen(function* () {
    const { result } = yield* resolve({
      probe: () => Effect.succeed({ _tag: "unreachable" }),
    });

    assert.strictEqual(result.baseUrl, TUNNEL_URL);
    assert.strictEqual(result.notes.length, 1);
    assert.include(result.notes[0], "has not answered yet");
  }),
);
