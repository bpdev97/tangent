import { describe, expect, it } from "vite-plus/test";

import { resolvePersonalReleaseVersion } from "./personal-release-version.ts";

describe("personal release versions", () => {
  it("orders numeric versions and ignores upstream tags", () => {
    expect(resolvePersonalReleaseVersion("personal-v0.1.10", ["personal-v0.1.9", "v9.0.0"])).toBe(
      "0.1.10",
    );
  });

  it.each(["0.1.50", "0.1.49", "0.0.99"])("rejects reused or older version %s", (version) => {
    expect(() => resolvePersonalReleaseVersion(version, ["personal-v0.1.50"])).toThrow(
      "must be newer",
    );
  });

  it.each(["", "01.2.3", "1.2", "1.2.3-beta.1", "1.2.3\nother"])(
    "rejects invalid stable version %j",
    (version) => {
      expect(() => resolvePersonalReleaseVersion(version, [])).toThrow("X.Y.Z");
    },
  );
});
