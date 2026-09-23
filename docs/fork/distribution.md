# FORK-DIST-001: Tangent distribution

## Why

Tangent must run beside the official T3 Code app without sharing its state, updates, or identity.
It also has to update itself on headless hosts, such as the Hermes box, that only run the server.
Without a separate identity, the official app's updater could replace the fork, and the two apps
would read and write the same database.

## Behavior

Identity lives in [`downstream/config.ts`](../../downstream/config.ts). The mobile-only slice is
[`downstream/mobile-config.ts`](../../downstream/mobile-config.ts); Expo and mobile code import only
that slice, so desktop-only changes never alter the iOS runtime fingerprint.

- GitHub repository `bpdev97/tangent`. Releases are tagged `personal-vX.Y.Z` and carry
  `tangent-server-X.Y.Z-<platform>` archives plus `SHA256SUMS`.
- State root `~/.bpdev-code`. Electron profiles `bpdev-code-v2` (and `bpdev-code-dev` in
  development), so Chromium data is never shared with the official app.
- Background service `tangent.service` on Linux and `com.bpdev97.tangent.service` on macOS, so it
  installs beside, never over, the official service.
- macOS bundle `com.bpdev97.t3code.macos`, product name `Tangent`, URL schemes `bpdev-code` and
  `bpdev-code-dev`. The renderer keeps upstream's private `t3code://app` origin: it is scoped to the
  app process and needs no server CORS change.
- iOS bundle `com.bpdev97.t3code.ios`, Apple team `BL9B7SKPHX`, App Store Connect app `6790012550`,
  Expo project `@bpdev97/t3-code-personal` (`8c5853ac-04f2-4d67-9f59-a699cb3c9776`) on the
  `personal` channel, URL scheme `bpdev-code`. The Expo config ships iOS only.
- The manual server-update command shown in the web client is `t3 update <version>`; upstream's
  `npx t3@<version>` would install upstream's package.
- The personal build has no Clerk, managed relay, or passkey entitlements. Desktop passkey signing
  runs only when a provisioning profile is configured. Mobile connects directly over LAN or tailnet.
- The `app-builder-lib@26.15.6` patch keeps certificate import passwords separate from the
  temporary keychain password in CI signing. Remove it only when an unpatched version passes
  `apps/desktop/scripts/mac-signing.test.mjs`.
- Release workflows (`personal-macos-release.yml`, `personal-ios-release.yml`) publish only when
  checks pass and the version does not exist yet. macOS releases stay drafts until every asset is
  uploaded. `personal-ci.yml` runs the checks on `main`.

Deliberately not carried: renaming in-app text, permission prompts, CLI messages, or artwork;
Linux and Windows desktop identity (Tangent ships only macOS desktop); and the old fork's
streaming server-archive download. Upstream buffers the archive in memory and keeps each installed
runtime version for rollback; propose a streaming download upstream if memory on small hosts
becomes a problem.

## Upstream hooks

Code, each marked `Tangent(FORK-DIST-001)` where it is not self-evident:

- Desktop: `DesktopEnvironment.ts` (product name), `DesktopStatePaths.ts` (state root),
  `DesktopUserData.ts` (Electron profile names), `scripts/electron-launcher.mjs` (dev bundle
  identity), `apps/desktop/tsconfig.json` (includes `downstream/`).
- Server: `cloud/bootService.ts` (service name and launchd label), `cli/update.ts` (service cgroup
  name), `scripts/t3-sqlite-state.ts` (refuses to write the live Tangent database).
- Shared: `packages/shared/src/cliRelease.ts` (repository, tag prefix, archive prefix) and
  `packages/ssh/src/tunnel.ts` (remote state root, tag prefix, archive prefix).
- Web: `versionSkew.ts` (manual update command).
- Mobile: `app.config.ts`, `eas.json` (`personal` build and submit profiles), `package.json` (dev
  client schemes), `App.tsx`, `appLinking.ts`, and `pairing.ts` (Tangent URL schemes),
  `app-updates.ts` (automatic update checks stay quiet on network and dev-client errors).
- Scripts: `build-cli-archive.ts`, `build-desktop-artifact.ts` (app ID, product and artifact names,
  macOS URL schemes, passkey signing gate), `install.sh` and `install.ps1` (run without Node, so
  they repeat the identity values), `mobile-native-client.ts` (iOS dev bundle and project name),
  `dev-runner.ts` (dev state root), `scripts/tsconfig.json` (includes `downstream/`).
- `pnpm-workspace.yaml` and `pnpm-lock.yaml`: the `app-builder-lib` patch entry.

Tests only change expected identity values. When upstream edits them, re-apply these substitutions:

| Upstream value                                                 | Tangent value                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `~/.t3`, `.t3/`                                                | `~/.bpdev-code`, `.bpdev-code/`                                  |
| `t3code-v2`, `t3code-dev` (Electron profile)                   | `bpdev-code-v2`, `bpdev-code-dev`                                |
| `T3 Code (Alpha)` (desktop name), `T3 Code (Nightly)`          | `Tangent`, `Tangent Nightly`                                     |
| `com.t3tools.t3code` (macOS app ID)                            | `com.bpdev97.t3code.macos`                                       |
| macOS `{ name: "T3 Code", schemes: ["t3code", "t3code-dev"] }` | `{ name: "Tangent", schemes: ["bpdev-code", "bpdev-code-dev"] }` |
| `t3code.service`, `com.t3tools.t3code.service`                 | `tangent.service`, `com.bpdev97.tangent.service`                 |
| `t3-<version>-<platform>` archives                             | `tangent-server-<version>-<platform>`                            |
| `/v<version>` release paths, `v1.2.3` tags                     | `/personal-v<version>`, `personal-v1.2.3`                        |
| `pingdotgg/t3code`                                             | `bpdev97/tangent`                                                |

Linux and Windows expectations stay upstream's.

## Resolving conflicts

- Upstream wins on how installation, updating, packaging, and signing work. Re-apply only the
  identity values listed above.
- When upstream adds a new identity value that matters to installs, updates, service names, or
  state, read it from `downstream/config.ts`. Leave cosmetic "T3 Code" text alone.
- When upstream changes the archive layout or launcher protocol, adopt it and keep the Tangent
  archive prefix and tag prefix.

## Never

- Never fall back to the official app's state directory, update feed, service name, Electron
  profile, or release artifacts.
- Never put credentials in the repository. They live in GitHub Actions, Expo, App Store Connect, or
  deployed secret files.
- Never rebrand in-app product vocabulary or artwork.
- Never import `downstream/config.ts` from mobile or Expo code; use `downstream/mobile-config.ts`.

## Remove when

This feature exists as long as the fork is distributed separately. Individual hooks go away if
upstream adds a distribution-config seam that covers them.

Only `personal-*` workflows run in `bpdev97/tangent`. Every upstream workflow is disabled in the
repository's Actions settings rather than guarded in code, which keeps upstream's workflow files
unedited. GitHub enables newly added workflow files by default, so the sync disables any new
upstream workflow after publishing.

## Verify

Run the focused tests `check-fork` prints, plus
`vp test run apps/desktop/src/app apps/server/src/cloud apps/server/src/cli packages/ssh/src`.
Upstream's Windows cross-architecture packaging test in `scripts/build-desktop-artifact.test.ts`
fails on macOS hosts with or without Tangent. Before a release, confirm the personal identity,
build and release inputs, and workflow availability.
