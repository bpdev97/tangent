# FORK-PUSH-001: personal APNs relay

This fork can deliver iOS notifications and AgentActivity Live Activity updates without Clerk or
the managed T3 relay. A small container on the tailnet owns the APNs provider key. Mobile devices
register through their already-authenticated T3 server connection, and each T3 server publishes
sanitized agent-awareness state to the container.

## Trust boundary

- The phone never receives the relay password or APNs provider key.
- The T3 server can call only the typed personal-push adapter routes exposed to authenticated mobile
  sessions.
- The container accepts only device registration, Live Activity registration, snapshot reads, and
  agent-activity publication. It cannot forward arbitrary APNs payloads.
- APNs tokens and channel-specific notification and Live Activity delivery watermarks are stored in
  SQLite. Logs include only token suffixes.
- Bind the published port to the host's Tailscale address and restrict it with Tailscale grants to
  the machines that run T3 servers.

## Container setup

From `apps/push-relay`, copy `.env.example` to `.env`. Create the secret files without committing
them:

```sh
mkdir -p secrets
openssl rand -base64 32 > secrets/relay-password
chmod 600 secrets/relay-password secrets/AuthKey_KEYID.p8
docker compose --env-file .env -f compose.example.yml up -d --pull always
```

The compose file pulls `ghcr.io/bpdev97/bpdev-code-push-relay:latest`. The image is published for
Linux AMD64 and ARM64 whenever relay code reaches `main`. Every build also has an immutable
`sha-<git-commit>` tag; set `RELAY_IMAGE` in `.env` to one of those tags or a digest when you want a
pinned deployment.

The first package publication may be private. In that case, either make the package public once in
GitHub's package settings or log the homelab host in with a classic personal access token that has
`read:packages`:

```sh
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username bpdev97 --password-stdin
```

Public GHCR packages can be pulled without logging in. Publishing uses the repository's short-lived
`GITHUB_TOKEN`; no registry credential needs to be added to Actions secrets.

To build locally instead, run this from the repository root and point the compose file at the local
tag:

```sh
docker build -f apps/push-relay/Dockerfile -t bpdev-code-push-relay:local .
RELAY_IMAGE=bpdev-code-push-relay:local \
  docker compose --env-file apps/push-relay/.env -f apps/push-relay/compose.example.yml up -d
```

The Apple Team ID, Key ID, bundle ID, and APNs environment are identifiers, not secrets. The `.p8`
file and relay password are secrets. Use an Apple key restricted to APNs when possible.
Production/TestFlight builds use `APNS_ENVIRONMENT=production`; development-signed builds use
`sandbox` and should use a separate relay instance and database. Device registrations whose bundle
ID or APNs environment differs from the container configuration are rejected.

On each machine running T3, open **Settings → General → Notifications** and enter the relay URL and
the contents of `secrets/relay-password`. Save, then use **Test connection**. The password is stored
in that T3 server's permission-restricted secret store; it is not written to `settings.json` or sent
back to clients.

Environment variables remain available for headless deployments. Saved settings take precedence:

```sh
export T3CODE_PERSONAL_PUSH_RELAY_URL=http://100.x.y.z:8788
export T3CODE_PERSONAL_PUSH_RELAY_TOKEN="$(cat /secure/path/relay-password)"
t3
```

No `.p8` file is installed on a T3 server. Relay settings take effect without restarting T3. Restart
the mobile app after first configuration so it immediately registers through the newly configured
backend.

On the iPhone, enable **Settings → Device Notifications** and allow the iOS permission prompt.
This is available without a T3 Connect account. Notifications cover completion, failure, approval
requests, and requests for input, including while the app is open. Live Activities have separate
permission and can work before device notifications are enabled. To revoke notification permission,
turn the switch off and follow the link to iOS Settings.

## Operations

`GET /healthz` is the only unauthenticated route. Back up the `push-relay-data` volume if preserving
registrations matters; otherwise the app re-registers them. Rotate the relay password by updating
its secret file and every T3 server together, then recreate the container. Rotate or revoke the Apple
key in the Apple Developer portal if the `.p8` is exposed.

The protocol is versioned under `/v1`. Upstream maintenance should preserve the personal-push
contract schemas, the additive server route layer, and the mobile connection bridge. Re-run the
focused tests plus the repository checks after changes to agent-awareness projection or relay
contracts. The bridge reconciles environment membership separately from prepared WebSocket state:
when a reconnect temporarily removes a bearer token, it retains the last usable personal push
endpoint and does not re-register the device or its Live Activities. Removing the environment or
changing its endpoint, credential, or authentication mode still reconciles the registration.

Standard notifications and Live Activity updates are separate deliveries. When agent work reaches
a terminal state, the relay sends the configured notification and keeps the completed Live Activity
updateable for five minutes. New work during that grace period reuses the activity; otherwise the
relay ends it and clears its update token.

The relay commits each publication and its pending deliveries together in SQLite before acknowledging
it. Transient APNs failures retry without another server publication, including after relay restart.
Retries back off from 30 seconds to five minutes, stop after six delivery attempts, and expire with
the activity. A newer state for the same device and thread replaces the pending state, so resuming
work cancels an undelivered approval alert. HTTP 200 means the relay accepted responsibility for
this bounded delivery process; it does not mean the phone displayed a notification.

Notification phases are stored per device, environment, and thread, independently of the five-row
Live Activity display. Successful notification delivery is retained when only the Live Activity
channel needs retrying. A successful alert embedded in a Live Activity also satisfies notification
delivery. Invalid tokens are cleared so the app can re-register them. A crash after Apple accepts
a request but before SQLite records success can cause a repeat.

## Retention and delivery bounds

This service is sized for a personal tailnet, not an unbounded multi-tenant deployment:

- activity rows expire physically from SQLite: starting/running after two hours, approval/input/stale
  after 24 hours, and completed/failed after 15 minutes;
- each accepted publication computes one aggregate snapshot and fans it out with at most four
  concurrent device deliveries;
- publications remain ordered so phase transitions and channel watermarks cannot race, but the
  in-process queue is capped at 256 and returns HTTP 429 when full;
- APNs provider JWTs and HTTP/2 sessions are reused by APNs environment; retryable failures keep the
  same APNs request ID and use bounded backoff;
- startup and snapshot reads also prune expired rows, covering environments that disappear without
  sending `state: null`.

A slow APNs request can still delay later ordered publications, and SQLite remains a single-process
store. Those are deliberate personal-service constraints, not a claim of multi-tenant scalability.

## Verification

```sh
vp test apps/push-relay/src
vp run --filter @bpdev/push-relay build
vp check
vp run typecheck
vp run lint:mobile
```
