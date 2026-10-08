// @effect-diagnostics nodeBuiltinImport:off - CLI integration exercises Node HTTP and filesystem boundaries.
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { cli } from "../binCli.ts";
import {
  makePersistedServerRuntimeState,
  persistServerRuntimeState,
} from "../serverRuntimeState.ts";

const layerCli = Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer);

const runCli = (args: ReadonlyArray<string>) => Command.runWith(cli, { version: "0.0.0" })(args);

const withRunningServer = <A, E, R>(run: (baseDir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.callback<NodeHttp.Server>((resume) => {
      const server = NodeHttp.createServer((request, response) => {
        if (request.url !== "/.well-known/t3/environment") {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            environmentId: "pair-connect-test-environment",
            label: "pair-connect-test",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "0.0.1",
            capabilities: { repositoryIdentity: true },
          }),
        );
      });
      server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
    }),
    (server) =>
      Effect.gen(function* () {
        const address = server.address();
        if (address === null || typeof address === "string") {
          return yield* Effect.die(new Error("Expected a TCP address"));
        }
        const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-pair-connect-"));
        yield* persistServerRuntimeState({
          path: NodePath.join(baseDir, "userdata", "server-runtime.json"),
          state: yield* makePersistedServerRuntimeState({
            config: { host: "127.0.0.1", devUrl: undefined },
            port: address.port,
          }),
        });
        return yield* run(baseDir);
      }),
    (server) => Effect.sync(() => server.close()),
  );

it.effect("`t3 pair --connect` on an unlinked machine explains itself and mints nothing", () =>
  withRunningServer((baseDir) =>
    Effect.gen(function* () {
      const exit = yield* runCli(["pair", "--connect", "--base-dir", baseDir]).pipe(Effect.exit);

      assert.isTrue(exit._tag === "Failure");
      const failure = exit._tag === "Failure" ? Cause.squash(exit.cause) : undefined;
      assert.include(String((failure as Error | undefined)?.message), "not linked to T3 Connect");

      yield* runCli(["auth", "pairing", "list", "--base-dir", baseDir, "--json"]);
      const listed = (yield* TestConsole.logLines).findLast(
        (line): line is string => typeof line === "string",
      );
      assert.deepEqual(JSON.parse(listed ?? "null"), []);
    }),
  ).pipe(Effect.provide(layerCli)),
);
