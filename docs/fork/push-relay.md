# FORK-PUSH-001: personal push relay

## Why

Upstream delivers iOS notifications and Live Activities through T3 Connect's managed relay, which
needs a Clerk account. The personal build ships without Clerk or the managed relay, so without this
feature Tangent on iOS gets no notifications. A small self-hosted container on the tailnet holds the
APNs key and delivers notifications for every Tangent server the user runs.

## Behavior

Trust boundary:

- Phones never receive the relay password or the APNs key. No APNs key is installed on a Tangent
  server.
- Tangent servers reach the relay only through typed routes: device registration, Live Activity
  registration, snapshot reads, and agent-activity publication. The relay cannot forward arbitrary
  APNs payloads.
- The relay URL is a server setting. Its password lives in `ServerSecretStore`, is redacted from
  settings snapshots and logs, and is never sent to clients. `T3CODE_PERSONAL_PUSH_RELAY_URL` and
  `T3CODE_PERSONAL_PUSH_RELAY_TOKEN` remain for headless setup; saved settings take precedence.
- `GET /healthz` is the only unauthenticated route. The protocol is versioned under `/v1`.

Delivery:

- Tangent publishes to the personal relay as a second sink, independent of upstream's managed relay.
- The relay stores each publication and its pending deliveries in SQLite before acknowledging.
  Transient APNs failures retry with backoff from 30 seconds to 5 minutes, at most six attempts,
  including across restarts.
- Notification and Live Activity deliveries are tracked separately and each advances only after
  APNs accepts that channel. Invalid tokens are cleared so the app can re-register.
- Activity rows expire from SQLite by phase: running after 2 hours, waiting on the user after 24
  hours, finished after 15 minutes.
- One aggregate is computed per ordered publication. Fan-out uses at most four concurrent device
  deliveries, and the ordered queue is capped at 256, returning HTTP 429 beyond that.
- APNs provider tokens and HTTP/2 sessions are reused per environment and closed on shutdown.
- Mobile keeps the last usable endpoint while a connection is being replaced, so reconnects never
  cause duplicate APNs registrations.

Deployment steps (container setup, secret files, image tags, and relay password rotation) move to
`apps/push-relay/README.md` when the feature is ported.

## Upstream hooks

Planned:

- `apps/server/src/relay/AgentAwarenessRelay.ts`: one call that publishes to the personal sink,
  placed before the managed relay's enabled check.
- Server HTTP route registration for the personal push routes.
- Settings contract fields for the relay URL and redacted token state.
- Mobile remote registration and the Live Activity widget.

Fork-owned: `apps/push-relay/`, `apps/server/src/personalPush/`,
`.github/workflows/personal-push-relay-image.yml`.

## Resolving conflicts

- `AgentAwarenessRelay.ts`: take upstream's version and re-add the single personal-sink call. Do
  not restructure upstream's managed-relay logic around it.
- If upstream changes the agent-awareness state shape, update the personal publisher's mapping to
  the relay contract; the relay's `/v1` protocol stays stable.
- If upstream changes mobile registration, re-apply the personal endpoint alongside it.

## Never

- Never send the relay password or APNs key to a phone, or write the password to `settings.json`.
- Never let the relay forward arbitrary APNs payloads.
- Never replace upstream's awareness behavior; the personal relay is an additional sink.
- Never let the publication queue grow without a bound.

## Remove when

Upstream offers notifications and Live Activities for self-hosted installs without Clerk or the
managed relay, with equal delivery guarantees.

## Verify

```sh
vp test apps/push-relay/src
vp run --filter @bpdev/push-relay build
```

Plus the server personal-push tests and the mobile registration tests, then a device check that a
completion and an approval request arrive.
