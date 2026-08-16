import { describe, expect, it } from "vite-plus/test";

import { resolveHomeHeaderPlacement } from "./home-header-placement";

describe("resolveHomeHeaderPlacement", () => {
  it("keeps home actions above the fork chat composer", () => {
    expect(
      resolveHomeHeaderPlacement({
        bottomComposerPresent: true,
        nativeMailSearchToolbarSupported: true,
      }),
    ).toBe("top");
    expect(
      resolveHomeHeaderPlacement({
        bottomComposerPresent: true,
        nativeMailSearchToolbarSupported: false,
      }),
    ).toBe("top");
  });

  it("uses upstream bottom toolbar presentations without a bottom composer", () => {
    expect(
      resolveHomeHeaderPlacement({
        bottomComposerPresent: false,
        nativeMailSearchToolbarSupported: true,
      }),
    ).toBe("native-mail-bottom");
    expect(
      resolveHomeHeaderPlacement({
        bottomComposerPresent: false,
        nativeMailSearchToolbarSupported: false,
      }),
    ).toBe("legacy-bottom");
  });
});
