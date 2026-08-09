import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import mobilePackageJson from "../apps/mobile/package.json" with { type: "json" };

import { PERSONAL_DISTRIBUTION } from "../downstream/config.ts";
import { PERSONAL_MOBILE_DISTRIBUTION } from "../downstream/mobile-config.ts";

describe("personal distribution identity", () => {
  it("keeps installed identities and persistent state distinct from upstream", () => {
    const { connect, mobile, macos, repository, serverRelease } = PERSONAL_DISTRIBUTION;

    expect(repository).toEqual({ owner: "bpdev97", name: "tangent" });
    expect(connect).toEqual({ bootServiceName: "tangent", displayName: "Tangent" });
    expect(serverRelease).toEqual({
      tagPrefix: "personal-v",
      artifactNamePrefix: "tangent-server",
    });
    expect(mobile.appName).toBe("Tangent");
    expect(mobile).toBe(PERSONAL_MOBILE_DISTRIBUTION);
    expect([mobile.scheme, mobile.developmentScheme, mobile.previewScheme]).toEqual([
      "bpdev-code",
      "bpdev-code-dev",
      "bpdev-code-preview",
    ]);
    expect(mobile.iosBundleIdentifier).not.toBe("com.t3tools.t3code");
    expect(macos.productName).toBe("Tangent");
    expect([macos.scheme, macos.developmentScheme]).toEqual(["bpdev-code", "bpdev-code-dev"]);
    expect(macos.appId).not.toBe("com.t3tools.t3code");
    expect(macos.stateHomeDirectoryName).toBe(".bpdev-code");
    expect(macos.userDataDirectoryName).toBe("bpdev-code");
  });

  it.effect("keeps desktop-only distribution changes out of the mobile native fingerprint", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
      const mobileConsumers = [
        "apps/mobile/app.config.ts",
        "apps/mobile/src/App.tsx",
        "apps/mobile/src/branding.ts",
        "apps/mobile/src/features/connection/pairing.ts",
      ];

      for (const relativePath of mobileConsumers) {
        const source = yield* fs.readFileString(path.join(repoRoot, relativePath));
        expect(source).toContain("downstream/mobile-config");
        expect(source).not.toContain("downstream/config");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("starts mobile development clients through the personal URL schemes", () => {
    expect(mobilePackageJson.scripts["dev:client"]).toContain("--scheme bpdev-code-dev");
    expect(mobilePackageJson.scripts["dev:client:preview"]).toContain(
      "--scheme bpdev-code-preview",
    );
    expect(mobilePackageJson.scripts.showcase).toContain("--scheme bpdev-code");
  });
});
