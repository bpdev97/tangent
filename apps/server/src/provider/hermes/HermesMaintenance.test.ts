import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { HermesSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { enrichProviderSnapshotWithVersionAdvisory } from "../providerMaintenance.ts";
import {
  HermesGatewayFleet,
  makeHermesGatewayRuntime,
  type HermesGatewayRuntime,
} from "./HermesGatewayRuntime.ts";
import { HERMES_DRIVER_KIND } from "./HermesGatewaySupport.ts";
import type { HermesGatewayUtility } from "./HermesGatewayUtility.ts";
import { HERMES_UPDATE_LOCK_KEY, hermesMaintenanceCapabilities } from "./HermesMaintenance.ts";
import { checkHermesProviderStatus } from "./HermesProvider.ts";

/**
 * A fake `hermes`: logs each invocation, reports a version, "updates", and
 * serves by printing the ready sentinel and sleeping (nothing listens on the
 * port, so WebSocket connections are refused).
 */
const FAKE_HERMES = `#!/bin/sh
echo "$*" >> "$HERMES_FAKE_LOG"
case "$*" in
  --version) echo "Hermes Agent v\${HERMES_FAKE_VERSION:-0.21.3} (2026.9.14)"; echo "Install method: git" ;;
  update) exit 0 ;;
  *serve*)
    echo "env desktop=\${HERMES_DESKTOP:-unset} token=\${HERMES_DASHBOARD_SESSION_TOKEN:+set}" >> "$HERMES_FAKE_LOG"
    echo "HERMES_BACKEND_READY port=1"
    exec sleep 30 ;;
esac
`;

const makeFakeHermes = Effect.fnUntraced(function* (version = "0.21.3") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hermes-fake-" });
  const binaryPath = path.join(root, "hermes");
  const logPath = path.join(root, "calls.log");
  yield* fs.writeFileString(binaryPath, FAKE_HERMES);
  yield* fs.chmod(binaryPath, 0o755);
  yield* fs.writeFileString(logPath, "");
  const environment = {
    PATH: "/usr/bin:/bin",
    HERMES_FAKE_LOG: logPath,
    HERMES_FAKE_VERSION: version,
    // Must never reach the gateway: it would start Hermes's desktop cron ticker.
    HERMES_DESKTOP: "1",
  };
  const calls = fs
    .readFileString(logPath)
    .pipe(Effect.map((text) => text.split("\n").filter((line) => line.length > 0)));
  return { binaryPath, environment, calls };
});

const runCommand = (executable: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(executable, args, { env }));
    yield* Stream.runDrain(child.stdout);
    return Number(yield* child.exitCode);
  }).pipe(Effect.scoped);

const decodeHermesSettings = Schema.decodeEffect(HermesSettings);

const INFO_PAYLOAD = {
  version: "0.21.3",
  desktop_contract: 7,
  update_behind: 12,
  update_command: "hermes update",
};

describe("Hermes updates", () => {
  it.effect("stops every gateway, runs the gateway-reported command, and restarts lazily", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermes();
      const fleet = new Set<HermesGatewayRuntime>();
      const runtime = yield* makeHermesGatewayRuntime({
        binaryPath: fake.binaryPath,
        profile: "default",
        environment: fake.environment,
      }).pipe(Effect.provideService(HermesGatewayFleet, fleet));
      assert.isTrue(fleet.has(runtime));

      const firstConnect = yield* Effect.exit(runtime.connect({}));
      assert.isTrue(Exit.isFailure(firstConnect));
      assert.deepStrictEqual(yield* fake.calls, [
        "--profile default serve --isolated --host 127.0.0.1 --port 0",
        "env desktop=unset token=set",
      ]);
      yield* runtime.noteInfo(INFO_PAYLOAD);

      const capabilities = hermesMaintenanceCapabilities({
        info: yield* runtime.info,
        binaryPath: fake.binaryPath,
        environment: fake.environment,
        latestVersion: "0.21.4",
        fleet,
      });
      const update = capabilities.update;
      assert.isNotNull(update);
      if (update === null) return;
      assert.equal(update.command, "hermes update");
      assert.equal(update.executable, fake.binaryPath);
      assert.deepStrictEqual(update.args, ["update"]);
      assert.equal(update.lockKey, HERMES_UPDATE_LOCK_KEY);

      const blockedDuringUpdate = yield* update.guard!(
        Effect.gen(function* () {
          const blocked = yield* Effect.exit(runtime.connect({}));
          const exitCode = yield* runCommand(update.executable, update.args, fake.environment);
          return { blocked, exitCode };
        }),
      );
      assert.equal(blockedDuringUpdate.exitCode, 0);
      assert.isTrue(Exit.isFailure(blockedDuringUpdate.blocked));
      assert.isNull(yield* runtime.info, "stopping the gateway forgets its self-description");
      assert.deepStrictEqual(yield* fake.calls, [
        "--profile default serve --isolated --host 127.0.0.1 --port 0",
        "env desktop=unset token=set",
        "update",
      ]);

      yield* Effect.exit(runtime.connect({}));
      const calls = yield* fake.calls;
      assert.equal(calls.filter((call) => call.includes(" serve ")).length, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses while any Hermes turn is running", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermes();
      const fleet = new Set<HermesGatewayRuntime>();
      const makeRuntime = (profile: string) =>
        makeHermesGatewayRuntime({
          binaryPath: fake.binaryPath,
          profile,
          environment: fake.environment,
        }).pipe(Effect.provideService(HermesGatewayFleet, fleet));
      const idle = yield* makeRuntime("default");
      const busy = yield* makeRuntime("research");
      const release = yield* busy.trackTurn;

      const capabilities = hermesMaintenanceCapabilities({
        info: {
          version: "0.21.3",
          contract: 7,
          updateBehind: null,
          updateCommand: "hermes update",
        },
        binaryPath: fake.binaryPath,
        environment: fake.environment,
        latestVersion: "0.21.4",
        fleet,
      });
      const guard = capabilities.update!.guard!;
      const refused = yield* Effect.exit(
        guard(runCommand(fake.binaryPath, ["update"], fake.environment)),
      );
      assert.isTrue(Exit.isFailure(refused));
      assert.notInclude(yield* fake.calls, "update");

      // The refusal leaves gateways usable.
      yield* Effect.exit(idle.connect({}));
      assert.equal((yield* fake.calls).filter((call) => call.includes(" serve ")).length, 1);

      yield* release;
      const exitCode = yield* guard(runCommand(fake.binaryPath, ["update"], fake.environment));
      assert.equal(exitCode, 0);
      assert.include(yield* fake.calls, "update");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reports a gateway below the minimum contract as incompatible with the update action",
    () =>
      Effect.gen(function* () {
        const fake = yield* makeFakeHermes("0.20.0");
        const settings = yield* decodeHermesSettings({
          binaryPath: fake.binaryPath,
        });
        const info = {
          version: "0.20.0",
          contract: 6,
          updateBehind: null,
          updateCommand: "hermes update",
        };
        const utility: HermesGatewayUtility = {
          getSetupStatus: Effect.succeed({ provider_configured: true }),
          readInfo: Effect.succeed(info),
          getModels: Effect.succeed({ providers: [] }),
          getCommands: Effect.succeed({ pairs: [] }),
          generate: () => Effect.succeed(""),
        };
        const draft = yield* checkHermesProviderStatus(settings, fake.environment, utility);
        assert.equal(draft.status, "error");
        assert.equal(draft.version, "0.20.0");
        assert.include(draft.message ?? "", "contract 6");

        const enriched = yield* enrichProviderSnapshotWithVersionAdvisory(
          { ...draft, instanceId: ProviderInstanceId.make("hermes"), driver: HERMES_DRIVER_KIND },
          hermesMaintenanceCapabilities({
            info,
            binaryPath: fake.binaryPath,
            environment: fake.environment,
            latestVersion: "0.21.4",
            fleet: new Set(),
          }),
        );
        assert.equal(enriched.versionAdvisory?.status, "behind_latest");
        assert.isTrue(enriched.versionAdvisory?.canUpdate);
        assert.equal(enriched.versionAdvisory?.updateCommand, "hermes update");
      }).pipe(Effect.scoped, Effect.provide([NodeServices.layer, FetchHttpClient.layer])),
  );
});
