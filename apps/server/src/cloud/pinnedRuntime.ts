import * as NodeCrypto from "node:crypto";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  CLI_RELEASE_CHECKSUMS_FILE,
  cliArchiveFileName,
  cliArchivePlatformKey,
  cliArchiveTarCommand,
  cliReleaseDownloadBaseUrl,
  cliRuntimeInstallSentinel,
  parseChecksums,
} from "@t3tools/shared/cliRelease";

import * as ProcessRunner from "../processRunner.ts";

/**
 * A pinned runtime is an exact t3 release archive unpacked into
 * <baseDir>/runtime/versions/<version>: the self-contained executable, the
 * web client, and the native packages beside it. The boot service points its
 * unit or launch agent at the executable, and server self-update installs the
 * target version here before switching over. The runtime never depends on a
 * Node or npm on the machine; the only npm involvement in T3 Code is the `t3`
 * package for people who prefer `npx t3` or `npm install -g t3`, and even a
 * CLI installed that way pins an archive when it sets up the service.
 */
const PINNED_RUNTIME_DIR = "runtime";
const PINNED_RUNTIME_INSTALL_TIMEOUT = Duration.minutes(10);
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_CHECKSUM_BYTES = 64 * 1024;
// Boot-service setup and remote update can construct separate layers. Serialize
// the complete install transaction across every caller in this process.
const pinnedRuntimeInstallLock = Semaphore.makeUnsafe(1);

export interface PinnedRuntimePaths {
  readonly versionDir: string;
  /** The executable. Its existence is what marks a runtime as present. */
  readonly entryPath: string;
  readonly sentinelPath: string;
}

/** The exact command that runs a pinned runtime. */
export function pinnedRuntimeCommand(paths: PinnedRuntimePaths): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  return { command: paths.entryPath, args: [] };
}

export function pinnedRuntimeVersionsDir(path: Path.Path, baseDir: string): string {
  return path.join(baseDir, PINNED_RUNTIME_DIR, "versions");
}

export function pinnedRuntimePaths(
  path: Path.Path,
  baseDir: string,
  version: string,
  platform: NodeJS.Platform,
): PinnedRuntimePaths {
  const versionDir = path.join(pinnedRuntimeVersionsDir(path, baseDir), version);
  return {
    versionDir,
    entryPath: path.join(versionDir, platform === "win32" ? "t3.exe" : "t3"),
    sentinelPath: path.join(versionDir, ".install-complete"),
  };
}

export class PinnedRuntimeInstallError extends Schema.TaggedError<PinnedRuntimeInstallError>()(
  "PinnedRuntimeInstallError",
  {
    step: Schema.String,
    exitCode: Schema.optional(Schema.Number),
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.exitCode === undefined
      ? `Pinned runtime install failed while ${this.step}.`
      : `Pinned runtime install failed while ${this.step} (exit code ${this.exitCode}).`;
  }
}

export class PinnedRuntimePreflightBlockedError extends Schema.TaggedError<PinnedRuntimePreflightBlockedError>()(
  "PinnedRuntimePreflightBlockedError",
  {
    version: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export type PinnedRuntimeProgress =
  | { readonly stage: "download"; readonly received: number; readonly total: number | undefined }
  | { readonly stage: "verify" | "extract" | "validate" | "cached" };

/**
 * Installs the t3 release archive for `version` into the pinned runtime
 * directory unless a complete install is already there, and returns its
 * paths. The sentinel is written only after extraction and validation
 * succeed; checking the entry file alone is not enough, since tar writes the
 * executable before the last native package and a killed install leaves a
 * plausible-looking but broken tree behind.
 */

interface PinnedRuntimeInstallInput {
  readonly baseDir: string;
  readonly version: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly runner: ProcessRunner.ProcessRunner["Service"];
  readonly validate: (
    paths: PinnedRuntimePaths,
  ) => Effect.Effect<void, PinnedRuntimeInstallError | PinnedRuntimePreflightBlockedError>;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly httpClient: HttpClient.HttpClient;
  readonly releaseBaseUrl?: string | undefined;
  readonly onProgress?: (progress: PinnedRuntimeProgress) => void;
}

const isPinnedRuntimeInstallError = Schema.is(PinnedRuntimeInstallError);

const fetchReleaseAsset = Effect.fn("cloud.pinned_runtime.fetch_release_asset")(function* (
  input: PinnedRuntimeInstallInput,
  url: string,
  destination: string,
  maxBytes: number,
  step: string,
  onProgress?: (progress: PinnedRuntimeProgress) => void,
) {
  return yield* Effect.gen(function* () {
    const response = yield* input.httpClient
      .execute(HttpClientRequest.get(url))
      .pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
    const length = Number(response.headers["content-length"]);
    const total = Number.isFinite(length) && length > 0 ? length : undefined;
    if (total !== undefined && total > maxBytes) {
      return yield* new PinnedRuntimeInstallError({ step: `${step} (exceeds ${maxBytes} bytes)` });
    }
    const hash = NodeCrypto.createHash("sha256");
    let received = 0;
    onProgress?.({ stage: "download", received, total });
    yield* response.stream.pipe(
      Stream.mapEffect((chunk) =>
        Effect.gen(function* () {
          received += chunk.byteLength;
          if (received > maxBytes) {
            return yield* new PinnedRuntimeInstallError({
              step: `${step} (exceeds ${maxBytes} bytes)`,
            });
          }
          hash.update(chunk);
          onProgress?.({ stage: "download", received, total });
          return chunk;
        }),
      ),
      Stream.run(input.fs.sink(destination)),
    );
    if (total === undefined && received > 0) {
      onProgress?.({ stage: "download", received, total: received });
    }
    return hash.digest("hex");
  }).pipe(
    Effect.mapError((cause) =>
      isPinnedRuntimeInstallError(cause) ? cause : new PinnedRuntimeInstallError({ step, cause }),
    ),
    Effect.timeoutOrElse({
      duration: PINNED_RUNTIME_INSTALL_TIMEOUT,
      orElse: () => Effect.fail(new PinnedRuntimeInstallError({ step: `${step} (timed out)` })),
    }),
  );
});

const retainReleaseArchives = Effect.fn("cloud.pinned_runtime.retain_archives")(function* (
  input: PinnedRuntimeInstallInput,
  directory: string,
  currentName: string,
) {
  const names = yield* input.fs.readDirectory(directory);
  const archives = yield* Effect.forEach(
    names.filter((name) => name.endsWith(".tar.gz") || name.endsWith(".zip")),
    (name) =>
      input.fs.stat(input.path.join(directory, name)).pipe(
        Effect.map((stat) => ({
          name,
          modifiedAt: Option.getOrUndefined(stat.mtime)?.getTime() ?? 0,
        })),
      ),
  );
  const stale = archives
    .toSorted(
      (a, b) =>
        Number(b.name === currentName) - Number(a.name === currentName) ||
        b.modifiedAt - a.modifiedAt ||
        b.name.localeCompare(a.name),
    )
    .slice(2);
  yield* Effect.forEach(stale, ({ name }) => input.fs.remove(input.path.join(directory, name)), {
    discard: true,
  });
});

/**
 * Downloads the release archive for this platform, verifies it against the
 * release's checksum file, and unpacks it so the executable sits directly in
 * the staging directory. Only `tar` is required on the host; every supported
 * OS ships one that reads gzip and zip.
 */
const installFromArchive = Effect.fn("cloud.pinned_runtime.install_archive")(function* (
  input: PinnedRuntimeInstallInput,
  stagingDir: string,
) {
  const { fs, path } = input;
  const platformKey = cliArchivePlatformKey(input.platform, input.arch);
  if (platformKey === undefined) {
    return yield* new PinnedRuntimeInstallError({
      step: `selecting a t3 release archive for ${input.platform}-${input.arch}`,
    });
  }
  const baseUrl = cliReleaseDownloadBaseUrl(input.version, input.releaseBaseUrl);
  const fileName = cliArchiveFileName(input.version, platformKey);
  const checksumPath = path.join(stagingDir, CLI_RELEASE_CHECKSUMS_FILE);
  input.onProgress?.({ stage: "download", received: 0, total: undefined });
  yield* fetchReleaseAsset(
    input,
    `${baseUrl}/${CLI_RELEASE_CHECKSUMS_FILE}`,
    checksumPath,
    MAX_CHECKSUM_BYTES,
    "downloading the t3 release checksums",
  );
  const checksums = parseChecksums(
    yield* fs
      .readFileString(checksumPath)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PinnedRuntimeInstallError({ step: "reading the release checksums", cause }),
        ),
      ),
  );
  const expected = checksums.get(fileName);
  if (expected === undefined) {
    return yield* new PinnedRuntimeInstallError({
      step: `finding ${fileName} in the t3 release checksums`,
    });
  }
  // The unique staging directory owns partial downloads; interruption removes them.
  const temporaryArchive = path.join(stagingDir, ".archive.tmp");
  const digest = yield* fetchReleaseAsset(
    input,
    `${baseUrl}/${fileName}`,
    temporaryArchive,
    MAX_ARCHIVE_BYTES,
    "downloading the t3 release archive",
    input.onProgress,
  );
  input.onProgress?.({ stage: "verify" });
  if (digest !== expected) {
    return yield* new PinnedRuntimeInstallError({
      step: "verifying the t3 release archive checksum",
    });
  }
  const archivesDir = path.join(input.baseDir, PINNED_RUNTIME_DIR, "archives");
  const archivePath = path.join(archivesDir, fileName);
  yield* Effect.gen(function* () {
    yield* fs.makeDirectory(archivesDir, { recursive: true });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(temporaryArchive, { flag: "r+" });
        yield* file.sync;
      }),
    );
    yield* fs.rename(temporaryArchive, archivePath);
    yield* retainReleaseArchives(input, archivesDir, fileName);
    yield* fs.remove(checksumPath);
  }).pipe(
    Effect.mapError(
      (cause) =>
        new PinnedRuntimeInstallError({ step: "saving the verified release archive", cause }),
    ),
  );
  input.onProgress?.({ stage: "extract" });
  const extractStep = "extracting the t3 release archive";
  // The archive wraps everything in one directory named after its stem;
  // strip it so the executable lands at <versionDir>/t3.
  yield* input.runner
    .run({
      command: cliArchiveTarCommand(input.platform, process.env),
      args: ["-xf", archivePath, "-C", stagingDir, "--strip-components=1"],
      timeout: PINNED_RUNTIME_INSTALL_TIMEOUT,
    })
    .pipe(
      Effect.mapError((cause) => new PinnedRuntimeInstallError({ step: extractStep, cause })),
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) =>
          new PinnedRuntimeInstallError({
            step: extractStep,
            exitCode: Number(result.code),
            stdoutLength: result.stdout.length,
            stderrLength: result.stderr.length,
          }),
      ),
    );
});

const installPinnedRuntime = Effect.fn("cloud.pinned_runtime.ensure_installed")(function* (
  input: PinnedRuntimeInstallInput,
) {
  const { fs } = input;
  const paths = pinnedRuntimePaths(input.path, input.baseDir, input.version, input.platform);
  const expectedSentinel = cliRuntimeInstallSentinel(input.version, input.releaseBaseUrl);
  const [versionDirExists, entryExists, sentinel] = yield* Effect.all([
    fs.exists(paths.versionDir),
    fs.exists(paths.entryPath),
    fs.readFileString(paths.sentinelPath).pipe(Effect.option),
  ]).pipe(
    Effect.mapError(
      (cause) => new PinnedRuntimeInstallError({ step: "checking the pinned runtime", cause }),
    ),
  );
  const alreadyPinned =
    entryExists && Option.isSome(sentinel) && sentinel.value === expectedSentinel;
  if (alreadyPinned) {
    input.onProgress?.({ stage: "cached" });
    yield* input.validate(paths);
    return paths;
  }
  if (versionDirExists) {
    yield* fs.remove(paths.versionDir, { recursive: true, force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new PinnedRuntimeInstallError({
            step: "removing an incomplete pinned runtime",
            cause,
          }),
      ),
    );
  }

  const versionsDir = input.path.dirname(paths.versionDir);
  yield* fs.makeDirectory(versionsDir, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new PinnedRuntimeInstallError({
          step: "preparing the pinned runtime directory",
          cause,
        }),
    ),
  );
  const stagingDir = yield* fs
    .makeTempDirectory({
      directory: versionsDir,
      prefix: ".staging-",
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new PinnedRuntimeInstallError({
            step: "preparing the pinned runtime directory",
            cause,
          }),
      ),
    );
  const stagingPaths: PinnedRuntimePaths = {
    versionDir: stagingDir,
    entryPath: input.path.join(stagingDir, input.path.relative(paths.versionDir, paths.entryPath)),
    sentinelPath: input.path.join(stagingDir, ".install-complete"),
  };

  return yield* Effect.gen(function* () {
    yield* installFromArchive(input, stagingDir);

    input.onProgress?.({ stage: "validate" });
    yield* input.validate(stagingPaths);
    yield* fs
      .writeFileString(stagingPaths.sentinelPath, expectedSentinel)
      .pipe(
        Effect.mapError(
          (cause) =>
            new PinnedRuntimeInstallError({ step: "recording the completed install", cause }),
        ),
      );
    const published = yield* fs.rename(stagingDir, paths.versionDir).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.all([
          fs.exists(paths.entryPath),
          fs.readFileString(paths.sentinelPath).pipe(Effect.option),
        ]).pipe(
          Effect.mapError(
            (checkCause) =>
              new PinnedRuntimeInstallError({
                step: "checking a concurrently published pinned runtime",
                cause: checkCause,
              }),
          ),
          Effect.flatMap(([publishedEntryExists, publishedSentinel]) =>
            publishedEntryExists &&
            Option.isSome(publishedSentinel) &&
            publishedSentinel.value === expectedSentinel
              ? Effect.succeed(false)
              : Effect.fail(
                  new PinnedRuntimeInstallError({
                    step: "publishing the pinned runtime",
                    cause,
                  }),
                ),
          ),
        ),
      ),
    );
    if (!published) yield* input.validate(paths);
    return paths;
  }).pipe(
    Effect.ensuring(fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
});

export const ensurePinnedRuntimeInstalled = (input: PinnedRuntimeInstallInput) =>
  pinnedRuntimeInstallLock.withPermit(installPinnedRuntime(input));
