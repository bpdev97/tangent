import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { HermesSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

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
 * A fake `hermes`: logs each invocation, reports a version (and an install
 * directory when one is set), "updates", and serves by printing the ready
 * sentinel and sleeping (nothing listens on the port, so WebSocket connections
 * are refused).
 */
const FAKE_HERMES = `#!/bin/sh
echo "$*" >> "$HERMES_FAKE_LOG"
case "$*" in
  --version)
    echo "Hermes Agent v\${HERMES_FAKE_VERSION:-0.21.3} (2026.9.14)"
    [ -z "\${HERMES_FAKE_INSTALL_DIR:-}" ] || echo "Install directory: $HERMES_FAKE_INSTALL_DIR"
    echo "Install method: git" ;;
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

const GIT_IDENTITY = "-c user.name=test -c user.email=test@example.com -c commit.gpgsign=false";

/**
 * A Hermes checkout cloned the way a release-pinned install is: shallow, with
 * only the tag `v2026.9.21`, from an origin that has since tagged `v2026.9.24`.
 * `uv` is a fake that logs its arguments.
 */
const makePinnedCheckout = Effect.fnUntraced(function* (
  fake: Effect.Success<ReturnType<typeof makeFakeHermes>>,
  uvExitCode = 0,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-hermes-pinned-" });
  const origin = path.join(root, "origin");
  const checkout = path.join(root, "checkout");
  const bin = path.join(root, "bin");
  yield* fs.makeDirectory(bin);
  yield* fs.writeFileString(
    path.join(bin, "uv"),
    `#!/bin/sh\necho "uv $*" >> "$HERMES_FAKE_LOG"\nexit ${uvExitCode}\n`,
  );
  yield* fs.chmod(path.join(bin, "uv"), 0o755);
  const environment = {
    ...fake.environment,
    PATH: `${bin}:${fake.environment.PATH}`,
    HERMES_FAKE_INSTALL_DIR: checkout,
  };
  const setup = yield* runCommand(
    "/bin/sh",
    [
      "-ec",
      `git init -q "$1"
       for tag in v2026.9.21 v2026.9.24; do
         git -C "$1" ${GIT_IDENTITY} commit -q --allow-empty -m "$tag"
         git -C "$1" tag "$tag"
       done
       git clone -q -c advice.detachedHead=false --depth 1 --branch v2026.9.21 "file://$1" "$2"
       mkdir -p "$2/venv/bin" && cp /bin/sh "$2/venv/bin/python"`,
      "setup",
      origin,
      checkout,
    ],
    environment,
  );
  assert.equal(setup, 0);
  const pinnedTo = (tag: string) =>
    runCommand(
      "/bin/sh",
      [
        "-c",
        `test "$(git -C "$1" describe --tags --exact-match HEAD)" = "$2"`,
        "tag",
        checkout,
        tag,
      ],
      environment,
    ).pipe(Effect.map((exitCode) => exitCode === 0));
  return { checkout, environment, pinnedTo };
});

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
        latestTag: "v2026.9.21",
        fleet,
      });
      const update = capabilities.update;
      assert.isNotNull(update);
      if (update === null) return;
      assert.equal(update.command, "hermes update");
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
        // The install is not pinned to a release tag, so Hermes updates itself.
        "--version",
        "update",
      ]);

      yield* Effect.exit(runtime.connect({}));
      const calls = yield* fake.calls;
      assert.equal(calls.filter((call) => call.includes(" serve ")).length, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("moves a checkout pinned to a release tag to the latest release", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermes();
      const pinned = yield* makePinnedCheckout(fake);
      const update = hermesMaintenanceCapabilities({
        info: { version: "0.21.4", contract: 7, updateBehind: 1, updateCommand: "hermes update" },
        binaryPath: fake.binaryPath,
        environment: pinned.environment,
        latestVersion: "0.21.5",
        latestTag: "v2026.9.24",
        fleet: new Set(),
      }).update!;

      assert.equal(yield* runCommand(update.executable, update.args, pinned.environment), 0);
      assert.isTrue(yield* pinned.pinnedTo("v2026.9.24"));
      // `hermes update` only follows a branch, so it is never run on a pinned checkout.
      assert.deepStrictEqual(yield* fake.calls, [
        "--version",
        "backup --quick --label pre-update",
        `uv pip install --python ${pinned.checkout}/venv/bin/python --editable ${pinned.checkout}`,
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("puts a pinned checkout back when the reinstall fails", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermes();
      const pinned = yield* makePinnedCheckout(fake, 1);
      const update = hermesMaintenanceCapabilities({
        info: { version: "0.21.4", contract: 7, updateBehind: 1, updateCommand: "hermes update" },
        binaryPath: fake.binaryPath,
        environment: pinned.environment,
        latestVersion: "0.21.5",
        latestTag: "v2026.9.24",
        fleet: new Set(),
      }).update!;

      assert.equal(yield* runCommand(update.executable, update.args, pinned.environment), 1);
      assert.isTrue(yield* pinned.pinnedTo("v2026.9.21"));
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
        latestTag: "v2026.9.21",
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
            latestTag: "v2026.9.21",
            fleet: new Set(),
          }),
        );
        assert.equal(enriched.versionAdvisory?.status, "behind_latest");
        assert.isTrue(enriched.versionAdvisory?.canUpdate);
        assert.equal(enriched.versionAdvisory?.updateCommand, "hermes update");
      }).pipe(Effect.scoped, Effect.provide([NodeServices.layer, FetchHttpClient.layer])),
  );
});
