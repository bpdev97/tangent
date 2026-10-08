# FORK-CONNECT-001: T3 Connect for the server

## Why

Tailscale on the owner's iPhone often stops routing, and away from home there is no LAN to fall
back to ([FORK-LAN-001](lan-fallback.md)). T3 Connect gives each server a public HTTPS address
through a managed tunnel, and webhook tasks only get a public URL on a linked server. Upstream's
maintainers allow forks to use the production deployment; its identifiers are published in
`.env.example`.

Tangent's apps cannot sign in to T3 Connect. Sign-in is tied to upstream's Apple team, bundle IDs,
and web domain, and the managed relay cannot send notifications to Tangent's bundle ID. So Tangent
links only the server, and the phone pairs with the tunnel address like any other address.

## Behavior

- Release builds of the server and the desktop app's bundled server carry upstream's relay URL,
  Clerk publishable key, and CLI OAuth client ID. `scripts/personal-connect-env.ts` reads them from
  `.env.example` at release time, so they follow upstream. `t3 connect` then works as upstream
  documents, including webhook URLs.
- `T3CODE_CLERK_JWT_TEMPLATE` is never set. Web, desktop, and mobile show T3 Connect sign-in only
  when it is, so Tangent's clients stay as they were. Mobile builds get none of the values. One
  side effect: the desktop app's content security policy lists upstream's Clerk origin as a script
  source, though nothing loads from it.
- `t3 pair --connect` prints a pairing link for the server's tunnel address. The server does not
  store that address, so the command reads it from the relay's list of linked environments with
  the credential `t3 connect` saved, then asks the address who it is.
  - Not linked, or signed out: it says to run `t3 connect` and mints nothing.
  - A `--publish-only` link has no tunnel: it says so and mints nothing.
  - The address answers as another server, or as something that is not a T3 server: it refuses.
  - The address does not answer, or answers with a server error (Cloudflare sends 530 while a
    tunnel has no connected origin): it prints the link with a warning. The relay is the only
    source for the address, and a tunnel can take a moment to come up.
- The phone adds the link with **Add route**. Upstream's client files it as a public route, after
  LAN and tailnet routes, and fails over between them. The connection is an ordinary paired one, so
  [FORK-PUSH-001](push-relay.md) keeps registering through it.
- A linked server refuses the credentials the relay requests for a signed-in client
  (`RelayCredentialMinting`, off). Upstream's clients connect that way, which makes the T3 Connect
  account and the relay's signing key a way into the server. No Tangent client signs in, so
  pairing stays the only way in. Health checks, webhook deliveries, and tunnel recovery use other
  requests and keep working.
- A development build has no values, so a fresh worktree server cannot make a link. State copied
  from a linked server would still carry its link; `vp run migrate-dev-db` copies only the
  database, not secrets.

What a linked server trusts that a tailnet route does not:

- The server is reachable from the internet, and its own sign-in is the only gate.
- Traffic through the tunnel is decrypted at Cloudflare, in upstream's account. Whoever can read
  it there can copy the phone's session token, which is a bearer token valid for 30 days unless
  revoked. Upstream's signed-in clients use tokens bound to a key on the device instead.

Not carried: T3 Connect sign-in in any Tangent app, reaching a Tangent server from upstream's
signed-in clients, the **Hold webhooks while offline** setting (its only control is behind
sign-in), and publishing agent activity to the managed relay.

## Upstream hooks

Each is marked `Tangent(FORK-CONNECT-001)`:

- `apps/server/src/cli/pair.ts`: the `--connect` flag and the branch that calls
  `resolveConnectPairingBase`.
- `apps/server/src/cloud/CloudLink.ts`: reads `RelayCredentialMinting` and refuses at the top of
  `mintCredential`, which both mint routes call.
- `docs/user/remote-access.md`: one paragraph under T3 Connect.

Fork-owned: `apps/server/src/cloud/connectPairing.ts`,
`apps/server/src/cloud/relayCredentialMinting.ts`, their tests,
`apps/server/src/cli/pairConnect.test.ts`, `scripts/personal-connect-env.ts` and its test, and the
three `Tangent(FORK-CONNECT-001)` steps in `.github/workflows/personal-macos-release.yml`.

## Resolving conflicts

- `pair.ts`: take upstream's command and re-add the flag and the branch. If upstream adds its own
  way to pair through the T3 Connect address, use it and drop the fork's.
- `CloudLink.ts`: take upstream's file and re-add the refusal as the first statement of
  `mintCredential`. If upstream adds another way for the relay or a cloud account to obtain a
  session, refuse that too. `relayCredentialMinting.test.ts` signs a valid request and must keep
  showing it refused.
- If `scripts/personal-connect-env.test.ts` fails, upstream renamed or removed a value in
  `.env.example`. Find the new source for the three values in upstream's release workflow and
  `scripts/lib/public-config.ts`, and update the script. Do not hard-code the values.
- If the release's "Check T3 Connect is built into the server" step fails, upstream changed how
  the server build reads the values (`apps/server/vite.config.ts`,
  `apps/server/src/cloud/publicConfig.ts`). Follow the new names.
- If upstream stops gating client sign-in on the JWT template, keep sign-in off in Tangent's
  clients another way before releasing.
- If the relay stops listing a linked environment's endpoint to the CLI credential
  (`GET /v1/environments`), store the endpoint from the link response instead.

## Never

- Never set `T3CODE_CLERK_JWT_TEMPLATE`, or otherwise show T3 Connect sign-in in a Tangent app,
  until sign-in works for Tangent's identity.
- Never let a linked server issue credentials at the relay's request while no Tangent client
  signs in.
- Never register the phone with the managed relay for notifications. It cannot deliver to
  Tangent's bundle ID; the personal relay does.
- Never make a pairing link for an address that answers as anything but this server.
- Never give development builds the values.
- Never describe a T3 Connect route as being as private as a tailnet route.

## Remove when

Upstream lets a fork's apps sign in to T3 Connect, or Tailscale on iOS becomes reliable and the
owner stops using webhook tasks. `t3 pair --connect` alone goes away when upstream can pair
through the T3 Connect address itself.

## Verify

```sh
vp test run apps/server/src/cloud/connectPairing.test.ts \
  apps/server/src/cloud/relayCredentialMinting.test.ts apps/server/src/cli/pairConnect.test.ts \
  scripts/personal-connect-env.test.ts
```

Then one pass on a released build: run `t3 connect` on a host, run `t3 pair --connect`, add the
link on the phone with Tailscale off, and confirm the environment connects and a notification
arrives. Create a webhook task and confirm its URL starts with the relay's address.
