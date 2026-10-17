# FORK-TERMCTL-001: Quiet terminal controls

## Why

Upstream draws the terminal's split, new, and close buttons over the top-right corner of a
thread's only terminal all the time, on top of whatever the shell prints there. Tangent's owner
drives terminals with keyboard shortcuts and never clicks those buttons, so they only hide the end
of a long prompt line.

## Behavior

- On web and desktop, the floating button group in the terminal's top-right corner is invisible
  until the pointer is over it or one of its buttons has keyboard focus (`:focus-visible`), then
  fades in. Focus left on a button by a click does not hold it. Cancelling the close
  confirmation returns focus to the close button as `:focus-visible`, so the group stays until
  focus moves on, usually the next click into the terminal. It still takes clicks while
  invisible, exactly where it sits today.
- While one of its tooltips is open the group stays visible, so a tooltip never floats beside an
  invisible button; the tooltip's hover bridge outlasts the group's own hover.
- When the primary pointer is coarse (a phone or touch-first tablet), the group stays visible as
  upstream draws it.
- With more than one terminal, splits included, upstream moves the buttons into the terminal
  list's header, where they cover no output; that header is unchanged.
- Shortcuts, the command palette, and the mobile app's terminal are unchanged.

## Upstream hooks

- `apps/web/src/components/ThreadTerminalDrawer.tsx`: the classes on the floating button group
  (`opacity-0`, `transition-opacity`, and `opacity-100` under `hover:`, `has-[:focus-visible]:`,
  `has-[[data-popup-open]]:`, and `pointer-coarse:`), marked `Tangent(FORK-TERMCTL-001)`.

No fork-owned files: the whole feature is that one class list.

## Resolving conflicts

Take upstream's drawer and re-add the opacity classes to whichever element now wraps the floating
split, new, and close buttons. If upstream moves those buttons out of the terminal surface, so they
no longer cover output, drop the feature.

## Never

- Never hide the group with `display` or `pointer-events`; the buttons must stay reachable by
  hovering, tabbing, and on touch screens.
- Never reveal it on plain `focus-within`: every clicked button would keep the group visible after
  the pointer leaves.
- Never animate it beyond the one opacity fade on hover.

## Remove when

Upstream stops drawing the buttons over terminal output, or gives a setting to hide them.

## Verify

No focused tests: the behavior is CSS. One pass in a web or desktop client with a single terminal:
the corner shows only terminal output, hovering it reveals the four buttons and their tooltips,
moving away hides the group and its tooltip together, and Tab reaches the buttons and shows them.
