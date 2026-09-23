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

- Without a T3 Connect account, the phone registers through every directly paired server (bearer
  connections, not managed or DPoP). Upstream's foreground behavior is kept: ordinary alerts stay
  quiet while the app is open.
- Clients see only whether a password is saved (a redaction marker in place of the value). Settings
  offer a way to remove the relay again.

Deployment steps (container setup, secret files, image tags, and relay password rotation) live in
[`apps/push-relay/README.md`](../../apps/push-relay/README.md).

## Upstream hooks

Each is marked `Tangent(FORK-PUSH-001)` where not self-evident:

- Server:
  - `relay/AgentAwarenessRelay.ts`: one call to the personal sink at the top of
    `publishThreadUnsafe`, before the managed relay's enabled check.
  - `server.ts`: the personal push routes in `makeRoutesLayer`, the sink provided to
    `AgentAwarenessRelay.layer`, and settings provided to `ServerEnvironment`.
  - `environment/ServerEnvironment.ts`: `agentActivityPublishing` is also true when a personal
    relay is configured, so the phone arms Live Activities.
  - `serverSettings.ts`: redact, persist, and materialize calls for the relay password.
  - `ws.ts` and `auth/RpcAuthorization.ts`: the `server.testPersonalPushRelay` handler and scope.
  - `http.ts`: `authenticateRawRouteWithScope` is exported.
  - `cli/config.ts` and `config.ts`: `T3CODE_PERSONAL_PUSH_RELAY_URL` and `_TOKEN`.
- Contracts: `settings.ts` (the `personalPushRelay` setting and patch field), `rpc.ts` (the test
  RPC), `package.json` (the `./personalPush` export). `client-runtime/src/state/server.ts`: the
  test command.
- Web: `SettingsPanels.tsx` renders the relay section; `settingsSearch.ts` has its search entry.
- Mobile: `features/agent-awareness/remoteRegistration.ts` (personal backend in device and Live
  Activity registration, snapshot reads, the no-account path, and `syncAgentAwarenessConnections`),
  `App.tsx` (the connection bridge), `widgets/AgentActivity.tsx` (the `bpdev-code://` deep link,
  plus its test), `features/settings/SettingsNotificationsRouteScreen.tsx` and
  `SettingsRouteScreen.tsx` (device notifications without T3 Connect).
- `pnpm-lock.yaml`: the `apps/push-relay` importer.
- `docs/user/mobile-notifications.md`: one paragraph on the personal relay.

Fork-owned: `apps/push-relay/`, `apps/server/src/personalPush/`,
`packages/contracts/src/personalPush.ts`,
`apps/web/src/components/settings/PersonalPushRelaySettings.tsx`,
`apps/mobile/src/features/agent-awareness/personalPush.ts`,
`apps/mobile/src/features/agent-awareness/AgentAwarenessConnectionBridge.tsx`,
`apps/mobile/src/features/settings/PersonalNotificationsSettings.tsx`, `.dockerignore`,
`.github/workflows/personal-push-relay-image.yml`.

## Resolving conflicts

- `AgentAwarenessRelay.ts`: take upstream's version and re-add the single personal-sink call. Do
  not restructure upstream's managed-relay logic around it. The sink keeps its own dedupe and
  confirmation delay; mirror upstream if its publish rules change.
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

```sh
vp test run apps/server/src/personalPush apps/server/src/relay \
  apps/mobile/src/features/agent-awareness apps/mobile/src/widgets/AgentActivity.test.ts
```

Then a device check that a completion and an approval request arrive, and that tapping the Live
Activity opens the thread. The widget bundle ships with the native build, so the deep-link change
needs one.
