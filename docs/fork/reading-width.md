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

## Upstream hooks

Each hook is marked `Tangent(FORK-READWIDTH-001)`.

- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`: upstream's expression is renamed to
  `upstreamContentMaxWidth`, unchanged, and `contentMaxWidth` is that value passed through
  `capThreadReadingWidth`. Also the import.

Fork-owned: `apps/mobile/src/features/threads/tangent-reading-width.ts`.

## Resolving conflicts

Take upstream's version of the `contentMaxWidth` expression, rename it to
`upstreamContentMaxWidth`, and wrap it again. If upstream renames or removes
`ANDROID_READING_MAX_WIDTH` but keeps an equivalent reading width, point the fork file at it. If
upstream already gives iOS a reading width of about 720pt or less, drop the feature.

## Never

- Never edit upstream's expression itself; wrap its result so the hook stays one line.
- Never limit the width only on detected Duo hardware. A wide iPad split pane has the same problem.

## Remove when

Upstream limits iOS threads to a reading width (for example by applying its Android value on every
platform), or adds a chat width setting on mobile. Removal: delete the fork file, the import, and
the wrapper line, and rename `upstreamContentMaxWidth` back to `contentMaxWidth`.

## Verify

No focused tests: the feature is a `Math.min`. One pass on an iPhone Duo or a wide iPad simulator:
an assistant reply's lines wrap at a comfortable length inside a centered lane, the composer is the
same width as the messages, and a regular iPhone looks unchanged.
