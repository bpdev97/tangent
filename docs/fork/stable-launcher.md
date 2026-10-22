# FORK-LAUNCHER-001: Stable service launcher

## Why

Upstream installs each version in its own directory, `runtime/versions/<version>`, and points
everything at one of them: the `t3` symlink, and the program the launchd plist or systemd unit
runs. Two things then go wrong on hosts that run the background service:

- An update started from a client only changes `activeVersion` in `service-state.json`. The `t3`
  symlink and the unit stay where they were, so the terminal `t3` falls behind and
  `t3 service status` reports the service as newer than the CLI until someone runs `t3 update`.
- macOS records privacy grants (Full Disk Access, Files and Folders) for a command-line program by
  its full path plus its code requirement. The launchd job's program is the responsible process for
  every agent the service starts, so each move of the unit to a new version directory meant
  granting Full Disk Access again.

Every Tangent build is Developer ID signed with the same designated requirement
(`identifier t3` and team `BL9B7SKPHX`, no hash), so a newer build at the same path satisfies the
recorded requirement. Checked on 2026-10-21 with `codesign -v -R` against builds 0.2.12 to 0.2.18,
including a copy renamed into place. A fixed path is therefore enough; a separate signed `.app`
bundle would add a second signed artifact to every release for no gain.

## Behavior

- `runtime/launcher/t3` is a copy of the active version's executable, and every unit runs it as
  `t3 __service-launcher`. It is replaced by copying into a staging directory beside it, running
  the copy with `__service-launcher --check`, and renaming it into place, so a running launcher
  keeps its own file. `runtime/launcher/version` records the build and the inode it was written
  for, so when two installs race, a marker describing the other copy reads as stale.
- The launcher starts before the rest of the CLI loads (a fast path in `bin.ts`), because the copy
  has no `node_modules` beside it. Builds before this feature cannot, so installing one of them
  (a downgrade) keeps the versioned program, as upstream does.
- `runtime/current` is a relative symlink to `versions/<active version>`. Every `t3` link points at
  `runtime/current/t3`, so moving `current` with one rename moves all of them. That is more robust
  than rewriting each link on every update: it covers links the service cannot see, and nothing
  can be left half done.
- Who moves things:
  - `t3 service install` and `t3 update` (through the boot service install) install the launcher
    for the version they install and, once the install has passed its pending-update and
    downgrade checks, point `current` at it and repoint links. A handed-off systemd install does
    this from the transient unit.
  - `t3 update` then points `current` at the version the service state selects, or at its target
    when no service is installed.
  - A launcher-managed server, once committed as the active version, points `current` at itself,
    repoints links, refreshes the launcher, and moves a unit that still names a versioned runtime
    onto the fixed launcher. This covers updates started from a client and rollbacks. It does
    nothing while `service-state.json` selects another version or has an update pending, so a
    server that is about to be replaced never moves `t3` back. launchd and systemd use the new
    program the next time they load the unit (login, boot, or `t3 service restart`).
  - Every publication points `current` at the version the state selects and checks the state
    again after its rename. Whoever changes the selection publishes afterwards, so when two of
    them interleave the last selection wins.
  - One exception: when another server owns the T3 home, the launcher records the previous
    version and idles without starting a server, so nothing publishes until the service is
    restarted, which that state requires anyway.
- A build from before this feature knows nothing of `current`. Downgrading the service to one
  leaves `t3` on the newer build until the next update by a build that has it. That only matters
  for a downgrade run from inside a Linux service, where the target build performs the install;
  everywhere else the newer CLI publishes after the install.
- Links are repointed only when they are symlinks into this home's `runtime/versions`. Candidates
  are the `runtime/launchers` file, the install directory, and `PATH`.
- `t3 service status` reports a unit that does not run the fixed launcher, or a missing launcher,
  as needing repair, so `t3 service install` migrates it.
- The service's `PATH` names `runtime/current` instead of any of this home's version
  directories, both when installing and when a server migrates an existing plist. A version
  directory on `PATH` would run an old `t3` inside the service and, through the `launchers` file,
  keep that runtime from ever being pruned. Entries in `runtime/launchers` that are runtimes
  rather than links are dropped for the same reason.

## Upstream hooks

Each hook is marked `Tangent(FORK-LAUNCHER-001)`.

- `apps/server/src/bin.ts`: the `__service-launcher` fast path.
- `apps/server/src/cloud/bootService.ts`: the plan's program, installing the launcher and falling
  back to the versioned path, adopting `current`, the launcher check in `status`, the `PATH`
  entries, and exporting `quoteSystemdValue`, `escapeXmlText`, and `unescapeXmlText`.
- `apps/server/src/cli/update.ts`: `adoptCurrentRuntime` after the service install instead of
  `repointLauncher` outside Windows.
- `apps/server/src/cli/uninstall.ts`: claims a link to `runtime/current/t3`.
- `apps/server/src/serverRuntimeStartup.ts`: settles the layout after `prepareTrial`.
- `scripts/install.sh`: the `current` link.
- Tests: `bootService.test.ts` (harness answers the launcher check; expected programs) and
  `uninstall.test.ts`.

Fork-owned: `apps/server/src/serviceLauncherFastPath.ts`,
`apps/server/src/cloud/stableLauncher.ts`, `apps/server/src/cloud/stableLauncherSettle.ts`, and
`stableLauncher.test.ts`.

## Resolving conflicts

- `bootService.ts`: keep upstream's install transaction and re-add the launcher install right
  before the unit is written, after the pending-update and downgrade checks. A refused install must
  not have replaced the launcher, because the failure path restarts the old unit.
- `bin.ts`: keep the fast path before the full CLI import.
- If upstream changes the launcher protocol or runtime layout, keep `runtime/launcher` and
  `runtime/current` outside `runtime/versions`, so pruning never sees them.
- If upstream adopts its own fixed launcher or current link, use it and drop this feature.

## Never

- Never write the launcher in place. macOS kills a process whose signed executable changes under
  it.
- Never point a unit at the fixed launcher without first running the copy with `--check`.
- Never let a server move `current` before its update commits, or after the service state has
  selected another version.
- Never repoint a link that is not a symlink into this home's `runtime/versions`.

## Remove when

Upstream runs its service from a fixed path and keeps `t3` in step with updates started from a
client.

## Verify

```sh
vp test run apps/server/src/cloud/stableLauncher.test.ts apps/server/src/cloud/bootService.test.ts apps/server/src/cli/uninstall.test.ts
```

Upstream has no test for `scripts/install.sh`; after changing it, run it in a disposable Linux
container against a local release and check `runtime/current` and the `t3` link. After a release, on a Mac with the service:
`plutil -p ~/Library/LaunchAgents/com.bpdev97.tangent.service.plist` names
`runtime/launcher/t3`, `readlink ~/.local/bin/t3` is `<T3 home>/runtime/current/t3`, and
`t3 service status` reports the active version with no warning.
