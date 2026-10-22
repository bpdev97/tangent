/**
 * Tangent(FORK-LAUNCHER-001): an update started from a client only switches the version the
 * launcher runs, so the server that update committed brings the `t3` links and the service unit
 * along. See docs/fork/stable-launcher.md.
 */
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import packageJson from "../../package.json" with { type: "json" };
import * as ProcessRunner from "../processRunner.ts";
import {
  BOOT_SERVICE_PLIST_FILE,
  BOOT_SERVICE_UNIT_FILE,
  bootServiceBaseDirOf,
  bootServiceProgramOf,
  escapeXmlText,
  quoteSystemdValue,
  unescapeXmlText,
} from "./bootService.ts";
import { launcherOwnsVersionsDir, pinnedRuntimeVersionsDir } from "./pinnedRuntime.ts";
import {
  adoptSelectedRuntime,
  followCurrentOnPath,
  installStableLauncher,
  selectedServiceVersion,
  stableLauncherPaths,
} from "./stableLauncher.ts";

/**
 * The unit or plist with its launcher executable replaced and, in a plist, this home's versioned
 * runtime directories on PATH replaced by `runtime/current`. Everything else is kept.
 */
export function migrateBootServiceUnit(
  contents: string,
  input: { readonly program: string; readonly followCurrent: (directory: string) => string },
): string {
  if (/^ExecStart=/m.test(contents)) {
    return contents.replace(
      /^(ExecStart=)("(?:\\.|[^"\\])*"|\S+)/m,
      (_, prefix: string) => `${prefix}${quoteSystemdValue(input.program)}`,
    );
  }
  return contents
    .replace(
      /(<key>ProgramArguments<\/key>\s*<array>\s*<string>)[^<]*(<\/string>)/,
      (_, open: string, close: string) => `${open}${escapeXmlText(input.program)}${close}`,
    )
    .replace(
      /(<key>PATH<\/key>\s*<string>)([^<]*)(<\/string>)/,
      (_, open: string, value: string, close: string) =>
        `${open}${escapeXmlText(
          Array.from(new Set(unescapeXmlText(value).split(":").map(input.followCurrent))).join(":"),
        )}${close}`,
    );
}

/**
 * Runs once a launcher-managed server is the active version: points `runtime/current` and the
 * `t3` links at it, refreshes the fixed launcher, and moves a unit that still names a versioned
 * runtime onto the fixed launcher. Does nothing once the service state selects another version,
 * as after `t3 update` declines to restart. The running launcher keeps its own file; launchd and
 * systemd use the new program the next time they load the unit. Never fails startup.
 */
export const settleServiceRuntime = Effect.fn("cloud.stable_launcher.settle")(
  function* (input: { readonly baseDir: string; readonly version: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcess.Platform;
    const home = yield* HostProcess.HomeDirectory;
    if (platform !== "darwin" && platform !== "linux") return;
    if ((yield* selectedServiceVersion(input.baseDir)) !== input.version) return;
    yield* adoptSelectedRuntime({ baseDir: input.baseDir });
    if ((yield* selectedServiceVersion(input.baseDir)) !== input.version) return;

    const unitPath =
      platform === "darwin"
        ? path.join(home, "Library", "LaunchAgents", BOOT_SERVICE_PLIST_FILE)
        : path.join(home, ".config", "systemd", "user", BOOT_SERVICE_UNIT_FILE);
    const unit = yield* fs.readFileString(unitPath).pipe(Effect.option);
    if (Option.isNone(unit)) return;
    const servedHome = bootServiceBaseDirOf(unit.value);
    if (servedHome === undefined || path.resolve(servedHome) !== path.resolve(input.baseDir)) {
      return;
    }
    const program = bootServiceProgramOf(unit.value);
    const launcher = stableLauncherPaths(path, input.baseDir);
    if (
      program === undefined ||
      (program !== launcher.entryPath &&
        !launcherOwnsVersionsDir(path, pinnedRuntimeVersionsDir(path, input.baseDir), program))
    ) {
      return;
    }
    const installed = yield* installStableLauncher(input);
    if (Option.isNone(installed)) return;
    const migrated = migrateBootServiceUnit(unit.value, {
      program: installed.value,
      followCurrent: yield* followCurrentOnPath(input.baseDir),
    });
    if (migrated === unit.value) return;
    // `t3 service install` may have rewritten the unit, or selected another version, meanwhile.
    const latest = yield* fs.readFileString(unitPath).pipe(Effect.option);
    if (
      Option.getOrUndefined(latest) !== unit.value ||
      (yield* selectedServiceVersion(input.baseDir)) !== input.version
    ) {
      return;
    }
    const staged = `${unitPath}.${process.pid}.tmp`;
    yield* fs.writeFileString(staged, migrated, { mode: 0o600 });
    yield* fs.rename(staged, unitPath);
    yield* Effect.logInfo("Moved the background service onto its fixed launcher path.", {
      launcher: installed.value,
      unitPath,
    });
  },
  Effect.catch((cause) => Effect.logWarning("Could not settle the t3 runtime layout.", { cause })),
);

/** The server provides a ProcessRunner, but startup does not require one; without it, skip. */
export const settleThisServiceRuntime = (baseDir: string) =>
  Effect.serviceOption(ProcessRunner.ProcessRunner).pipe(
    Effect.flatMap((runner) =>
      Option.isNone(runner)
        ? Effect.void
        : settleServiceRuntime({ baseDir, version: packageJson.version }).pipe(
            Effect.provideService(ProcessRunner.ProcessRunner, runner.value),
          ),
    ),
  );
