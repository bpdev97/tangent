// @effect-diagnostics nodeBuiltinImport:off - Reads the repository's own .env.example.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { resolvePersonalConnectEnv } from "./personal-connect-env.ts";

describe("personal T3 Connect build values", () => {
  it("come from upstream's .env.example, without the sign-in template", () => {
    const lines = resolvePersonalConnectEnv(
      NodeFS.readFileSync(
        NodeURL.fileURLToPath(new URL("../.env.example", import.meta.url)),
        "utf8",
      ),
    );

    expect(lines.map((line) => line.split("=")[0])).toEqual([
      "T3CODE_RELAY_URL",
      "T3CODE_CLERK_PUBLISHABLE_KEY",
      "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
    ]);
    expect(lines[0]).toMatch(/^T3CODE_RELAY_URL=https:\/\//);
  });

  it("fails the release when upstream stops setting a value", () => {
    expect(() =>
      resolvePersonalConnectEnv(
        "T3CODE_RELAY_URL=https://relay.example.test\n# T3CODE_CLERK_PUBLISHABLE_KEY=pk\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=\n",
      ),
    ).toThrow("T3CODE_CLERK_PUBLISHABLE_KEY");
  });
});
