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

Desktop Linear destinations open through the existing thread-scoped right-panel browser surface.
Hosted web clients, where that surface is unavailable, open a new external browser tab. GitHub uses
the existing external-link behavior on every surface.

## Verification

```sh
vp test packages/shared/src/linear.test.ts \
  packages/contracts/src/settings.test.ts \
  apps/server/src/linear/LinearIntegration.test.ts \
  apps/server/src/serverSettings.test.ts
vp check
vp run typecheck
```
