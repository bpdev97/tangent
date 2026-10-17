/**
 * Tangent(FORK-TERMCOLOR-001): ANSI palettes for terminals: the active built-in
 * theme's, then the host's hand-set one over it. See docs/fork/terminal-colors.md.
 */
import { BUILT_IN_THEME_IDS, MOBILE_DEFAULT_THEME_ID } from "./themePalettes.ts";
import { THEME_TERMINAL_PALETTES } from "./themeTerminalPalettes.ts";

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

const BUILT_IN_THEME_TERMINAL_PALETTES: ReadonlyMap<string, TerminalPalette> = new Map(
  BUILT_IN_THEME_IDS.flatMap((id) => {
    const palette = THEME_TERMINAL_PALETTES[id];
    return palette === undefined ? [] : [[id, palette] as const];
  }),
);

/**
 * The built-in theme's colors over a client's defaults. No id means the standard
 * T3 Code theme, which web marks by leaving `data-theme-id` unset. Web lets a
 * custom theme take the id `t3-code`, so that id, like every custom and imported
 * theme, keeps the defaults.
 */
export function themeTerminalPalette<Color>(
  defaults: ReadonlyArray<Color>,
  themeId: string | undefined,
  appearance: "light" | "dark",
  fromHex: (hex: string) => Color,
): ReadonlyArray<Color> {
  return mergeTerminalPalette(
    defaults,
    themeId === undefined
      ? THEME_TERMINAL_PALETTES[MOBILE_DEFAULT_THEME_ID]
      : BUILT_IN_THEME_TERMINAL_PALETTES.get(themeId),
    appearance,
    fromHex,
  );
}
