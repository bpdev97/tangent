# FORK-STATUS-001: Quiet connection status

## Why

Tangent's owner keeps laptops paired that are often asleep or off. Upstream's thread-list header
replaces the brand with a spinner and "Reconnecting to …" whenever any enabled environment is not
connected, so one sleeping laptop keeps that text, and a continuously repainting spinner, in the
header indefinitely. For this owner an unreachable machine is a normal state, not news.

## Behavior

- Once threads have loaded, the header always shows the brand. A small static mark follows it
  after the same 800 ms delay upstream uses, so sub-second reconnects show nothing:
  - an amber dot while some enabled environments are connecting, reconnecting, or failing, and at
    least one is connected;
  - a crossed-out Wi-Fi symbol while no environment is connected or the phone is offline.
- Pressing the brand while a mark shows opens environment settings, as pressing upstream's status
  did. Without a mark the brand renders exactly as upstream renders it.
- The mark hangs outside the brand's box, so a centered native title does not move.
- Before threads have loaded once, upstream's title ("Loading threads…", "You are offline") still
  shows, because the list has nothing else to say.
- Per-environment detail is unchanged: a thread's own reconnect notice and the environment
  settings rows still name the machine and its error. Switched-off environments count as upstream
  counts them, which is not at all.
- The pill above a thread's composer waits 2 s before reporting a connect or reconnect, which
  phones do often and usually finish within a second. Until then it keeps showing work or sync
  state. Offline and error show immediately.

## Upstream hooks

Each hook is marked `Tangent(FORK-STATUS-001)`.

- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx`: `WorkspaceConnectionTitle` reads
  `useQuietConnectionIndicator`, renders `QuietConnectionTitle` for a mark, and renders the plain
  brand when the indicator is `none`. Every thread-list header (iOS header, split-view sidebar,
  Android toolbar) goes through this component.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`: the floating pill reads
  `useConnectionPillPhase(props.connectionStateLabel)` instead of the raw phase.

Fork-owned: `apps/mobile/src/features/home/quiet-connection-indicator.ts`,
`apps/mobile/src/features/home/QuietConnectionTitle.tsx`,
`apps/mobile/src/features/threads/connection-pill-grace.ts`, and their tests.

## Resolving conflicts

- Take upstream's `WorkspaceConnectionTitle.tsx` and re-add the hook call and the two branches
  before its status rendering.
- Take upstream's `ThreadDetailScreen.tsx` and pass `useConnectionPillPhase(...)` wherever the
  floating status reads the connection phase.
- If upstream changes `WorkspaceState`, update `quietConnectionIndicator` and its test to the new
  fields.

## Never

- Never replace the brand with status text after threads have loaded.
- Never animate the mark; it must stay static.

## Remove when

Upstream stops treating one unreachable environment as a workspace-wide status, or the owner no
longer keeps machines paired that are usually offline.

## Verify

```sh
vp test run apps/mobile/src/features/home/quiet-connection-indicator.test.ts apps/mobile/src/features/home/workspace-connection-status.test.ts apps/mobile/src/features/threads/connection-pill-grace.test.ts
```

Plus one pass in the iOS simulator: with one environment connected and another unreachable, the
header shows the brand and a dot, and pressing it opens environment settings.
