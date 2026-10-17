# FORK-TERMCOLOR-001: terminal colors per theme and from settings.json

## Why

Upstream's terminals use one fixed set of 16 ANSI colors on every app theme: VS Code's default
terminal colors on web and desktop, the Pierre palette on mobile. Programs that draw with the
palette, such as a prompt framed in color 0, then clash with the theme or vanish into the
background, and the terminal never looks like the one the user works in every day. Tangent gives
each built-in theme 16 colors that match it, and lets the host set its own once, by hand, so a
theme ported from Ghostty or anywhere else shows on every client.

## Behavior

- Each built-in theme (T3 Code, T3 Chat, Grove, Ocean, Ember, Iris) has light and dark ANSI
  colors in `packages/shared/src/themeTerminalPalettes.ts`, made from the theme's terminal
  background and accent hues. They replace the client's defaults wherever a terminal takes the
  app theme: on web and desktop every terminal built by `terminalThemeFromApp`, including the
  sign-in terminal and Settings previews; on mobile every `getMobileTerminalTheme` caller,
  including review's diff red. Custom, imported, and published themes keep the defaults.
- Web learns the theme from `data-theme-id` on the document root, which the standard T3 Code
  theme leaves unset. Only built-in ids match, because web lets a custom theme take the id
  `t3-code`. Open terminals also watch that attribute, since two themes can share every color and
  differ only in id.
- The host's server `settings.json` takes an optional `terminalPalette` with `light` and `dark`
  lists of up to 16 `#rrggbb` colors, indexed like ANSI colors 0–15. Each client uses the list for
  its current appearance.
- Each valid entry replaces the theme's color at that index. A missing, extra, or
  malformed entry keeps the default for that index; a value of the wrong shape (not lists of
  strings) is dropped as if absent, and never resets other settings.
- Entries are stored as typed, so the server never rewrites away a typo; clients check each entry.
  Only `#rrggbb` passes, so nothing else reaches mobile's GhosttyKit configuration.
- The server already watches `settings.json` and streams setting changes, so web, desktop, and
  mobile terminals recolor live. Background, foreground, cursor, and selection still come from the
  app theme.
- There is no settings UI and no patch field: the palette is set by editing the file.
- The host palette reaches thread terminals only. The provider sign-in terminal and the Settings
  previews show the theme's colors: the sign-in terminal is brief and does not follow theme
  changes either, and the previews are client-wide while the palette belongs to a host. Wiring
  them would add two upstream files for little gain.

## Upstream hooks

Fork logic lives in `packages/contracts/src/terminalPalette.ts` (the lenient schema),
`packages/shared/src/terminalPalette.ts` (the merges), `packages/shared/src/themeTerminalPalettes.ts`
(the theme colors), and two mobile files: `terminalPaletteSetting.ts` (the host palette) and
`themeTerminalColors.ts` (the theme colors), both in `apps/mobile/src/features/terminal/`. The
second stays apart from the first so `terminalTheme.ts` can import it without an import cycle. Each
upstream hook is marked `Tangent(FORK-TERMCOLOR-001)`:

- `packages/contracts/src/settings.ts`: `terminalPalette` in `ServerSettings`.
- `packages/shared/package.json`: the `./terminalPalette` export (JSON has no comment to mark).
- `apps/web/src/components/ThreadTerminalDrawer.tsx`: `terminalThemeFromApp` merges the theme's
  colors, then the palette it takes, over `TERMINAL_PALETTES`, and the theme observer also watches
  `data-theme-id`; `TerminalSessionViewport` passes its environment's palette to every
  theme read and repaints when the palette's content changes.
- `apps/mobile/src/features/terminal/terminalTheme.ts`: `getMobileTerminalTheme` replaces the
  Pierre palette with the theme's colors.
- `apps/mobile/src/features/terminal/ThreadTerminalRouteScreen.tsx`: the terminal theme passes
  through `withTerminalPalette` with the route environment's palette.
- `docs/README.md`: the user guide link.

## Resolving conflicts

Take upstream's terminal theming and re-apply the merges wherever the palette is now chosen: web's
`terminalThemeFromApp` and mobile's `getMobileTerminalTheme` and thread terminal. If upstream
renames `TERMINAL_PALETTES` or moves theme reading into the surface, follow it; the hooks stay one
merge call each. In `settings.ts`, keep the field beside the other fork fields.

When upstream adds a built-in theme, the shared test fails until it has colors here; build them
the same way from its terminal background and accent hues, and check contrast against the
background. When upstream retunes a theme, retune its colors.

## Never

- Never make the field strict. A settings.json that fails to decode resets every server setting.
- Never pass an unchecked entry to a terminal; mobile writes them into GhosttyKit config lines.
- Never read the palette from a client-local setting; it belongs to the host, so every client
  agrees.

## Remove when

Upstream lets themes or settings set the terminal's ANSI palette on web, desktop, and mobile.
Port users' `terminalPalette` values to upstream's format in the same change, and drop the theme
colors if upstream's themes bring their own.

## Verify

```sh
vp test run packages/shared/src/terminalPalette.test.ts packages/contracts/src/terminalPalette.test.ts
```

Plus a terminal on web or desktop and on iOS: `print -P '%F{0}black%f %F{1}red%f %F{4}blue%f'`
shows the theme's colors, switching themes recolors it, and editing `settings.json` overrides
them in open terminals.
