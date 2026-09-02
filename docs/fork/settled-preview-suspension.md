# FORK-PREVIEW-001: settled preview suspension

Tangent keeps browser-preview tabs and their navigation metadata attached to a thread after the
thread is settled, but it does not keep an inactive settled thread's Electron webviews alive. This
provides a bounded lifecycle signal without making right-panel tabs disappear or coupling browser
resource management to Linear-specific UI.

## Lifecycle

The renderer-wide Electron browser host observes the resolved thread route and the server-backed
thread shell. A server-settled thread remains mounted while it is the active route. Once
navigation leaves that thread, the host unmounts its webviews and releases their desktop tab leases.

Suspension does not close the server preview session, remove a right-panel surface, or discard the
latest preview snapshot. Returning to the thread or un-settling it mounts the webviews
again from the retained URLs. Chromium cookies and HTTP cache remain in the environment-scoped
persistent partition, so authentication survives even though transient in-page state reloads.

The rule is fail-open: missing thread-shell state keeps the webview mounted. Only the server-backed
`settledOverride: "settled"` lifecycle state suspends an inactive thread. Both manual and automatic
settling use that signal; client-derived guesses never destroy a webview.

## Ownership and invariants

The suspension decision and its tests are fork-owned under `apps/web/src/browser/`. Shared upstream
touchpoints are `AppRoot.tsx` and `ElectronBrowserHost.tsx`.

- Apply the lifecycle uniformly to all desktop browser previews, not only Linear destinations.
- Keep the active route mounted even during the settle/navigation transition.
- Preserve preview sessions, right-panel surfaces, latest URLs, and persistent browser storage.
- Releasing a webview may stop recording and close its desktop lease; it must not send the server
  preview-close command.
- Unknown lifecycle state stays mounted. Resource cleanup must never guess that a thread settled.
- Hosted web and mobile do not own Electron webviews and are unaffected.

## Verification

```sh
vp test apps/web/src/browser/browserSessionSuspension.test.ts \
  apps/web/src/browser/desktopTabLifetime.test.ts \
  apps/web/src/AppRoot.test.tsx
vp check
vp run typecheck
```
