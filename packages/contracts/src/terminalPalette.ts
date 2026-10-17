/**
 * Tangent(FORK-TERMCOLOR-001): the 16 ANSI colors terminals use, set by hand in
 * the host's settings.json. See docs/fork/terminal-colors.md.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Entries stay plain strings so a typo in one color only costs that color:
 * clients check each entry, and the server never rewrites what the user typed.
 */
const TerminalPaletteColors = Schema.Array(Schema.String);

/**
 * A value of the wrong shape is dropped instead of failing: a settings.json that
 * fails to decode resets every server setting to its default.
 */
export const TerminalPaletteSettings = Schema.Struct({
  light: Schema.optionalKey(TerminalPaletteColors),
  dark: Schema.optionalKey(TerminalPaletteColors),
}).pipe(Schema.catchDecoding(() => Effect.succeedNone));
export type TerminalPaletteSettings = typeof TerminalPaletteSettings.Type;
