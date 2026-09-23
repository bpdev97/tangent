# Tangent push relay

A small self-hosted service that delivers Tangent's iOS notifications and Live Activity updates
through APNs. It replaces T3 Connect's managed relay in the personal build. Why it exists and what
must stay true are in [`docs/fork/push-relay.md`](../../docs/fork/push-relay.md).

The relay owns the APNs provider key. Tangent servers reach it with a shared password over the
tailnet; phones register through their already-authenticated Tangent server and never see the
password or the key.

## Container setup

From `apps/push-relay`, copy `.env.example` to `.env` and fill in the Apple identifiers and the
host's Tailscale address. Create the secret files without committing them:

```sh
mkdir -p secrets
openssl rand -base64 32 > secrets/relay-password
cp ~/Downloads/AuthKey_KEYID.p8 secrets/
chmod 600 secrets/relay-password secrets/AuthKey_KEYID.p8
docker compose --env-file .env -f compose.example.yml up -d --pull always
```

- The Apple Team ID, Key ID, bundle ID, and APNs environment are identifiers, not secrets. The
  `.p8` file and the relay password are secrets. Prefer an Apple key restricted to APNs.
- Production and TestFlight builds use `APNS_ENVIRONMENT=production`. Development-signed builds use
  `sandbox` and should get a separate relay instance and database. Registrations whose bundle ID or
  APNs environment differ from the container's configuration are rejected.
- The published port binds only to `TAILNET_BIND_ADDRESS`. Restrict it with Tailscale grants to the
  machines that run Tangent servers.
- The password must be at least 32 characters.

## Image tags

The `personal-push-relay-image.yml` workflow publishes `ghcr.io/bpdev97/bpdev-code-push-relay` for
Linux AMD64 and ARM64 whenever relay code reaches `main`:

- `latest` follows `main`.
- `sha-<git-commit>` is immutable. Set `RELAY_IMAGE` in `.env` to one of these tags, or to a
  digest, for a pinned deployment.

If the package is private, make it public once in GitHub's package settings, or log the host in
with a classic personal access token that has `read:packages`:

```sh
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username bpdev97 --password-stdin
```

Publishing uses the workflow's short-lived `GITHUB_TOKEN`; no registry secret is needed.

To build locally instead, run this from the repository root and point the compose file at the local
tag:

```sh
docker build -f apps/push-relay/Dockerfile -t bpdev-code-push-relay:local .
RELAY_IMAGE=bpdev-code-push-relay:local \
  docker compose --env-file apps/push-relay/.env -f apps/push-relay/compose.example.yml up -d
```

## Connecting Tangent servers

On each machine running Tangent, open **Settings → General → Notifications**, enter the relay URL
and the contents of `secrets/relay-password`, save, then use **Test connection**. The password is
kept in that server's secret store; it is never written to `settings.json` or sent to clients.
Changes take effect without a restart.

Headless servers can use environment variables instead. Saved settings take precedence:

```sh
export T3CODE_PERSONAL_PUSH_RELAY_URL=http://100.x.y.z:8788
export T3CODE_PERSONAL_PUSH_RELAY_TOKEN="$(cat /secure/path/relay-password)"
```

No `.p8` file is installed on a Tangent server. On the iPhone, enable **Settings → Notifications →
Device Notifications** and allow the iOS prompt.

## Operations

- `GET /healthz` is the only unauthenticated route. The protocol is versioned under `/v1`.
- Back up the `push-relay-data` volume to keep registrations; otherwise phones re-register.
- Rotate the relay password by writing a new `secrets/relay-password`, saving the same value on
  every Tangent server, then recreating the container
  (`docker compose --env-file .env -f compose.example.yml up -d --force-recreate`). Until both
  sides match, publications fail with 401 and the server's **Test connection** reports it.
- If the `.p8` is exposed, revoke it in the Apple Developer portal, create a new key, replace the
  file, and update `APNS_KEY_ID`.

## Development

```sh
vp test apps/push-relay/src
vp run --filter @bpdev/push-relay build
```
