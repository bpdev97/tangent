import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ServerSettings } from "./settings.ts";

const decode = Schema.decodeUnknownSync(ServerSettings);
const encode = Schema.encodeSync(ServerSettings);

describe("ServerSettings.terminalPalette", () => {
  it("is absent by default", () => {
    expect(decode({}).terminalPalette).toBeUndefined();
  });

  it("keeps entries as typed, valid or not, so a rewrite preserves them", () => {
    const terminalPalette = { dark: ["#494d64", "not a color"], light: [] };
    const settings = decode({ terminalPalette });
    expect(settings.terminalPalette).toEqual(terminalPalette);
    expect(encode(settings).terminalPalette).toEqual(terminalPalette);
  });

  it("drops a palette of the wrong shape without resetting other settings", () => {
    for (const terminalPalette of ["#494d64", { dark: "#494d64" }, { dark: [1, 2] }, null]) {
      const settings = decode({ terminalPalette, branchNamePrefix: "bp" });
      expect(settings.terminalPalette).toBeUndefined();
      expect("terminalPalette" in settings).toBe(false);
      expect(settings.branchNamePrefix).toBe("bp");
    }
  });
});
