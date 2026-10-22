import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { SERVICE_LAUNCHER_CHECK_OUTPUT } from "../serviceLauncherFastPath.ts";
import {
  bootServiceProgramOf,
  renderBootServicePlist,
  renderBootServiceUnit,
} from "./bootService.ts";
import { pinnedRuntimePaths } from "./pinnedRuntime.ts";
import {
  adoptCurrentRuntime,
  adoptSelectedRuntime,
  currentRuntimeEntry,
  followCurrentOnPath,
  installStableLauncher,
  stableLauncherPaths,
} from "./stableLauncher.ts";
import { migrateBootServiceUnit, settleServiceRuntime } from "./stableLauncherSettle.ts";
import { SERVICE_LAUNCHER_PROTOCOL, SERVICE_RESTART_PENDING_FILE } from "./serviceProtocol.ts";

// A runtime build: one that has the launcher fast path answers the check, an older one cannot.
const runtimeScript = (version: string, standalone: boolean) =>
  [
    "#!/bin/sh",
    `if [ "$1" = "__service-launcher" ] && [ "$2" = "--check" ]; then`,
    standalone ? `  echo "${SERVICE_LAUNCHER_CHECK_OUTPUT}"; exit 0` : "  exit 1",
    "fi",
    `echo "t3 v${version}"`,
    "",
  ].join("\n");

const makeHome = Effect.fn("test.make_stable_launcher_home")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-stable-launcher-" });
  const baseDir = path.join(root, ".t3");
  const addRuntime = Effect.fn("test.add_runtime")(function* (version: string, standalone = true) {
    const paths = pinnedRuntimePaths(path, baseDir, version, "darwin");
    yield* fs.makeDirectory(paths.versionDir, { recursive: true });
    yield* fs.writeFileString(paths.entryPath, runtimeScript(version, standalone));
    yield* fs.chmod(paths.entryPath, 0o755);
    yield* fs.writeFileString(paths.sentinelPath, `${version}\n`);
    return paths.entryPath;
  });
  const selectVersion = (activeVersion: string, update?: unknown) =>
    fs.writeFileString(
      path.join(baseDir, "runtime", "service-state.json"),
      JSON.stringify({ protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion, update }),
    );
  return { fs, path, root, baseDir, addRuntime, selectVersion };
});

const environment = (
  root: string,
  extra: Record<string, string> = {},
  platform: NodeJS.Platform = "darwin",
) =>
  Layer.mergeAll(
    Layer.succeed(HostProcess.Platform, platform),
    Layer.succeed(HostProcess.HomeDirectory, root),
    Layer.succeed(HostProcess.Environment, { PATH: "", ...extra }),
  );

it.layer(
  Layer.mergeAll(NodeServices.layer, ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
)("stable launcher", (it) => {
  it.effect("installs a runnable copy at the fixed path and replaces it by rename", () =>
    Effect.gen(function* () {
      const { fs, baseDir, root, addRuntime } = yield* makeHome();
      const launcher = stableLauncherPaths(yield* Path.Path, baseDir);
      yield* addRuntime("1.0.0");
      yield* addRuntime("2.0.0");

      const first = yield* installStableLauncher({ baseDir, version: "1.0.0" }).pipe(
        Effect.provide(environment(root)),
      );
      assert.deepStrictEqual(Option.getOrUndefined(first), launcher.entryPath);
      const before = yield* fs.stat(launcher.entryPath);

      yield* installStableLauncher({ baseDir, version: "2.0.0" }).pipe(
        Effect.provide(environment(root)),
      );
      const after = yield* fs.stat(launcher.entryPath);
      // A new inode: a running launcher keeps executing the file it started from.
      assert.notEqual(Option.getOrUndefined(after.ino), Option.getOrUndefined(before.ino));
      assert.include(yield* fs.readFileString(launcher.entryPath), "t3 v2.0.0");
      assert.equal(
        (yield* fs.readFileString(launcher.versionPath)).trim(),
        `2.0.0 ${Option.getOrUndefined(after.ino)}`,
      );
      assert.deepStrictEqual((yield* fs.readDirectory(launcher.dir)).sort(), ["t3", "version"]);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the installed launcher when a build cannot launch on its own", () =>
    Effect.gen(function* () {
      const { fs, baseDir, root, addRuntime } = yield* makeHome();
      const launcher = stableLauncherPaths(yield* Path.Path, baseDir);
      yield* addRuntime("2.0.0");
      yield* addRuntime("0.2.13", false);
      yield* installStableLauncher({ baseDir, version: "2.0.0" }).pipe(
        Effect.provide(environment(root)),
      );

      const older = yield* installStableLauncher({ baseDir, version: "0.2.13" }).pipe(
        Effect.provide(environment(root)),
      );

      assert.isTrue(Option.isNone(older));
      assert.include(yield* fs.readFileString(launcher.entryPath), "t3 v2.0.0");
      assert.deepStrictEqual((yield* fs.readDirectory(launcher.dir)).sort(), ["t3", "version"]);
    }).pipe(Effect.scoped),
  );

  it.effect("moves every t3 link of this home onto runtime/current", () =>
    Effect.gen(function* () {
      const { fs, path, baseDir, root, addRuntime } = yield* makeHome();
      const old = yield* addRuntime("1.0.0");
      yield* addRuntime("2.0.0");
      const installBin = path.join(root, "bin");
      const recorded = path.join(root, "recorded", "t3");
      const foreign = path.join(root, "foreign", "t3");
      const otherHome = path.join(root, "other", "runtime", "versions", "1.0.0", "t3");
      for (const directory of [installBin, path.dirname(recorded), path.dirname(foreign)]) {
        yield* fs.makeDirectory(directory, { recursive: true });
      }
      yield* fs.makeDirectory(path.dirname(otherHome), { recursive: true });
      yield* fs.writeFileString(otherHome, "");
      yield* fs.symlink(old, path.join(installBin, "t3"));
      yield* fs.symlink(old, recorded);
      yield* fs.symlink(otherHome, foreign);
      // The second entry is a runtime that pruning found on a service PATH, not a launcher.
      yield* fs.writeFileString(
        path.join(baseDir, "runtime", "launchers"),
        `${recorded}\n${old}\n`,
      );
      const env = environment(root, {
        T3CODE_INSTALL_BIN_DIR: installBin,
        PATH: path.dirname(foreign),
      });

      const launchedAs = path.join(installBin, "t3");
      const following = yield* adoptCurrentRuntime({ baseDir, version: "2.0.0", launchedAs }).pipe(
        Effect.provide(env),
      );

      const current = currentRuntimeEntry(path, baseDir);
      assert.deepStrictEqual(Option.getOrUndefined(following), launchedAs);
      assert.equal(yield* fs.readLink(path.join(baseDir, "runtime", "current")), "versions/2.0.0");
      assert.equal(yield* fs.readLink(launchedAs), current);
      assert.equal(yield* fs.readLink(recorded), current);
      assert.equal(yield* fs.readLink(foreign), otherHome);
      assert.include(yield* fs.readFileString(launchedAs), "t3 v2.0.0");
      assert.deepStrictEqual(
        (yield* fs.readFileString(path.join(baseDir, "runtime", "launchers"))).split("\n"),
        [recorded, launchedAs, ""],
      );

      // A rollback or downgrade moves only runtime/current.
      yield* adoptCurrentRuntime({ baseDir, version: "1.0.0" }).pipe(Effect.provide(env));
      assert.include(yield* fs.readFileString(launchedAs), "t3 v1.0.0");
      assert.equal(yield* fs.readLink(launchedAs), current);
    }).pipe(Effect.scoped),
  );

  it.effect.each(["launchd", "systemd"] as const)(
    "moves a %s unit that names a versioned runtime onto the fixed launcher",
    (kind) =>
      Effect.gen(function* () {
        const { fs, path, baseDir, root, addRuntime, selectVersion } = yield* makeHome();
        const old = yield* addRuntime("1.0.0");
        yield* addRuntime("2.0.0");
        yield* selectVersion("2.0.0");
        const platform = kind === "launchd" ? "darwin" : "linux";
        const unitPath =
          kind === "launchd"
            ? path.join(root, "Library", "LaunchAgents", "com.bpdev97.tangent.service.plist")
            : path.join(root, ".config", "systemd", "user", "tangent.service");
        const plan = {
          program: [old, "__service-launcher"],
          baseDir,
          logPath: path.join(baseDir, "userdata", "logs", "boot-service.log"),
          unitPath,
        };
        const unit =
          kind === "launchd"
            ? renderBootServicePlist(plan, {
                homeDir: root,
                environmentPath: `/usr/bin:${path.dirname(old)}`,
              })
            : renderBootServiceUnit(plan);
        yield* fs.makeDirectory(path.dirname(unitPath), { recursive: true });
        yield* fs.writeFileString(unitPath, unit);
        const env = environment(root, {}, platform);

        yield* settleServiceRuntime({ baseDir, version: "2.0.0" }).pipe(Effect.provide(env));

        const launcher = stableLauncherPaths(path, baseDir).entryPath;
        const settled = yield* fs.readFileString(unitPath);
        assert.equal(bootServiceProgramOf(settled), launcher);
        assert.equal(
          settled,
          unit
            .replace(old, launcher)
            .replace(`:${path.dirname(old)}<`, `:${path.join(baseDir, "runtime", "current")}<`),
        );
        assert.include(yield* fs.readFileString(launcher), "t3 v2.0.0");

        // Already on the fixed launcher: later updates only refresh the binary.
        yield* addRuntime("3.0.0");
        yield* selectVersion("3.0.0");
        yield* settleServiceRuntime({ baseDir, version: "3.0.0" }).pipe(Effect.provide(env));
        assert.equal(yield* fs.readFileString(unitPath), settled);
        assert.include(yield* fs.readFileString(launcher), "t3 v3.0.0");
      }).pipe(Effect.scoped),
  );

  it.effect("leaves another install's staging alone and repairs a marker it raced", () =>
    Effect.gen(function* () {
      const { fs, path, baseDir, root, addRuntime } = yield* makeHome();
      const launcher = stableLauncherPaths(path, baseDir);
      yield* addRuntime("1.0.0");
      yield* addRuntime("2.0.0");
      yield* installStableLauncher({ baseDir, version: "1.0.0" }).pipe(
        Effect.provide(environment(root)),
      );
      const inProgress = path.join(launcher.dir, ".t3-inprogress");
      yield* fs.makeDirectory(inProgress);
      // Another install renamed its 2.0.0 copy in after this marker was written.
      yield* fs.copyFile(
        pinnedRuntimePaths(path, baseDir, "2.0.0", "darwin").entryPath,
        path.join(root, "t3"),
      );
      yield* fs.rename(path.join(root, "t3"), launcher.entryPath);

      yield* installStableLauncher({ baseDir, version: "1.0.0" }).pipe(
        Effect.provide(environment(root)),
      );

      assert.isTrue(yield* fs.exists(inProgress));
      assert.include(yield* fs.readFileString(launcher.entryPath), "t3 v1.0.0");
    }).pipe(Effect.scoped),
  );

  it.effect("maps both spellings of a symlinked home's version directories", () =>
    Effect.gen(function* () {
      const { fs, path, baseDir, root, addRuntime } = yield* makeHome();
      yield* addRuntime("1.0.0");
      const alias = path.join(root, "alias");
      yield* fs.symlink(baseDir, alias);
      const real = yield* fs.realPath(baseDir);

      const followCurrent = yield* followCurrentOnPath(alias);

      const current = path.join(alias, "runtime", "current");
      assert.equal(followCurrent(path.join(alias, "runtime", "versions", "1.0.0")), current);
      assert.equal(followCurrent(path.join(real, "runtime", "versions", "1.0.0")), current);
      assert.equal(followCurrent("/usr/bin"), "/usr/bin");
    }).pipe(Effect.scoped),
  );

  it.effect("follows a selection that keeps changing while it publishes", () =>
    Effect.gen(function* () {
      const { fs, path, baseDir, root, addRuntime, selectVersion } = yield* makeHome();
      for (const version of ["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0"]) {
        yield* addRuntime(version);
      }
      yield* selectVersion("1.0.0");
      const current = path.join(baseDir, "runtime", "current");
      // Another install selects the next version right after each rename into runtime/current.
      const later = ["2.0.0", "3.0.0", "4.0.0", "5.0.0"];
      const racing = FileSystem.FileSystem.of({
        ...fs,
        rename: (from, to) =>
          fs.rename(from, to).pipe(
            Effect.andThen(() => {
              const next = to === current ? later.shift() : undefined;
              return next === undefined ? Effect.void : selectVersion(next);
            }),
          ),
      });

      yield* adoptSelectedRuntime({ baseDir }).pipe(
        Effect.provideService(FileSystem.FileSystem, racing),
        Effect.provide(environment(root)),
      );

      assert.deepStrictEqual(later, []);
      assert.equal(yield* fs.readLink(current), "versions/5.0.0");
    }).pipe(Effect.scoped),
  );

  it.effect("leaves runtime/current to the install that selected a newer version", () =>
    Effect.gen(function* () {
      const { fs, path, baseDir, root, addRuntime, selectVersion } = yield* makeHome();
      yield* addRuntime("1.0.0");
      yield* addRuntime("2.0.0");
      const current = path.join(baseDir, "runtime", "current");
      yield* fs.symlink("versions/2.0.0", current);
      // `t3 update 2.0.0` declined the restart, so server 1.0.0 is still starting.
      yield* selectVersion("2.0.0");
      yield* fs.writeFileString(
        path.join(baseDir, "runtime", SERVICE_RESTART_PENDING_FILE),
        "2.0.0\n",
      );

      yield* settleServiceRuntime({ baseDir, version: "1.0.0" }).pipe(
        Effect.provide(environment(root)),
      );
      assert.equal(yield* fs.readLink(current), "versions/2.0.0");

      // A client update that commits later wins over the restart that `t3 update` deferred.
      yield* addRuntime("3.0.0");
      yield* selectVersion("3.0.0", {
        id: "c",
        fromVersion: "1.0.0",
        targetVersion: "3.0.0",
        status: "committed",
      });
      yield* settleServiceRuntime({ baseDir, version: "3.0.0" }).pipe(
        Effect.provide(environment(root)),
      );
      assert.equal(yield* fs.readLink(current), "versions/3.0.0");
      yield* fs.remove(path.join(baseDir, "runtime", SERVICE_RESTART_PENDING_FILE));

      // Nor does a trial server whose update is still pending.
      yield* selectVersion("1.0.0", {
        id: "u",
        fromVersion: "1.0.0",
        targetVersion: "2.0.0",
        dbPath: "/db",
        status: "pending",
      });
      yield* settleServiceRuntime({ baseDir, version: "2.0.0" }).pipe(
        Effect.provide(environment(root)),
      );
      assert.equal(yield* fs.readLink(current), "versions/3.0.0");
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a unit that serves another T3 home alone", () =>
    Effect.gen(function* () {
      const { fs, path, baseDir, root, addRuntime, selectVersion } = yield* makeHome();
      yield* addRuntime("2.0.0");
      yield* selectVersion("2.0.0");
      const otherHome = path.join(root, "other");
      const unitPath = path.join(
        root,
        "Library",
        "LaunchAgents",
        "com.bpdev97.tangent.service.plist",
      );
      const unit = renderBootServicePlist(
        {
          program: [
            path.join(otherHome, "runtime", "versions", "1.0.0", "t3"),
            "__service-launcher",
          ],
          baseDir: otherHome,
          logPath: "/log",
          unitPath,
        },
        { homeDir: root, environmentPath: "/usr/bin" },
      );
      yield* fs.makeDirectory(path.dirname(unitPath), { recursive: true });
      yield* fs.writeFileString(unitPath, unit);

      yield* settleServiceRuntime({ baseDir, version: "2.0.0" }).pipe(
        Effect.provide(environment(root)),
      );

      assert.equal(yield* fs.readFileString(unitPath), unit);
      assert.isFalse(yield* fs.exists(stableLauncherPaths(path, baseDir).dir));
    }).pipe(Effect.scoped),
  );

  it.effect.each([
    ["a unit", "/home/theo/T3 Data/100%"],
    ["a plist", "/Users/theo/a&b <c>"],
  ] as const)("replaces only the launcher program and versioned PATH in %s", ([kind, baseDir]) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const render = (program: string, pathEntry: string) => {
        const plan = {
          program: [program, "__service-launcher"],
          baseDir,
          logPath: "/log $1",
          unitPath: "",
        };
        return kind === "a unit"
          ? renderBootServiceUnit(plan)
          : renderBootServicePlist(plan, {
              homeDir: "/Users/theo",
              environmentPath: `/usr/bin:${pathEntry}:/bin`,
            });
      };
      const versioned = `${baseDir}/runtime/versions/1.2.3/t3`;
      const launcher = `${baseDir}/runtime/launcher/t3`;

      const migrated = migrateBootServiceUnit(render(versioned, path.dirname(versioned)), {
        program: launcher,
        followCurrent: yield* followCurrentOnPath(baseDir),
      });

      assert.equal(migrated, render(launcher, `${baseDir}/runtime/current`));
    }),
  );
});
