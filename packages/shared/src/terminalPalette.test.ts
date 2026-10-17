import { describe, expect, it } from "vite-plus/test";

import { mergeTerminalPalette, themeTerminalPalette } from "./terminalPalette.ts";
import { MOBILE_DEFAULT_THEME_ID, MOBILE_THEME_IDS } from "./themePalettes.ts";
import { THEME_TERMINAL_PALETTES } from "./themeTerminalPalettes.ts";

const DEFAULTS = Array.from({ length: 16 }, (_, index) => `default-${index}`);
const identity = (hex: string) => hex;

describe("mergeTerminalPalette", () => {
  it("keeps the defaults without a palette for the appearance", () => {
    expect(mergeTerminalPalette(DEFAULTS, undefined, "dark", identity)).toEqual(DEFAULTS);
    expect(mergeTerminalPalette(DEFAULTS, { light: ["#ffffff"] }, "dark", identity)).toEqual(
      DEFAULTS,
    );
  });

  it("uses the palette for the current appearance only", () => {
    const palette = { light: ["#eeeeee"], dark: ["#494d64"] };
    expect(mergeTerminalPalette(DEFAULTS, palette, "dark", identity)[0]).toBe("#494d64");
    expect(mergeTerminalPalette(DEFAULTS, palette, "light", identity)[0]).toBe("#eeeeee");
  });

  it("replaces each valid entry and keeps the default for anything else", () => {
    const merged = mergeTerminalPalette(
      DEFAULTS,
      { dark: ["#494D64", "red", " #ed8796 ", "#abc", "", "#a6da95\npalette = 0=#000000"] },
      "dark",
      identity,
    );
    expect(merged.slice(0, 7)).toEqual([
      "#494d64",
      "default-1",
      "#ed8796",
      "default-3",
      "default-4",
      "default-5",
      "default-6",
    ]);
  });

  it("ignores entries past the defaults", () => {
    const palette = { dark: Array.from({ length: 20 }, () => "#123456") };
    const merged = mergeTerminalPalette(DEFAULTS, palette, "dark", identity);
    expect(merged).toHaveLength(16);
    expect(merged.every((color) => color === "#123456")).toBe(true);
  });

  it("converts with the caller's color type", () => {
    const merged = mergeTerminalPalette(
      [{ r: 0, g: 0, b: 0 }],
      { dark: ["#494d64"] },
      "dark",
      (hex) => {
        const value = Number.parseInt(hex.slice(1), 16);
        return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
      },
    );
    expect(merged).toEqual([{ r: 0x49, g: 0x4d, b: 0x64 }]);
  });
});

describe("themeTerminalPalette", () => {
  it("has 16 colors in each appearance for every built-in theme", () => {
    for (const themeId of MOBILE_THEME_IDS) {
      const lookupId = themeId === MOBILE_DEFAULT_THEME_ID ? undefined : themeId;
      for (const appearance of ["light", "dark"] as const) {
        const merged = themeTerminalPalette(DEFAULTS, lookupId, appearance, identity);
        expect(merged).toEqual(THEME_TERMINAL_PALETTES[themeId]?.[appearance]);
      }
    }
  });

  it("keeps the defaults for custom themes, including one named t3-code", () => {
    for (const themeId of ["my-theme", "t3-code", "constructor", "__proto__"]) {
      expect(themeTerminalPalette(DEFAULTS, themeId, "dark", identity)).toEqual(DEFAULTS);
    }
  });

  it("lets the host's palette override single theme colors", () => {
    const themed = themeTerminalPalette(DEFAULTS, "ocean", "dark", identity);
    const merged = mergeTerminalPalette(themed, { dark: ["#000000"] }, "dark", identity);
    expect(merged[0]).toBe("#000000");
    expect(merged.slice(1)).toEqual(themed.slice(1));
  });
});
