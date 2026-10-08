import { EnvironmentId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as HttpClientError from "effect/http/HttpClientError";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import { RELAY_URL_SECRET } from "./config.ts";
import { resolveConnectPairingBase } from "./connectPairing.ts";

const THIS_ENVIRONMENT = EnvironmentId.make("environment-this");
const OTHER_ENVIRONMENT = EnvironmentId.make("environment-other");
const TUNNEL_URL = "https://prod-0123456789abcdef.tunnel.example.test";
const RELAY_LIST_URL = "https://relay.example.test/v1/environments";

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

const descriptor = (environmentId: EnvironmentId) => ({
  environmentId,
  label: "Host",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "0.0.1",
  capabilities: { repositoryIdentity: true },
});

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

const resolve = (options: {
  readonly linked?: boolean;
  readonly signedIn?: boolean;
  readonly relay?: Reply;
  /** What answers at the tunnel address; `null` is a connection that fails. */
  readonly tunnel?: Reply | null;
}) => {
  const requests: Array<{ readonly url: string; readonly authorization: string | undefined }> = [];
  const relay = options.relay ?? {
    status: 200,
    body: {
      environments: [
        tunnelRecord(OTHER_ENVIRONMENT, "prod-ffffffffffffffff.tunnel.example.test"),
        tunnelRecord(THIS_ENVIRONMENT, "prod-0123456789abcdef.tunnel.example.test"),
      ],
    },
  };
  const tunnel =
    options.tunnel === undefined
      ? { status: 200, body: descriptor(THIS_ENVIRONMENT) }
      : options.tunnel;
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
      HttpClient.make((request) => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        const reply = request.url === RELAY_LIST_URL ? relay : tunnel;
        return reply === null
          ? Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request }),
              }),
            )
          : Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                typeof reply.body === "string"
                  ? new Response(reply.body, { status: reply.status })
                  : Response.json(reply.body, { status: reply.status }),
              ),
            );
      }),
    ),
  );
  return resolveConnectPairingBase({ environmentId: THIS_ENVIRONMENT }).pipe(
    Effect.provide(layer),
    Effect.map((result) => ({ result, requests })),
    Effect.mapError((error) => ({ error, requests })),
  );
};

it.effect("pairs through this machine's tunnel, not another linked machine's", () =>
  Effect.gen(function* () {
    const { result, requests } = yield* resolve({});

    assert.deepEqual(result, { baseUrl: TUNNEL_URL, notes: [] });
    assert.deepEqual(requests, [
      { url: RELAY_LIST_URL, authorization: "Bearer cli-access-token" },
      // The probe is anonymous: the relay credential never goes to the tunnel.
      { url: `${TUNNEL_URL}/.well-known/t3/environment`, authorization: undefined },
    ]);
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
    const { error, requests } = yield* resolve({
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
    assert.deepEqual(
      requests.map((request) => request.url),
      [RELAY_LIST_URL],
    );
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

it.effect("makes no link for an address that answers as something else", () =>
  Effect.gen(function* () {
    const otherServer = yield* resolve({
      tunnel: { status: 200, body: descriptor(OTHER_ENVIRONMENT) },
    }).pipe(Effect.flip);
    const notT3 = yield* resolve({ tunnel: { status: 200, body: "<html>hello</html>" } }).pipe(
      Effect.flip,
    );
    const notFound = yield* resolve({ tunnel: { status: 404, body: "not found" } }).pipe(
      Effect.flip,
    );

    for (const { error } of [otherServer, notT3, notFound]) {
      assert.strictEqual(error._tag, "ConnectPairingWrongServerError");
      assert.include(error.message, TUNNEL_URL);
    }
  }),
);

it.effect("still pairs, with a warning, while the tunnel is not up", () =>
  Effect.gen(function* () {
    // 530 is Cloudflare's answer for a tunnel with no connected origin.
    for (const tunnel of [
      { status: 530, body: "error code: 1033" },
      { status: 502, body: "" },
      null,
    ]) {
      const { result } = yield* resolve({ tunnel });

      assert.strictEqual(result.baseUrl, TUNNEL_URL);
      assert.strictEqual(result.notes.length, 1);
      assert.include(result.notes[0], "has not answered yet");
    }
  }),
);
