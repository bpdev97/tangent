# FORK-PALETTE-001: Control-N and Control-P in the command palette

## Why

On macOS, Control-N and Control-P move down and up in lists and text across the system and in
Emacs-style editing. Upstream's command palette ignores them, so a common habit does nothing.
Tangent maps them to the palette's existing next and previous navigation.

## Behavior

- While the palette is open, unmodified Control-N moves to the next item and Control-P to the
  previous one, using the palette's existing navigation, including wraparound, the highlighted item,
  and scrolling.
- The keys do nothing extra when the palette is closed. No global key handler is installed.

## Upstream hooks

Planned: `apps/web/src/components/CommandPalette.tsx` and
`apps/web/src/components/CommandPalette.logic.ts`, mapping the two keys onto existing navigation,
with a test in `CommandPalette.logic.test.ts`.

## Resolving conflicts

Take upstream's palette and re-add the key mapping on top of whatever navigation upstream uses. If
upstream now handles these keys, drop the fork change.

## Never

- Never install a global handler outside the open palette.
- Never add a second navigation model; reuse the palette's own.

## Remove when

Upstream's palette responds to Control-N and Control-P.

## Verify

```sh
vp test apps/web/src/components/CommandPalette.logic.test.ts
```

Plus a quick keyboard check in the web app.
