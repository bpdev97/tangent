# FORK-LAN-001: Local network fallback

## Why

Tangent's owner pairs the phone through the host's Tailscale Serve address, and Tailscale on iOS
often stops routing. The owner is usually on the same Wi-Fi as the host, so the host is still
reachable on its local IP. Upstream stores one address per saved environment, so the phone just
fails until Tailscale recovers. Tangent lets the phone fall back to the host's local-network
address on its own, with nothing shown in the UI.

## Behavior

- The server adds `lanHttpBaseUrls` to the descriptor at `/.well-known/t3/environment`: one
  `http://<ipv4>:<port>` URL per local-network interface, excluding loopback, link-local, and
  Tailscale addresses. The key is omitted while the server listens on loopback only, so the desktop
  app needs network access on (`serverExposureMode: "network-accessible"`). Only this route
  carries it, not the WebSocket config snapshot, MCP tools, or cloud publication.
- Mobile learns the list only from a connection made through the saved address, so trust never
  extends from an address the user didn't pair. Each environment's list and its last working
  address live in the Keychain under `tangent.lan-addresses.v1.<environmentId>`, and are removed
  with the environment.
- Connecting a bearer-paired environment authorizes through all known addresses at once. The address
  that connected last starts first. The others start 750 ms later, or as soon as it fails, because
  a broken tailnet usually hangs rather than fails. The first address that answers as the expected
  environment wins, and the rest are interrupted. If all fail, the error from the saved address is
  reported, as it is without the fallback.
- Every consumer reads `PreparedConnection.httpBaseUrl`, so the WebSocket, assets, and uploads all
  follow the winning address. Each reconnect runs the race again, so moving on or off the home
  network needs nothing extra. The UI keeps showing the saved address.
- Web and desktop provide no `LanAddressBook`, so they connect exactly as upstream does. Relay and
  SSH connections are unchanged.
- Accepted risk, the same as upstream's pairing over a local address: the bearer token goes over
  plain HTTP to a learned address. On another network that reuses the same private IP and port, a
  server that answers with this environment's ID (served unauthenticated) would receive the token.
  If that matters, add a challenge before sending the token: the host proves it can re-derive the
  token's signature from its payload with the session signing secret.

## Upstream hooks

Each hook is marked `Tangent(FORK-LAN-001)`.

- `packages/contracts/src/environment.ts`: the optional `lanHttpBaseUrls` descriptor field.
- `apps/server/src/http.ts`: the metadata `descriptor` handler adds the URLs.
- `packages/client-runtime/src/connection/resolver.ts`: the bearer broker calls
  `lanFallback.authorizeBearer`, and `prepare` calls `lanFallback.remember` after the compatibility
  check.
- `packages/client-runtime/src/connection/index.ts`: the `LanFallback` export.
- `apps/mobile/src/connection/platform.ts`: provides `lanAddressBookLayer` and removes the
  addresses in the environment cleanup.

Fork-owned: `apps/server/src/environment/lanHttpBaseUrls.ts`,
`packages/client-runtime/src/connection/lanFallback.ts`, `apps/mobile/src/connection/lan-addresses.ts`,
and their tests.

## Resolving conflicts

- `resolver.ts`: keep upstream's bearer broker and replace its `remote.authorizeBearer` call with
  `lanFallback.authorizeBearer(remote, sameInput)`. Keep `remember` after the descriptor's
  environment and compatibility checks.
- `http.ts`: if upstream moves the descriptor route, re-wrap whichever handler serves
  `/.well-known/t3/environment`, and only that one.
- If upstream adds a second address, or address lists, to `BearerConnectionProfile`, move the
  learned addresses there and delete the Keychain store.

## Never

- Never learn addresses from a connection made through a learned address.
- Never start alternates before the head start unless the first attempt has failed.
- Never show the learned addresses or the winning address in the UI.
- Never add `lanHttpBaseUrls` to responses other than the well-known descriptor.

## Remove when

Upstream supports several addresses per paired environment with automatic failover, or Tailscale
on iOS becomes reliable enough that the owner no longer needs it.

## Verify

```sh
vp test run packages/client-runtime/src/connection/lanFallback.test.ts apps/server/src/environment/lanHttpBaseUrls.test.ts packages/client-runtime/src/connection/resolver.test.ts
```

Plus one pass on the phone at home: connect once with Tailscale on, then turn Tailscale off and
confirm the environment reconnects within a second or two.
