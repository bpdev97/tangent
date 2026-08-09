# FORK-LINEAR-001: Linear PR destinations

This feature extends the GitHub pull request number in the default web/desktop sidebar. A configured
environment can resolve Linear issues attached to the PR and, for explicitly approved repositories,
open the same PR in Linear Review. It does not change the legacy sidebar or mobile clients and does
not create T3 threads from Linear tickets.

## Boundary and data flow

Linear configuration is server-authoritative. The API key is persisted through `ServerSecretStore`;
clients receive only the redaction marker, click behavior, and Review repository allowlist. The
resolver accepts a GitHub PR URL over authenticated WebSocket RPC, canonicalizes it, and queries
Linear's public `attachmentsForURL` GraphQL field. The response contains only ticket identifiers,
titles, URLs, and an eligible Review URL.

The UI performs no lookup during render, hover, VCS polling, or sidebar status refresh. Opening the
destination menu or directly choosing Linear Review starts the lookup. The default GitHub behavior
does not contact Linear.

Linear's public API does not expose a stable Review-availability query. Review eligibility therefore
uses a user-maintained, normalized `owner/repository` allowlist. The resulting URL replaces the
`github.com` host with `linear.review`, matching Linear's documented deep-link format. Do not infer
eligibility from attachment metadata: an attached issue proves only the ticket relationship, not
that the user, workspace, and repository can open Linear Review.

## Cache behavior

Resolution is environment-local and memory-only:

- a result containing a ticket or Review destination lives for one hour;
- a successful result with no Linear destination lives for five minutes;
- transient failures use exponential backoff from 20 seconds to 15 minutes;
- concurrent requests for the same configuration and canonical PR URL share one lookup;
- a transient failure returns the last successful result as stale while retaining the shorter
  failure retry lifetime;
- Refresh invalidates the entry before resolving;
- an API key or Review allowlist change produces a new non-secret cache key.

Only a one-way fingerprint derived from the API key enters the cache key; the raw key is never
stored there. Cache state does not cross server restarts.

## Presentation

With no Linear key, the badge remains a direct GitHub link. With Linear configured, the saved
behavior is GitHub, Linear Review, or Choose each time. Direct modes retain a small destination menu
for linked tickets and manual fallback. Linear Review opens directly only after positive allowlist
eligibility; otherwise the menu explains the missing or failed resolution and keeps GitHub
available.

Desktop Linear destinations open through the existing thread-scoped right-panel browser surface,
but use a Linear-specific presentation instead of the generic address bar and preview controls. The
toolbar keeps Review and resolved ticket destinations available while the embedded Linear page is
open; multiple tickets collapse into a destination menu. Human-control status stays hidden on this
dedicated surface, while active agent control remains visible.

The server-scoped `ticketOpenBehavior` setting lets ticket destinations use that side panel or a
`linear://linear.app/...` desktop-app deep link. The shared opener owns this decision so PR menus and
the Linear toolbar cannot drift. Review remains in the side panel. Electron accepts only Linear
deep links whose host is exactly `linear.app`; other custom-protocol URLs stay blocked.

The preview session's normal Chromium HTTP cache remains enabled. In Tangent mode, Review and every
resolved ticket receive distinct right-panel browser tabs. Destination metadata lets subsequent
clicks reactivate the existing live tab instead of navigating the current webview or creating
duplicates. The tabs share the environment-scoped persistent browser partition for cookies and
cache while retaining independent page state.

Electron preview webviews use a persistent partition derived from the environment id, not the
thread id. Linear authentication cookies therefore carry across threads and desktop restarts for
that environment. The page/tab remains thread-scoped; only browser session storage is shared.
The browser-shaped user agent is applied on the webview itself so Electron and distribution product
tokens cannot reappear after the session is created.

Hosted web clients, where the right-panel browser is unavailable, open a new external browser tab.
GitHub uses the existing external-link behavior on every surface.

## Verification

```sh
vp test packages/shared/src/linear.test.ts \
  packages/contracts/src/settings.test.ts \
  apps/server/src/linear/LinearIntegration.test.ts \
  apps/server/src/serverSettings.test.ts \
  apps/desktop/src/electron/ElectronShell.test.ts \
  apps/desktop/src/preview/BrowserSession.test.ts \
  apps/web/src/browser/openFileInPreview.test.ts \
  apps/web/src/components/linear/linearPreviewPresentation.test.ts \
  apps/web/src/components/linear/LinearPreviewToolbar.test.tsx \
  apps/web/src/components/linear/openLinearPreviewDestination.test.ts \
  apps/web/src/components/linear/openLinearTicket.test.ts \
  apps/web/src/rightPanelStore.test.ts \
  apps/web/src/components/preview/PreviewView.test.tsx
vp check
vp run typecheck
```
