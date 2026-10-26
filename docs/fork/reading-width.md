# FORK-READWIDTH-001: Reading width on wide iPhones

## Why

Upstream limits a thread's width to 640pt on Android so lines stay readable on wide foldables. On iOS
it sets no limit in the compact layout and allows 960pt in split view. On the iPhone Duo's inner
display that means lines of about 150 characters, roughly twice the comfortable 45–75. Web already
defaults to a narrower lane (`46rem`).

## Behavior

- On iOS, the thread's messages, composer, and markdown images share a lane no wider than upstream's
  `ANDROID_READING_MAX_WIDTH` (640pt), centered in the pane. This applies in both the compact and
  split layouts.
- Phones narrower than the lane are unchanged. Android gets the same value upstream already gives
  it, so nothing changes there.
- The lane has a fixed width. It does not scale with text size.
- On iOS the lane is a native max width on the list's content container, not padding derived from
  the measured width. UIKit resizes a column or fold before JS hears the new width, so derived
  padding re-wrapped every row twice. LegendList's end anchor adjusts by relative amounts, and the
  two passes reach native as one commit, so a thread at its end landed past the end of its content
  and showed blank. Upstream's panes never reach its 960pt limit on the Duo, so it does not hit this.
- The feed keeps 16pt side padding on a Duo in both poses. Upstream uses 16 compact and 20 split, so
  a fold re-wrapped every row a second time over those 8pt, and the thread overshot its end.
- A thread that follows its end scrolls to the end 200ms after a resize settles, not after the 600ms
  row hold. A fold also shifts UIKit's inset by a few points the list cannot see, and this correction
  lands inside the fold transition.

## Upstream hooks

Each hook is marked `Tangent(FORK-READWIDTH-001)`.

- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`: upstream's expression is renamed to
  `upstreamContentMaxWidth`, unchanged, and `contentMaxWidth` is that value passed through
  `capThreadReadingWidth`. Also the import.
- `apps/mobile/src/features/threads/ThreadFeed.tsx`: `threadLaneContainerStyle` is spread last into
  the list's `contentContainerStyle`, upstream's padding is renamed `upstreamHorizontalPadding` and
  wrapped for the Duo, `beginReflow` settles an iOS `"end"` anchor sooner, and `settleReflow` scrolls
  to the end for it. Also the import.

Fork-owned: `apps/mobile/src/features/threads/tangent-reading-width.ts`.

## Resolving conflicts

Take upstream's version of the `contentMaxWidth` expression, rename it to
`upstreamContentMaxWidth`, and wrap it again. If upstream renames or removes
`ANDROID_READING_MAX_WIDTH` but keeps an equivalent reading width, point the fork file at it. If
upstream already gives iOS a reading width of about 720pt or less, drop the feature.

## Never

- Never edit upstream's expression itself; wrap its result so the hook stays one line.
- Never limit the width only on detected Duo hardware. A wide iPad split pane has the same problem.
- Never derive the iOS lane from the measured width. Rows must re-wrap once, in the native resize.

## Remove when

Upstream limits iOS threads to a reading width (for example by applying its Android value on every
platform), or adds a chat width setting on mobile. Removal: delete the fork file, the import, and
the wrapper line, and the `ThreadFeed.tsx` hooks, and rename `upstreamContentMaxWidth` and
`upstreamHorizontalPadding` back.

## Verify

No focused tests: the feature is a `Math.min` and a style, and the scroll bug needs UIKit's resize.
One pass on an iPhone Duo or a wide iPad simulator: an assistant reply's lines wrap at a comfortable
length inside a centered lane, the composer is the same width as the messages, and a regular iPhone
looks unchanged. At the end of a long thread, on an open Duo in landscape, hide and show the sidebar,
open and close the right panel with the sidebar hidden, and fold and unfold: the last message stays
above the composer every time.
