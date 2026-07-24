import { describe, expect, it } from "vite-plus/test";

import { PERSONAL_DISTRIBUTION } from "../downstream/config.ts";

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
    expect([mobile.scheme, mobile.developmentScheme, mobile.previewScheme]).toEqual([
      "bpdev-code",
      "bpdev-code-dev",
      "bpdev-code-preview",
    ]);
    expect(mobile.iosBundleIdentifier).not.toBe("com.t3tools.t3code");
    expect(macos.productName).toBe("Tangent");
    expect(macos.appId).not.toBe("com.t3tools.t3code");
    expect(macos.stateHomeDirectoryName).toBe(".bpdev-code");
    expect(macos.userDataDirectoryName).toBe("bpdev-code");
  });
});
