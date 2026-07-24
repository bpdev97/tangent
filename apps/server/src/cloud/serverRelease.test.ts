import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  downloadPersonalServerRelease,
  parseReleaseSha256,
  personalServerReleaseArtifact,
  type ReleaseFetch,
} from "./serverRelease.ts";

it("resolves versioned Tangent GitHub Release assets", () => {
  assert.deepStrictEqual(personalServerReleaseArtifact("1.2.3"), {
    version: "1.2.3",
    tag: "personal-v1.2.3",
    artifactName: "tangent-server-1.2.3.tgz",
    checksumName: "tangent-server-1.2.3.tgz.sha256",
    artifactUrl:
      "https://github.com/bpdev97/tangent/releases/download/personal-v1.2.3/tangent-server-1.2.3.tgz",
    checksumUrl:
      "https://github.com/bpdev97/tangent/releases/download/personal-v1.2.3/tangent-server-1.2.3.tgz.sha256",
  });
});

it("only accepts a SHA-256 entry for the expected server artifact", () => {
  const checksum = "a".repeat(64);
  assert.equal(
    parseReleaseSha256(`${checksum}  tangent-server-1.2.3.tgz\n`, "tangent-server-1.2.3.tgz"),
    checksum,
  );
  assert.isNull(
    parseReleaseSha256(`${checksum}  another-package.tgz\n`, "tangent-server-1.2.3.tgz"),
  );
  assert.isNull(parseReleaseSha256("not-a-checksum\n", "tangent-server-1.2.3.tgz"));
});

it.layer(NodeServices.layer)("downloadPersonalServerRelease", (it) => {
  it.effect("downloads and verifies the release archive before saving it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "tangent-release-test-" });
      const archive = new TextEncoder().encode("verified tangent archive");
      const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
      const fetch: ReleaseFetch = async (input) => {
        const url = String(input);
        if (url.endsWith(".sha256")) {
          return new Response(`${checksum}  tangent-server-1.2.3.tgz\n`, { status: 200 });
        }
        return new Response(archive, {
          status: 200,
          headers: { "content-length": String(archive.byteLength) },
        });
      };

      const result = yield* downloadPersonalServerRelease({
        baseDir,
        version: "1.2.3",
        fetch,
      });

      assert.equal(result.sha256, checksum);
      assert.equal(result.installIdentity, `github-release:personal-v1.2.3:${checksum}`);
      assert.deepStrictEqual(yield* fs.readFile(result.packagePath), archive);
    }),
  );

  it.effect("rejects an archive whose checksum does not match", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "tangent-release-test-" });
      const fetch: ReleaseFetch = async (input) =>
        String(input).endsWith(".sha256")
          ? new Response(`${"0".repeat(64)}  tangent-server-1.2.3.tgz\n`, { status: 200 })
          : new Response("tampered archive", { status: 200 });

      const error = yield* downloadPersonalServerRelease({
        baseDir,
        version: "1.2.3",
        fetch,
      }).pipe(Effect.flip);

      assert.equal(error._tag, "ServerReleaseArtifactError");
      assert.include(error.step, "SHA-256 mismatch");
    }),
  );
});
