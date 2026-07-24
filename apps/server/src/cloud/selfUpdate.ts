// @effect-diagnostics nodeBuiltinImport:off
// node:child_process directly: the foreground-server replacement must be a
// detached fire-and-forget child that outlives this process, while Effect's
// ChildProcessSpawner ties every child to a scope that kills it.
import {
  ServerSelfUpdateError,
  type ServerSelfUpdateCapability,
  type ServerSelfUpdateInput,
  type ServerSelfUpdateResult,
} from "@t3tools/contracts";
import {
  HostProcessArguments,
  HostProcessEnvironment,
  HostProcessExecutablePath,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import * as NodeChildProcess from "node:child_process";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";

import { PERSONAL_DISTRIBUTION } from "../../../../downstream/config.ts";
import * as ServerConfig from "../config.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as ProcessRunner from "../processRunner.ts";
import {
  BOOT_SERVICE_UNIT_ENV,
  bootServiceUnitFile,
  quoteSystemdValue,
  renderBootServiceUnit,
} from "./bootService.ts";
import { ensurePinnedRuntimeInstalled, removePinnedRuntimeInstallation } from "./pinnedRuntime.ts";
import {
  downloadPersonalServerRelease,
  type ServerReleaseArtifactError,
  type VerifiedServerReleaseArtifact,
} from "./serverRelease.ts";

/**
 * Lets a connected client replace this server with another Tangent GitHub
 * Release over RPC — the update path that works when the user is not at the
 * machine. The release tarball is checksum-verified, installed into the pinned
 * runtime, and preflighted before anything restarts.
 */

const PREFLIGHT_TIMEOUT = Duration.seconds(30);
/** Grace between acknowledging the RPC and killing the process, so the
    response (and its relay hop) flushes before the socket drops. */
const RESTART_DELAY = Duration.seconds(2);
const PERSONAL_BOOT_SERVICE_IDENTITY = PERSONAL_DISTRIBUTION.connect;
export const PERSONAL_BOOT_SERVICE_UNIT_FILE = bootServiceUnitFile(PERSONAL_BOOT_SERVICE_IDENTITY);

/** Exact release versions only — never floating tags — so the acknowledgement
    names the immutable artifact that was actually installed and keeps the
    value safe to embed in filesystem paths. */
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ServerSelfUpdateHost {
  readonly execPath: string;
  readonly cliEntryPath: string;
  /** Original CLI arguments after the entry path, replayed on respawn. */
  readonly cliArgs: ReadonlyArray<string>;
  /** Resolves once the foreground replacement process has actually spawned. */
  readonly spawnDetached: (
    command: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<void, ProcessRunner.ProcessSpawnError>;
  readonly exitProcess: () => void;
}

function normalizeEntryPath(entryPath: string): string {
  return entryPath.replaceAll("\\", "/");
}

/**
 * Only a packaged CLI artifact can be swapped for another version: dev
 * checkouts (apps/server/dist) and the desktop app's bundled backend have no
 * release identity, and the desktop manages its own updates.
 */
export function isPublishedCliEntry(entryPath: string): boolean {
  return normalizeEntryPath(entryPath).includes("/node_modules/t3/dist/");
}

/**
 * The update path this process can offer, or null when only a manual
 * relaunch works. "desktop-managed" — the Tangent desktop app spawned this
 * backend and owns its version; only updating the app updates it.
 * "boot-service" — this is the systemd-supervised process from
 * bootService.ts: rewrite the unit and let systemd swap it. "respawn" — a
 * foreground POSIX process running a published artifact: replace it with a
 * detached child. Windows foreground runs are unsupported for now (no
 * equivalent of the detach-and-exec handoff below).
 */
export const resolveServerSelfUpdateCapability = Effect.fn(
  "cloud.server_self_update.resolve_capability",
)(function* (input: {
  /** True when the desktop app supervises this backend (mode "desktop"). */
  readonly desktopManaged: boolean;
}) {
  if (input.desktopManaged) {
    return "desktop-managed" as const;
  }

  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  const hostArguments = yield* HostProcessArguments;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const entryPath = hostArguments[1] ?? "";
  if (entryPath === "") {
    return null;
  }

  const homeDir = env.HOME ?? "";
  if (platform === "linux" && homeDir !== "") {
    const unitPath = path.join(
      homeDir,
      ".config",
      "systemd",
      "user",
      PERSONAL_BOOT_SERVICE_UNIT_FILE,
    );
    const unitReferencesEntry = yield* fs.readFileString(unitPath).pipe(
      Effect.map((unit) => unit.includes(quoteSystemdValue(entryPath))),
      Effect.orElseSucceed(() => false),
    );
    // INVOCATION_ID only proves that some systemd unit launched us. The
    // explicit marker written into the unit identifies it as the
    // supervisor that will replace the current process when restarted.
    if (
      unitReferencesEntry &&
      (env.INVOCATION_ID ?? "") !== "" &&
      env[BOOT_SERVICE_UNIT_ENV] === PERSONAL_BOOT_SERVICE_UNIT_FILE
    ) {
      return "boot-service" as const;
    }

    // A process owned by another (or a legacy unmarked) systemd unit must not
    // use the foreground respawn path: Restart=always could otherwise launch
    // the old unit beside the detached replacement.
    if ((env.INVOCATION_ID ?? "") !== "") {
      return null;
    }
  }

  if ((platform === "linux" || platform === "darwin") && isPublishedCliEntry(entryPath)) {
    return "respawn" as const;
  }

  return null;
});

export class ServerSelfUpdate extends Context.Service<
  ServerSelfUpdate,
  {
    readonly update: (
      input: ServerSelfUpdateInput,
    ) => Effect.Effect<ServerSelfUpdateResult, ServerSelfUpdateError>;
  }
>()("t3/cloud/selfUpdate/ServerSelfUpdate") {}

export const make = Effect.fn("cloud.server_self_update.make")(function* (options?: {
  readonly host?: Partial<ServerSelfUpdateHost>;
  readonly downloadRelease?: (input: {
    readonly baseDir: string;
    readonly version: string;
  }) => Effect.Effect<VerifiedServerReleaseArtifact, ServerReleaseArtifactError>;
}) {
  const serverConfig = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const env = yield* HostProcessEnvironment;
  const hostExecPath = yield* HostProcessExecutablePath;
  const hostArguments = yield* HostProcessArguments;
  const capability: ServerSelfUpdateCapability | null = yield* resolveServerSelfUpdateCapability({
    desktopManaged: serverConfig.mode === "desktop",
  });

  const host: ServerSelfUpdateHost = {
    execPath: options?.host?.execPath ?? hostExecPath,
    cliEntryPath: options?.host?.cliEntryPath ?? hostArguments[1] ?? "",
    cliArgs: options?.host?.cliArgs ?? hostArguments.slice(2),
    spawnDetached:
      options?.host?.spawnDetached ??
      ((command, args) =>
        Effect.callback<void, ProcessRunner.ProcessSpawnError>((resume) => {
          const spawnError = (cause: unknown) =>
            new ProcessRunner.ProcessSpawnError({
              command,
              argumentCount: args.length,
              cause,
            });
          let child: NodeChildProcess.ChildProcess;
          try {
            child = NodeChildProcess.spawn(command, [...args], {
              detached: true,
              stdio: "ignore",
            });
          } catch (cause) {
            resume(Effect.fail(spawnError(cause)));
            return;
          }

          const onSpawnError = (cause: Error) => resume(Effect.fail(spawnError(cause)));
          child.once("error", onSpawnError);
          child.once("spawn", () => {
            child.removeListener("error", onSpawnError);
            // Keep asynchronous child errors from becoming uncaught after the
            // successful spawn handoff has already been acknowledged.
            child.on("error", () => undefined);
            child.unref();
            resume(Effect.void);
          });
        })),
    exitProcess: options?.host?.exitProcess ?? (() => process.exit(0)),
  };
  const downloadRelease =
    options?.downloadRelease ??
    ((input: { readonly baseDir: string; readonly version: string }) =>
      downloadPersonalServerRelease(input).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      ));

  const inFlight = yield* Ref.make(false);

  const failWith = (reason: string, cause?: unknown) =>
    cause === undefined
      ? new ServerSelfUpdateError({ reason })
      : new ServerSelfUpdateError({ reason, cause });

  /** Deferred so the RPC acknowledgement flushes before the process dies.
      Detached from the request scope: the triggering connection is exactly
      what the restart tears down. */
  const scheduleRestart = (restart: Effect.Effect<void>) =>
    Effect.sleep(RESTART_DELAY).pipe(
      Effect.andThen(restart),
      Effect.forkDetach({ startImmediately: true }),
    );
  const writeUnitAtomically = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const update: ServerSelfUpdate["Service"]["update"] = Effect.fn(
    "cloud.server_self_update.update",
  )(function* (input) {
    if (capability === "desktop-managed") {
      return yield* failWith(
        "This server is managed by the Tangent desktop app on its machine; update the desktop app to update it.",
      );
    }
    if (capability === null) {
      return yield* failWith(
        "This server cannot update itself; relaunch it manually with the new version.",
      );
    }
    const activeMethod = capability;
    const targetVersion = input.targetVersion.trim();
    if (!EXACT_VERSION_PATTERN.test(targetVersion)) {
      return yield* failWith(`'${targetVersion}' is not an exact Tangent version.`);
    }

    const alreadyRunning = yield* Ref.getAndSet(inFlight, true);
    if (alreadyRunning) {
      return yield* failWith("A server update is already in progress.");
    }

    return yield* Effect.gen(function* () {
      const releaseArtifact = yield* downloadRelease({
        baseDir: serverConfig.baseDir,
        version: targetVersion,
      }).pipe(
        Effect.mapError((error) =>
          failWith("Could not download the requested Tangent GitHub Release.", error),
        ),
      );
      const runtimePaths = yield* ensurePinnedRuntimeInstalled({
        baseDir: serverConfig.baseDir,
        version: targetVersion,
        packageSpecifier: releaseArtifact.packagePath,
        installIdentity: releaseArtifact.installIdentity,
        fs,
        path,
        runner,
      }).pipe(
        Effect.mapError((error) =>
          failWith("Could not install the requested Tangent version.", error),
        ),
      );

      // A broken artifact (failed native build, incompatible node) must be
      // caught while the current server is still alive to report it.
      const preflight = yield* runner
        .run({
          command: host.execPath,
          args: [runtimePaths.entryPath, "--version"],
          timeout: PREFLIGHT_TIMEOUT,
        })
        .pipe(
          Effect.mapError((cause) =>
            failWith(`Could not verify the installed Tangent ${targetVersion}.`, cause),
          ),
        );
      // Effect CLI's unstable formatVersion currently emits `${name} v${version}`.
      // Extract the version token so surrounding presentation changes do not break updates.
      const reportedVersion = /\bv(\S+)\s*$/.exec(preflight.stdout)?.[1];
      if (preflight.code !== 0 || reportedVersion !== targetVersion) {
        // A completed package install can still be unusable under this Node or on
        // this machine. Remove its sentinel and tree so a retry of the same
        // version performs a clean install instead of reusing a known-bad one.
        yield* removePinnedRuntimeInstallation({
          baseDir: serverConfig.baseDir,
          version: targetVersion,
          fs,
          path,
        }).pipe(
          Effect.mapError((error) =>
            failWith(`Could not remove the failed Tangent ${targetVersion} installation.`, error),
          ),
        );
        return yield* failWith(
          preflight.code !== 0
            ? `The installed Tangent ${targetVersion} failed its version check (exit code ${String(preflight.code)}).`
            : `The installed runtime did not report the requested Tangent ${targetVersion} version.`,
        );
      }

      if (activeMethod === "boot-service") {
        const homeDir = env.HOME ?? "";
        const unitPath = path.join(
          homeDir,
          ".config",
          "systemd",
          "user",
          PERSONAL_BOOT_SERVICE_UNIT_FILE,
        );
        const previousUnit = yield* fs
          .readFileString(unitPath)
          .pipe(
            Effect.mapError((cause) => failWith("Could not read the current systemd unit.", cause)),
          );
        // Same shape bootService.install writes, so host lifecycle commands
        // still recognize the unit as current.
        const unit = renderBootServiceUnit({
          nodePath: host.execPath,
          t3EntryPath: runtimePaths.entryPath,
          baseDir: serverConfig.baseDir,
          logPath: path.join(serverConfig.logsDir, "boot-service.log"),
          unitPath,
          displayName: PERSONAL_BOOT_SERVICE_IDENTITY.displayName,
          unitFile: PERSONAL_BOOT_SERVICE_UNIT_FILE,
        });
        yield* writeUnitAtomically(unitPath, unit).pipe(
          Effect.mapError((cause) => failWith("Could not update the systemd unit.", cause)),
        );

        const reloadSystemd = Effect.fn("cloud.server_self_update.reload_systemd")(function* () {
          const reload = yield* runner
            .run({ command: "systemctl", args: ["--user", "daemon-reload"] })
            .pipe(Effect.mapError((cause) => failWith("Could not reload systemd units.", cause)));
          if (reload.code !== 0) {
            return yield* failWith(
              `Reloading systemd units failed (exit code ${String(reload.code)}).`,
            );
          }
        });

        yield* reloadSystemd().pipe(
          Effect.catch((reloadError) =>
            writeUnitAtomically(unitPath, previousUnit).pipe(
              Effect.mapError((rollbackCause) =>
                failWith("Could not restore the previous systemd unit.", {
                  reloadError,
                  rollbackCause,
                }),
              ),
              // Systemd should still have the old unit in memory after the
              // failed reload, but retry after restoring in case it applied a
              // partial update before returning an error.
              Effect.andThen(reloadSystemd().pipe(Effect.ignore)),
              Effect.andThen(Effect.fail(reloadError)),
            ),
          ),
        );
        yield* Effect.logInfo("Server self-update installed; restarting boot service.", {
          targetVersion,
        });
        // A successful systemd restart stops this process, so the RPC is
        // interrupted and the reconnecting client observes the new version.
        // A rejected restart returns while the old process is still alive;
        // restore the previous unit and report that failure through the RPC.
        yield* Effect.gen(function* () {
          const restart = yield* runner
            .run({
              command: "systemctl",
              args: ["--user", "restart", PERSONAL_BOOT_SERVICE_UNIT_FILE],
            })
            .pipe(
              Effect.mapError((cause) =>
                failWith("Could not restart the systemd boot service.", cause),
              ),
            );
          if (restart.code !== 0) {
            return yield* failWith(
              `Restarting the systemd boot service failed (exit code ${String(restart.code)}).`,
            );
          }
        }).pipe(
          Effect.catch((restartError) =>
            writeUnitAtomically(unitPath, previousUnit).pipe(
              Effect.andThen(reloadSystemd()),
              Effect.mapError((rollbackError) =>
                failWith("Could not restore the previous systemd unit.", {
                  restartError,
                  rollbackError,
                }),
              ),
              Effect.andThen(Effect.fail(restartError)),
            ),
          ),
        );
      } else {
        // Spawn the shim before acknowledging the RPC so ENOENT/EACCES and
        // other launch failures leave this server alive and return a useful
        // error. The shim itself waits until after the acknowledgement and
        // deferred exit before binding the replacement server.
        yield* host
          .spawnDetached("/bin/sh", [
            "-c",
            'sleep 3; exec "$@"',
            "tangent-self-update",
            host.execPath,
            runtimePaths.entryPath,
            ...host.cliArgs,
          ])
          .pipe(
            Effect.mapError((cause) =>
              failWith("Could not start the replacement Tangent process.", cause),
            ),
          );
        yield* Effect.logInfo("Server self-update installed; respawning.", { targetVersion });
        yield* scheduleRestart(
          Effect.try({
            try: () => host.exitProcess(),
            catch: (cause) => failWith("Could not exit the replaced t3 process.", cause),
          }).pipe(
            Effect.catch((error) =>
              Effect.logError("Server self-update could not exit the replaced process.").pipe(
                Effect.annotateLogs({ targetVersion, error: error.reason }),
                Effect.ensuring(Ref.set(inFlight, false)),
              ),
            ),
          ),
        );
      }

      return { targetVersion, method: activeMethod };
    }).pipe(Effect.onError(() => Ref.set(inFlight, false)));
  });

  return ServerSelfUpdate.of({ update });
});

export const layer = Layer.effect(ServerSelfUpdate, make()).pipe(
  Layer.provide(ProcessRunner.layer),
);
