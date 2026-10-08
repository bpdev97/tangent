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
  when it is, so Tangent's clients stay as they were. Mobile builds get none of the values.
- `t3 pair --connect` prints a pairing link for the server's tunnel address. The server does not
  store that address, so the command reads it from the relay's list of linked environments with
  the credential `t3 connect` saved, then checks that the address answers as this server.
  - Not linked, or signed out: it says to run `t3 connect` and mints nothing.
  - A `--publish-only` link has no tunnel: it says so and mints nothing.
  - The address answers as another server: it refuses.
  - The address does not answer yet: it prints the link with a warning, as `--tailscale` does.
- The phone adds the link with **Add route**. Upstream's client files it as a public route, after
  LAN and tailnet routes, and fails over between them. The connection is an ordinary paired one, so
  [FORK-PUSH-001](push-relay.md) keeps registering through it.
- Development builds get no values and cannot link, so a worktree server never reaches the
  production relay.
- A linked server has upstream's trust model, which a tailnet route does not: the server is
  reachable from the internet and its own sign-in is the only gate, traffic through the tunnel is
  decrypted at Cloudflare in upstream's account, and the relay can ask the server to mint a
  credential for the linked T3 Connect account. The phone's paired session is a bearer token, not
  the proof-bound token upstream's signed-in clients use.

Not carried: T3 Connect sign-in in any Tangent app, the **Hold webhooks while offline** setting
(its only control is behind sign-in), and publishing agent activity to the managed relay.

## Upstream hooks

Each is marked `Tangent(FORK-CONNECT-001)`:

- `apps/server/src/cli/pair.ts`: the `--connect` flag and the branch that calls
  `resolveConnectPairingBase`.
- `docs/user/remote-access.md`: one paragraph under T3 Connect.

Fork-owned: `apps/server/src/cloud/connectPairing.ts` and its test,
`apps/server/src/cli/pairConnect.test.ts`, `scripts/personal-connect-env.ts` and its test, and the
three `Tangent(FORK-CONNECT-001)` steps in `.github/workflows/personal-macos-release.yml`.

## Resolving conflicts

- `pair.ts`: take upstream's command and re-add the flag and the branch. If upstream adds its own
  way to pair through the T3 Connect address, use it and drop the fork's.
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
- Never register the phone with the managed relay for notifications. It cannot deliver to
  Tangent's bundle ID; the personal relay does.
- Never make a pairing link for an address that does not answer as this server.
- Never give development builds the values.

## Remove when

Upstream lets a fork's apps sign in to T3 Connect, or Tailscale on iOS becomes reliable and the
owner stops using webhook tasks. `t3 pair --connect` alone goes away when upstream can pair
through the T3 Connect address itself.

## Verify

```sh
vp test run apps/server/src/cloud/connectPairing.test.ts apps/server/src/cli/pairConnect.test.ts \
  scripts/personal-connect-env.test.ts
```

Then one pass on a released build: run `t3 connect` on a host, run `t3 pair --connect`, add the
link on the phone with Tailscale off, and confirm the environment connects and a notification
arrives. Create a webhook task and confirm its URL starts with the relay's address.
