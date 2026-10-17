# FORK-TERMCOLOR-001: terminal colors from settings.json

## Why

Upstream's terminals use one fixed set of 16 ANSI colors on every app theme: VS Code's default
terminal colors on web and desktop, the Pierre palette on mobile. Programs that draw with the
palette, such as a prompt framed in color 0, then clash with the theme or vanish into the
background, and the terminal never looks like the one the user works in every day. Tangent lets the
host set those 16 colors once, by hand, so a theme ported from Ghostty or anywhere else shows on
every client.

## Behavior

- The host's server `settings.json` takes an optional `terminalPalette` with `light` and `dark`
  lists of up to 16 `#rrggbb` colors, indexed like ANSI colors 0–15. Each client uses the list for
  its current appearance.
- Each valid entry replaces the client's default color at that index. A missing, extra, or
  malformed entry keeps the default for that index; a value of the wrong shape (not lists of
  strings) is dropped as if absent, and never resets other settings.
- Entries are stored as typed, so the server never rewrites away a typo; clients check each entry.
  Only `#rrggbb` passes, so nothing else reaches mobile's GhosttyKit configuration.
- The server already watches `settings.json` and streams setting changes, so web, desktop, and
  mobile terminals recolor live. Background, foreground, cursor, and selection still come from the
  app theme.
- There is no settings UI and no patch field: the palette is set by editing the file.
- Thread terminals only. The provider sign-in terminal and the Settings font previews keep the
  defaults: the sign-in terminal is brief and does not follow theme changes either, and the
  previews are client-wide while the palette belongs to a host. Wiring them would add two upstream
  files for little gain.

## Upstream hooks

Fork logic lives in `packages/contracts/src/terminalPalette.ts` (the lenient schema),
`packages/shared/src/terminalPalette.ts` (the merge), and
`apps/mobile/src/features/terminal/terminalPaletteSetting.ts`. Each upstream hook is marked
`Tangent(FORK-TERMCOLOR-001)`:

- `packages/contracts/src/settings.ts`: `terminalPalette` in `ServerSettings`.
- `packages/shared/package.json`: the `./terminalPalette` export (JSON has no comment to mark).
- `apps/web/src/components/ThreadTerminalDrawer.tsx`: `terminalThemeFromApp` takes the palette and
  merges it over `TERMINAL_PALETTES`; `TerminalViewport` passes its environment's palette to every
  theme read and repaints when the palette's content changes.
- `apps/mobile/src/features/terminal/ThreadTerminalRouteScreen.tsx`: the terminal theme passes
  through `withTerminalPalette` with the route environment's palette.
- `docs/README.md`: the user guide link.

## Resolving conflicts

Take upstream's terminal theming and re-apply the merge wherever the palette is now chosen: web's
`terminalThemeFromApp` and mobile's terminal theme. If upstream renames `TERMINAL_PALETTES` or moves
theme reading into the surface, follow it; the hook stays one merge call per client. In
`settings.ts`, keep the field beside the other fork fields.

## Never

- Never make the field strict. A settings.json that fails to decode resets every server setting.
- Never pass an unchecked entry to a terminal; mobile writes them into GhosttyKit config lines.
- Never read the palette from a client-local setting; it belongs to the host, so every client
  agrees.

## Remove when

Upstream lets themes or settings set the terminal's ANSI palette on web, desktop, and mobile.
Port users' `terminalPalette` values to upstream's format in the same change.

## Verify

```sh
vp test run packages/shared/src/terminalPalette.test.ts packages/contracts/src/terminalPalette.test.ts
```

Plus a terminal on web or desktop and on iOS: `print -P '%F{0}black%f %F{1}red%f %F{4}blue%f'`
shows the configured colors, and editing `settings.json` recolors open terminals.
