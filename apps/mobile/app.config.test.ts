import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

// Tangent(FORK-DIST-001): the iOS identifiers are Tangent's; Android stays upstream's.
it.each([
  [undefined, "com.bpdev97.t3code.ios", "com.t3tools.t3code"],
  ["development", "com.bpdev97.t3code.ios.dev", "com.t3tools.t3code.dev"],
  ["preview", "com.bpdev97.t3code.ios.preview", "com.t3tools.t3code.preview"],
  ["production", "com.bpdev97.t3code.ios", "com.t3tools.t3code"],
])(
  "keeps the iOS and Android identifiers for APP_VARIANT=%j",
  async (value, iosIdentifier, androidIdentifier) => {
    const config = await loadConfig(value);
    expect(config.ios?.bundleIdentifier).toBe(iosIdentifier);
    expect(config.android?.package).toBe(androidIdentifier);
    // Copied thread links open this app only while app.t3.codes lists it. It lists upstream's
    // Android app, which Tangent keeps; Tangent's iOS bundle is not listed, so links stay in Safari.
    const host = new URL(DEFAULT_HOSTED_APP_URL).host;
    expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
    expect(config.android?.intentFilters?.[0]?.data).toEqual([
      { scheme: "https", host, pathPrefix: "/threads/" },
    ]);
    expect(assetLinks.map((link) => link.target.package_name)).toContain(androidIdentifier);
  },
);
