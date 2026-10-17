/**
 * Tangent(FORK-TERMCOLOR-001): the host's hand-set ANSI palette, applied over a
 * client's default terminal colors. See docs/fork/terminal-colors.md.
 */

export interface TerminalPalette {
  readonly light?: ReadonlyArray<string>;
  readonly dark?: ReadonlyArray<string>;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Each valid `#rrggbb` entry replaces the default color at its index. Anything
 * else keeps the default, so a typo costs only that color, and no other text
 * reaches a terminal's configuration (mobile writes these into config lines).
 */
export function mergeTerminalPalette<Color>(
  defaults: ReadonlyArray<Color>,
  palette: TerminalPalette | undefined,
  appearance: "light" | "dark",
  fromHex: (hex: string) => Color,
): ReadonlyArray<Color> {
  const configured = palette?.[appearance];
  return defaults.map((color, index) => {
    const entry = configured?.[index]?.trim();
    return entry !== undefined && HEX_COLOR.test(entry) ? fromHex(entry.toLowerCase()) : color;
  });
}
