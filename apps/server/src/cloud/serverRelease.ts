import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  resolveServerReleaseArtifact,
  type ServerReleaseArtifact,
} from "@t3tools/shared/serverRelease";

import { PERSONAL_DISTRIBUTION } from "../../../../downstream/config.ts";

const CHECKSUM_MAX_BYTES = 4 * 1024;
const ARTIFACT_MAX_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1_000;
const RETAINED_RELEASE_ARCHIVES = 2;

export type ReleaseFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface VerifiedServerReleaseArtifact {
  readonly packagePath: string;
  readonly sha256: string;
  readonly installIdentity: string;
}

export class ServerReleaseArtifactError extends Schema.TaggedErrorClass<ServerReleaseArtifactError>()(
  "ServerReleaseArtifactError",
  {
    step: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Tangent server release failed while ${this.step}.`;
  }
}

class ServerReleaseTransferError extends Schema.TaggedErrorClass<ServerReleaseTransferError>()(
  "ServerReleaseTransferError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
const isServerReleaseTransferError = Schema.is(ServerReleaseTransferError);

export function personalServerReleaseArtifact(version: string): ServerReleaseArtifact {
  const { repository, serverRelease } = PERSONAL_DISTRIBUTION;
  return resolveServerReleaseArtifact({ repository, ...serverRelease }, version);
}

export function parseReleaseSha256(
  checksumText: string,
  expectedArtifactName: string,
): string | null {
  for (const rawLine of checksumText.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})(?:\s+[*]?(.+))?$/.exec(rawLine.trim());
    if (!match) {
      continue;
    }
    const checksumFile = match[2]?.trim();
    if (checksumFile !== undefined && checksumFile !== expectedArtifactName) {
      continue;
    }
    return match[1]?.toLowerCase() ?? null;
  }
  return null;
}

async function fetchReleaseBytes(input: {
  readonly url: string;
  readonly maxBytes: number;
  readonly fetch: ReleaseFetch;
}): Promise<Uint8Array> {
  const response = await input.fetch(input.url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Tangent-server-updater",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub Release returned HTTP ${response.status}.`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
    throw new Error(`GitHub Release asset exceeds ${input.maxBytes} bytes.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > input.maxBytes) {
    throw new Error(`GitHub Release asset exceeds ${input.maxBytes} bytes.`);
  }
  return bytes;
}

const fetchReleaseResponse = Effect.fn("cloud.server_release.fetch_release_response")(
  function* (input: {
    readonly url: string;
    readonly maxBytes: number;
    readonly fetch: ReleaseFetch;
  }) {
    const response = yield* Effect.tryPromise(() =>
      input.fetch(input.url, {
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "Tangent-server-updater",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      }),
    );
    if (!response.ok) {
      return yield* new ServerReleaseTransferError({
        detail: `GitHub Release returned HTTP ${response.status}.`,
      });
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
      return yield* new ServerReleaseTransferError({
        detail: `GitHub Release asset exceeds ${input.maxBytes} bytes.`,
      });
    }
    if (!response.body) {
      return yield* new ServerReleaseTransferError({
        detail: "GitHub Release returned an empty response body.",
      });
    }
    return response;
  },
);

const streamReleaseArtifact = Effect.fn("cloud.server_release.stream_release_artifact")(
  function* (input: {
    readonly response: Response;
    readonly packagePath: string;
    readonly maxBytes: number;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const hash = NodeCrypto.createHash("sha256");
    let receivedBytes = 0;
    const body = input.response.body;
    if (!body) {
      return yield* new ServerReleaseTransferError({
        detail: "Release response body is unavailable.",
      });
    }

    yield* Stream.fromReadableStream({
      evaluate: () => body,
      onError: (cause) =>
        new ServerReleaseTransferError({
          detail: "Failed while reading the release response.",
          cause,
        }),
    }).pipe(
      Stream.mapEffect((chunk) =>
        Effect.gen(function* () {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > input.maxBytes) {
            return yield* new ServerReleaseTransferError({
              detail: `GitHub Release asset exceeds ${input.maxBytes} bytes.`,
            });
          }
          hash.update(chunk);
          return chunk;
        }),
      ),
      Stream.run(fs.sink(input.packagePath)),
    );
    return hash.digest("hex");
  },
);

const pruneReleaseDownloads = Effect.fn("cloud.server_release.prune_release_downloads")(
  function* (input: { readonly downloadDir: string; readonly currentPackagePath: string }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const prefix = `${PERSONAL_DISTRIBUTION.serverRelease.artifactNamePrefix}-`;
    const entries = yield* fs.readDirectory(input.downloadDir);

    yield* Effect.forEach(
      entries.filter((name) => name.startsWith(`.${prefix}`) && name.endsWith(".tmp")),
      (name) => fs.remove(path.join(input.downloadDir, name), { force: true }),
      { discard: true },
    );

    const archives = yield* Effect.forEach(
      entries.filter((name) => name.startsWith(prefix) && name.endsWith(".tgz")),
      (name) =>
        Effect.map(fs.stat(path.join(input.downloadDir, name)), (stat) => ({
          name,
          modifiedAt: Option.match(stat.mtime, {
            onNone: () => 0,
            onSome: (mtime) => mtime.getTime(),
          }),
        })),
    );
    const currentName = path.basename(input.currentPackagePath);
    const stale = archives
      .toSorted(
        (left, right) =>
          Number(right.name === currentName) - Number(left.name === currentName) ||
          right.modifiedAt - left.modifiedAt ||
          right.name.localeCompare(left.name),
      )
      .slice(RETAINED_RELEASE_ARCHIVES);
    yield* Effect.forEach(
      stale,
      ({ name }) => fs.remove(path.join(input.downloadDir, name), { force: true }),
      { discard: true },
    );
  },
);

export const downloadPersonalServerRelease = Effect.fn(
  "cloud.server_release.download_personal_server_release",
)(function* (input: {
  readonly baseDir: string;
  readonly version: string;
  readonly fetch?: ReleaseFetch;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const release = personalServerReleaseArtifact(input.version);
  const fetchImpl = input.fetch ?? globalThis.fetch;

  const checksumBytes = yield* Effect.tryPromise({
    try: () =>
      fetchReleaseBytes({
        url: release.checksumUrl,
        maxBytes: CHECKSUM_MAX_BYTES,
        fetch: fetchImpl,
      }),
    catch: (cause) =>
      new ServerReleaseArtifactError({
        step: `downloading ${release.checksumName}`,
        cause,
      }),
  });
  const expectedSha256 = parseReleaseSha256(
    new TextDecoder().decode(checksumBytes),
    release.artifactName,
  );
  if (expectedSha256 === null) {
    return yield* new ServerReleaseArtifactError({
      step: `reading ${release.checksumName}`,
    });
  }

  const downloadDir = path.join(input.baseDir, "runtime", "downloads");
  const packagePath = path.join(downloadDir, release.artifactName);
  const temporaryPath = path.join(
    downloadDir,
    `.${release.artifactName}.${NodeCrypto.randomUUID()}.tmp`,
  );
  yield* fs.makeDirectory(downloadDir, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new ServerReleaseArtifactError({
          step: `preparing ${release.artifactName}`,
          cause,
        }),
    ),
  );
  const actualSha256 = yield* Effect.gen(function* () {
    const response = yield* fetchReleaseResponse({
      url: release.artifactUrl,
      maxBytes: ARTIFACT_MAX_BYTES,
      fetch: fetchImpl,
    });
    const sha256 = yield* streamReleaseArtifact({
      response,
      packagePath: temporaryPath,
      maxBytes: ARTIFACT_MAX_BYTES,
    });
    if (sha256 !== expectedSha256) {
      return yield* new ServerReleaseTransferError({
        detail: `SHA-256 mismatch: expected ${expectedSha256}, received ${sha256}.`,
      });
    }
    yield* Effect.scoped(
      Effect.flatMap(fs.open(temporaryPath, { flag: "r" }), (file) => file.sync),
    );
    yield* fs.rename(temporaryPath, packagePath);
    return sha256;
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ServerReleaseArtifactError({
          step:
            isServerReleaseTransferError(cause) && cause.detail.startsWith("SHA-256 mismatch")
              ? `verifying ${release.artifactName} (SHA-256 mismatch)`
              : `downloading and saving ${release.artifactName}`,
          cause,
        }),
    ),
    Effect.ensuring(fs.remove(temporaryPath, { force: true }).pipe(Effect.ignore)),
  );
  yield* pruneReleaseDownloads({ downloadDir, currentPackagePath: packagePath }).pipe(
    Effect.mapError(
      (cause) =>
        new ServerReleaseArtifactError({
          step: `pruning old server releases`,
          cause,
        }),
    ),
  );

  return {
    packagePath,
    sha256: actualSha256,
    installIdentity: `github-release:${release.tag}:${actualSha256}`,
  } satisfies VerifiedServerReleaseArtifact;
});
