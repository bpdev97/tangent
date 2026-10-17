/**
 * Tangent(FORK-TERMCOLOR-001): the built-in theme's ANSI colors over the mobile
 * terminal palette. Kept apart from terminalPaletteSetting.ts, which imports
 * terminalTheme.ts, so terminalTheme.ts can use this without an import cycle.
 * See docs/fork/terminal-colors.md.
 */
import { themeTerminalPalette } from "@t3tools/shared/terminalPalette";
import { MOBILE_DEFAULT_THEME_ID } from "@t3tools/shared/themePalettes";

/** Mobile has no custom themes, so its `t3-code` is always the standard theme. */
export function withThemeTerminalPalette<Palette extends ReadonlyArray<string>>(
  palette: Palette,
  themeId: string,
  scheme: "light" | "dark",
): Palette {
  return themeTerminalPalette(
    palette,
    themeId === MOBILE_DEFAULT_THEME_ID ? undefined : themeId,
    scheme,
    (hex) => hex,
  ) as Palette;
}
