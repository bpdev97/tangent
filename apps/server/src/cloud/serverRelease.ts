import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  resolveServerReleaseArtifact,
  type ServerReleaseArtifact,
} from "@t3tools/shared/serverRelease";

import { PERSONAL_DISTRIBUTION } from "../../../../downstream/config.ts";

const CHECKSUM_MAX_BYTES = 4 * 1024;
const ARTIFACT_MAX_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1_000;

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

  const artifactBytes = yield* Effect.tryPromise({
    try: () =>
      fetchReleaseBytes({
        url: release.artifactUrl,
        maxBytes: ARTIFACT_MAX_BYTES,
        fetch: fetchImpl,
      }),
    catch: (cause) =>
      new ServerReleaseArtifactError({
        step: `downloading ${release.artifactName}`,
        cause,
      }),
  });
  const actualSha256 = NodeCrypto.createHash("sha256").update(artifactBytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    return yield* new ServerReleaseArtifactError({
      step: `verifying ${release.artifactName} (SHA-256 mismatch)`,
    });
  }

  const downloadDir = path.join(input.baseDir, "runtime", "downloads");
  const packagePath = path.join(downloadDir, release.artifactName);
  yield* fs.makeDirectory(downloadDir, { recursive: true }).pipe(
    Effect.andThen(fs.writeFile(packagePath, artifactBytes)),
    Effect.mapError(
      (cause) =>
        new ServerReleaseArtifactError({
          step: `saving ${release.artifactName}`,
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
