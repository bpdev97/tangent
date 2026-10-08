// @effect-diagnostics nodeBuiltinImport:off - The test plays the relay and needs its own signing key.
import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthStandardClientScopes, EnvironmentId } from "@t3tools/contracts";
import { RELAY_MINT_REQUEST_TYP, signRelayJwt } from "@t3tools/shared/relayJwt";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import * as CloudLink from "./CloudLink.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";
import {
  CLOUD_LINKED_USER_ID,
  CLOUD_MINT_PUBLIC_KEY,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "./config.ts";
import { RelayCredentialMinting } from "./relayCredentialMinting.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const RELAY_URL = "https://relay.example.test";
const encode = (value: string) => new TextEncoder().encode(value);

/**
 * Asks a linked server for a credential exactly as the relay would for a
 * signed-in client: a request signed with the relay's own key, for the
 * linked account.
 */
const requestCredentialAsRelay = (layerMinting: Layer.Layer<never>) =>
  Effect.gen(function* () {
    const relayKey = NodeCrypto.generateKeyPairSync("ed25519", {
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    const stored = new Map<string, Uint8Array>([
      [RELAY_URL_SECRET, encode(RELAY_URL)],
      [RELAY_ISSUER_SECRET, encode(RELAY_URL)],
      [CLOUD_LINKED_USER_ID, encode("user-1")],
      [CLOUD_MINT_PUBLIC_KEY, encode(relayKey.publicKey)],
    ]);
    const issued: Array<string | undefined> = [];
    const now = yield* DateTime.now;
    const nowSeconds = Math.floor(now.epochMilliseconds / 1_000);
    const proof = yield* signRelayJwt({
      privateKey: relayKey.privateKey,
      typ: RELAY_MINT_REQUEST_TYP,
      payload: {
        iss: RELAY_URL,
        aud: `t3-env:${ENVIRONMENT_ID}`,
        sub: "user-1",
        jti: "request-1",
        iat: nowSeconds,
        exp: nowSeconds + 60,
        environmentId: ENVIRONMENT_ID,
        clientProofKeyThumbprint: "client-key-thumbprint",
        cnf: { jkt: "client-key-thumbprint" },
        nonce: "nonce-1",
        scope: ["environment:connect"],
      },
    });

    const layerDependencies = Layer.mergeAll(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) => Effect.succeed(Option.fromNullishOr(stored.get(name))),
        set: (name, value) => Effect.sync(() => void stored.set(name, value)),
        create: (name, value) => Effect.sync(() => void stored.set(name, value)),
      }),
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(ENVIRONMENT_ID),
      }),
      Layer.mock(EnvironmentAuth.EnvironmentAuth)({
        createPairingLink: (input) =>
          Effect.sync(() => {
            issued.push(input?.proofKeyThumbprint);
            return {
              id: "pairing-1",
              credential: "ISSUEDCREDENTIAL",
              scopes: AuthStandardClientScopes,
              subject: "cloud-connect",
              createdAt: now,
              expiresAt: DateTime.add(now, { minutes: 2 }),
            };
          }),
      }),
      Layer.mock(AgentAwarenessRelay.AgentAwarenessRelay)({}),
      Layer.mock(ManagedEndpointRuntime.CloudManagedEndpointRuntime)({}),
      Layer.mock(CliTokenManager.CloudCliTokenManager)({}),
      Layer.mock(HttpServer.HttpServer)({
        address: NetAddress.inetAddressFromIpStringUnsafe("127.0.0.1", 3773),
      }),
      Layer.mock(ServerConfig.ServerConfig)({} as ServerConfig.ServerConfig["Service"]),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("unused")),
      ),
      NodeServices.layer,
      layerMinting,
    );
    const result = yield* Effect.gen(function* () {
      const link = yield* CloudLink.CloudLink;
      return yield* link.mintCredential({ proof }).pipe(Effect.result);
    }).pipe(Effect.provide(CloudLink.layer.pipe(Layer.provide(layerDependencies))));
    return { result, issued };
  });

it.effect("refuses a credential the relay asks for, however valid the request", () =>
  Effect.gen(function* () {
    const { result, issued } = yield* requestCredentialAsRelay(Layer.empty);

    assert.strictEqual(result._tag, "Failure");
    assert.strictEqual(
      result._tag === "Failure" ? result.failure._tag : undefined,
      "CloudLinkProofRejectedError",
    );
    assert.deepEqual(issued, []);
  }),
);

it.effect("is the only thing refusing: the same request succeeds with upstream's behavior", () =>
  Effect.gen(function* () {
    const { result, issued } = yield* requestCredentialAsRelay(
      Layer.succeed(RelayCredentialMinting, true),
    );

    assert.strictEqual(result._tag, "Success");
    assert.strictEqual(
      result._tag === "Success" ? result.success.credential : undefined,
      "ISSUEDCREDENTIAL",
    );
    assert.deepEqual(issued, ["client-key-thumbprint"]);
  }),
);
