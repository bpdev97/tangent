/**
 * Tangent(FORK-LAUNCHER-001): fixed paths for the background service and the `t3` command, so
 * neither moves when the active version does. See docs/fork/stable-launcher.md.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import { SERVICE_LAUNCHER_CHECK_OUTPUT } from "../serviceLauncherFastPath.ts";
import { launcherOwnsVersionsDir, pinnedRuntimePaths } from "./pinnedRuntime.ts";
import { parseServiceState, SERVICE_STATE_FILE } from "./serviceProtocol.ts";

const LAUNCHER_CHECK_TIMEOUT = Duration.seconds(60);
const LAUNCHER_TEMP_PREFIX = ".t3-";
const LAUNCHER_STAGING_GRACE = Duration.hours(1);
// Same file the install scripts and runtime pruning keep; see pinnedRuntime.ts.
const LAUNCHERS_FILE = "launchers";

export function stableLauncherPaths(path: Path.Path, baseDir: string) {
  const dir = path.join(baseDir, "runtime", "launcher");
  return { dir, entryPath: path.join(dir, "t3"), versionPath: path.join(dir, "version") };
}

const currentRuntimeDir = (path: Path.Path, baseDir: string) =>
  path.join(baseDir, "runtime", "current");

export const currentRuntimeEntry = (path: Path.Path, baseDir: string) =>
  path.join(currentRuntimeDir(path, baseDir), "t3");

/**
 * Maps a directory of this home's `runtime/versions` (by either spelling of a symlinked home) to
 * `runtime/current`. On a service PATH a version directory goes stale with the next update and
 * keeps that runtime from being pruned; `runtime/current` always holds the active `t3`.
 */
export const followCurrentOnPath = Effect.fn("cloud.stable_launcher.follow_current_on_path")(
  function* (baseDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const versionsDir = path.join(baseDir, "runtime", "versions");
    const realVersionsDir = yield* fs
      .realPath(versionsDir)
      .pipe(Effect.orElseSucceed(() => versionsDir));
    return (directory: string) => {
      const parent = path.dirname(path.resolve(directory));
      return parent === versionsDir || parent === realVersionsDir
        ? currentRuntimeDir(path, baseDir)
        : directory;
    };
  },
);

/**
 * The version the service launcher runs next, or undefined while an update is pending: its trial
 * server publishes the outcome once it commits.
 */
export const selectedServiceVersion = Effect.fn("cloud.stable_launcher.selected_version")(
  function* (baseDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateText = yield* fs
      .readFileString(path.join(baseDir, "runtime", SERVICE_STATE_FILE))
      .pipe(Effect.option);
    const state = Option.isSome(stateText) ? parseServiceState(stateText.value) : undefined;
    return state === undefined || state.update?.status === "pending"
      ? undefined
      : state.activeVersion;
  },
);

/**
 * `<version> <inode>` of the installed launcher. Two installs can race (a CLI install and a server
 * settling), each renaming its own copy into place; a marker whose inode is not the file's own
 * describes the other copy and counts as stale.
 */
const readInstalledLauncher = Effect.fn("cloud.stable_launcher.read_installed")(function* (
  launcher: ReturnType<typeof stableLauncherPaths>,
) {
  const fs = yield* FileSystem.FileSystem;
  const [marker, info] = yield* Effect.all([
    fs.readFileString(launcher.versionPath).pipe(Effect.option),
    fs.stat(launcher.entryPath).pipe(Effect.option),
  ]);
  if (Option.isNone(marker) || Option.isNone(info) || Option.isNone(info.value.ino)) {
    return undefined;
  }
  const [version, inode] = marker.value.trim().split(" ");
  return inode === String(info.value.ino.value) ? version : undefined;
});

/**
 * Copies `versions/<version>/t3` to the fixed launcher path the service unit names, replacing the
 * old one by rename so a running launcher keeps its own file. Returns none when that build cannot
 * start the launcher on its own (builds before this feature load node_modules first), leaving any
 * installed launcher as it was.
 */
export const installStableLauncher = Effect.fn("cloud.stable_launcher.install")(function* (input: {
  readonly baseDir: string;
  readonly version: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const launcher = stableLauncherPaths(path, input.baseDir);
  if (platform === "win32") return Option.none<string>();
  if ((yield* readInstalledLauncher(launcher)) === input.version) {
    return Option.some(launcher.entryPath);
  }

  yield* fs.makeDirectory(launcher.dir, { recursive: true });
  // Staging an interrupted install left behind; a recent one may belong to an install in progress.
  const abandonedBefore =
    (yield* Clock.currentTimeMillis) - Duration.toMillis(LAUNCHER_STAGING_GRACE);
  for (const entry of yield* fs.readDirectory(launcher.dir)) {
    if (!entry.startsWith(LAUNCHER_TEMP_PREFIX)) continue;
    const staging = path.join(launcher.dir, entry);
    const modified = yield* fs.stat(staging).pipe(
      Effect.map((info) => Option.getOrUndefined(info.mtime)?.getTime()),
      Effect.orElseSucceed(() => undefined),
    );
    if (modified !== undefined && modified < abandonedBefore) {
      yield* fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore);
    }
  }
  const stagingDir = yield* fs.makeTempDirectory({
    directory: launcher.dir,
    prefix: LAUNCHER_TEMP_PREFIX,
  });
  const staged = path.join(stagingDir, "t3");
  return yield* Effect.gen(function* () {
    // Never written in place: macOS kills a process whose signed executable changes under it.
    yield* fs.copyFile(
      pinnedRuntimePaths(path, input.baseDir, input.version, platform).entryPath,
      staged,
    );
    yield* fs.chmod(staged, 0o755);
    const check = yield* runner
      .run({
        command: staged,
        args: ["__service-launcher", "--check"],
        timeout: LAUNCHER_CHECK_TIMEOUT,
      })
      .pipe(Effect.option);
    const standalone =
      Option.isSome(check) &&
      check.value.code === 0 &&
      check.value.stdout.includes(SERVICE_LAUNCHER_CHECK_OUTPUT);
    if (!standalone) return Option.none<string>();
    const inode = Option.getOrUndefined((yield* fs.stat(staged)).ino);
    const marker = path.join(stagingDir, "version");
    yield* fs.writeFileString(marker, `${input.version} ${String(inode)}\n`);
    yield* fs.rename(staged, launcher.entryPath);
    yield* fs.rename(marker, launcher.versionPath);
    return Option.some(launcher.entryPath);
  }).pipe(
    Effect.ensuring(fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
});

/** Points `runtime/current` at `versions/<version>` with one rename. */
const pointCurrentRuntime = Effect.fn("cloud.stable_launcher.point_current")(function* (input: {
  readonly baseDir: string;
  readonly version: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const current = currentRuntimeDir(path, input.baseDir);
  // Relative, so a moved or symlinked T3 home keeps working.
  const target = path.join("versions", input.version);
  const existing = yield* fs.readLink(current).pipe(Effect.option);
  if (Option.isSome(existing) && existing.value === target) return;
  const staged = `${current}.${process.pid}.tmp`;
  yield* fs.remove(staged, { force: true });
  yield* fs.symlink(target, staged);
  yield* fs.rename(staged, current);
});

/**
 * Repoints every `t3` symlink that names one of this home's `versions/<version>/t3` at
 * `runtime/current/t3`, and records it for runtime pruning. Checks the recorded launchers, the
 * install directory, PATH, and `extra`. Returns the links that now follow `runtime/current`.
 */
const followCurrentRuntime = Effect.fn("cloud.stable_launcher.follow_current")(function* (input: {
  readonly baseDir: string;
  readonly extra?: ReadonlyArray<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;
  const launchersFile = path.join(input.baseDir, "runtime", LAUNCHERS_FILE);
  const recorded = (yield* fs.readFileString(launchersFile).pipe(Effect.orElseSucceed(() => "")))
    .split(/\r?\n/)
    .filter((launcher) => launcher.trim().length > 0);
  const candidates = new Set(
    [
      ...recorded,
      ...[
        environment["T3CODE_INSTALL_BIN_DIR"] || path.join(home, ".local", "bin"),
        ...(environment["PATH"] ?? "").split(":"),
      ].map((directory) => path.join(directory, "t3")),
      ...(input.extra ?? []),
    ].filter((candidate) => path.isAbsolute(candidate)),
  );
  const versionsDir = path.join(input.baseDir, "runtime", "versions");
  const realVersionsDir = yield* fs
    .realPath(versionsDir)
    .pipe(Effect.orElseSucceed(() => versionsDir));
  const currentEntry = currentRuntimeEntry(path, input.baseDir);

  const following: Array<string> = [];
  for (const candidate of candidates) {
    const target = yield* fs.readLink(candidate).pipe(Effect.option);
    if (Option.isNone(target)) continue;
    const resolved = path.resolve(path.dirname(candidate), target.value);
    if (resolved !== currentEntry) {
      if (
        !launcherOwnsVersionsDir(path, versionsDir, resolved) &&
        !launcherOwnsVersionsDir(path, realVersionsDir, resolved)
      ) {
        continue;
      }
      const staged = `${candidate}.${process.pid}.tmp`;
      const repointed = yield* fs.remove(staged, { force: true }).pipe(
        Effect.andThen(fs.symlink(currentEntry, staged)),
        Effect.andThen(fs.rename(staged, candidate)),
        Effect.as(true),
        Effect.catch((cause) =>
          Effect.logWarning("Could not repoint a t3 launcher.", {
            launcher: candidate,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );
      if (!repointed) continue;
    }
    following.push(candidate);
  }
  // A runtime inside `versions` is not a launcher. Pruning records one found on a service PATH
  // that named its directory, and the record would keep that runtime forever.
  const runtimes = recorded.filter(
    (launcher) =>
      launcherOwnsVersionsDir(path, versionsDir, launcher) ||
      launcherOwnsVersionsDir(path, realVersionsDir, launcher),
  );
  const unrecorded = following.filter((launcher) => !recorded.includes(launcher));
  if (runtimes.length > 0) {
    const kept = [...recorded.filter((launcher) => !runtimes.includes(launcher)), ...unrecorded];
    const staged = `${launchersFile}.${process.pid}.tmp`;
    yield* fs
      .writeFileString(staged, kept.map((launcher) => `${launcher}\n`).join(""))
      .pipe(Effect.andThen(fs.rename(staged, launchersFile)), Effect.ignore);
  } else if (unrecorded.length > 0) {
    yield* fs
      .writeFileString(launchersFile, unrecorded.map((launcher) => `${launcher}\n`).join(""), {
        flag: "a",
      })
      .pipe(Effect.ignore);
  }
  return following;
});

/**
 * Makes `version` the one every `t3` link runs. Returns `launchedAs` when it is one of them. Never
 * fails: a link that cannot move must not fail an update or a service install.
 */
export const adoptCurrentRuntime = Effect.fn("cloud.stable_launcher.adopt_current")(
  function* (input: {
    readonly baseDir: string;
    readonly version: string;
    readonly launchedAs?: string | undefined;
  }) {
    const platform = yield* HostProcess.Platform;
    if (platform === "win32") return Option.none<string>();
    return yield* pointCurrentRuntime(input).pipe(
      Effect.andThen(
        followCurrentRuntime({
          baseDir: input.baseDir,
          extra: input.launchedAs === undefined ? [] : [input.launchedAs],
        }),
      ),
      Effect.map((following) =>
        input.launchedAs !== undefined && following.includes(input.launchedAs)
          ? Option.some(input.launchedAs)
          : Option.none<string>(),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("Could not point t3 at the current runtime.", { cause }).pipe(
          Effect.as(Option.none<string>()),
        ),
      ),
    );
  },
);

/**
 * Points `t3` at the version the service state selects. Whoever changes the selection publishes
 * afterwards (`t3 update` and `t3 service install` after their install, a server once its update
 * commits), and every publication checks the selection again after its rename, so the last
 * selection wins even when two of them interleave.
 */
export const adoptSelectedRuntime = Effect.fn("cloud.stable_launcher.adopt_selected")(
  function* (input: { readonly baseDir: string; readonly launchedAs?: string | undefined }) {
    // Unbounded on purpose: the selection only changes when an update or install runs, so this
    // settles, and giving up early could leave the last publication behind the selection.
    let version = yield* selectedServiceVersion(input.baseDir);
    let adopted = Option.none<string>();
    while (version !== undefined) {
      adopted = yield* adoptCurrentRuntime({ ...input, version });
      const latest = yield* selectedServiceVersion(input.baseDir);
      if (latest === version) break;
      version = latest;
    }
    return adopted;
  },
);
