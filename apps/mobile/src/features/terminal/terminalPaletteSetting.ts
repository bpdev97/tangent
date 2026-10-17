/**
 * Tangent(FORK-TERMCOLOR-001): the host's hand-set ANSI palette over the mobile
 * terminal theme. See docs/fork/terminal-colors.md.
 */
import { mergeTerminalPalette, type TerminalPalette } from "@t3tools/shared/terminalPalette";

import type { TerminalAppearanceScheme, TerminalTheme } from "./terminalTheme";

export function withTerminalPalette(
  theme: TerminalTheme,
  palette: TerminalPalette | undefined,
  scheme: TerminalAppearanceScheme,
): TerminalTheme {
  if (palette === undefined) return theme;
  return {
    ...theme,
    palette: mergeTerminalPalette(
      theme.palette,
      palette,
      scheme,
      (hex) => hex,
    ) as TerminalTheme["palette"],
  };
}
