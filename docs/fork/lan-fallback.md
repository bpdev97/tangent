# FORK-LAN-001: Local network address for the background service

## Why

Tangent's owner pairs the phone through the host's Tailscale Serve address, and Tailscale on iOS
often stops routing. The owner is usually on the same Wi-Fi as the host, so the host is still
reachable on its local IP.

Upstream now handles the client side: a saved environment holds several routes, the client fails
over between them, and a connected server reports the LAN and tailnet addresses it listens on so
clients learn them (upstream #15467 and #15468). A server only reports LAN addresses while it
listens beyond loopback, and upstream's background service always listens on loopback. Tangent
adds the missing piece: a listen address for the background service that survives updates, so
headless hosts are reachable, and learnable, on the local network.

## Behavior

- `t3 service install --host 0.0.0.0` writes `T3CODE_HOST` into the launchd plist or systemd unit.
  Every later install, including `t3 update`, reads it back from the installed unit and keeps it.
- `t3 service install --host 127.0.0.1` goes back to this machine only, and `t3 service status`
  shows the address when one is set.
- Use `0.0.0.0` rather than the LAN IP: Tailscale Serve proxies to `127.0.0.1`, which a LAN-only
  bind would stop answering.
- Learning the addresses, storing them, failing over, and showing them in settings are upstream's.
  The desktop app needs network access on, as upstream documents.

## Upstream hooks

Each hook is marked `Tangent(FORK-LAN-001)`.

- `apps/server/src/cloud/bootService.ts`: the plan's `host`, the `T3CODE_HOST` line in both
  renderers, `install`'s `host` option and read-back, and `status`'s `installedHost`, which also
  renders the unit it compares against.
- `apps/server/src/cli/service.ts`: `t3 service install --host`, `reconcileService` treating a new
  address as a change, and the status line.

Fork-owned: `apps/server/src/cloud/serviceListenHost.ts` and its test.

## Resolving conflicts

- `bootService.ts`: keep the host in the rendered unit and read it back with `bootServiceHostOf`.
  If upstream adds its own service listen address, use it and drop the fork's option.
- `service.ts`: take upstream's command and re-add the `--host` flag, the changed-address check in
  `reconcileService`, and the status line.

## Never

- Never bring back the fork's own address learning or failover (the `lanHttpBaseUrls` descriptor
  field, `LanFallback`, the mobile Keychain address book). Upstream's routes own that.
- Never change the listen address of a service installed without `--host`.

## Remove when

Upstream's background service can listen on the local network and keeps that choice across
updates, or Tailscale on iOS becomes reliable enough that the owner no longer needs it.

## Verify

```sh
vp test run apps/server/src/cloud/serviceListenHost.test.ts
```

Plus one pass on the phone at home: connect once with Tailscale on, confirm the host's LAN address
appears as a learned route, then turn Tailscale off and confirm the environment reconnects.
