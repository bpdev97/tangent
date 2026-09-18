# Tangent iOS and macOS Distribution

This guide covers the `bpdev97` personal distribution. It intentionally omits Android, the hosted web
app, npm publishing, Clerk, and the managed relay. Mobile connects directly to an environment over
LAN or a tailnet.

Tangent is the installed-app and release identity used to keep the fork separate from upstream.
The in-app product identity, wordmarks, icons, and feature names remain T3 Code.
The server’s development CORS policy must allow the custom renderer origins derived from
`downstream/config.ts` alongside upstream origins; otherwise a branded desktop opens but cannot
finish authentication.

Notifications and Live Activities can optionally use the fork-owned homelab relay. See
[`docs/fork/personal-push-relay.md`](fork/personal-push-relay.md); it does not add Clerk or expose
the APNs provider key to phones or T3 servers.

## Public identity

- GitHub repository: `bpdev97/tangent`
- Expo owner: `bpdev97`
- Apple team: `BL9B7SKPHX`
- iOS bundle identifier: `com.bpdev97.t3code.ios`
- macOS bundle identifier: `com.bpdev97.t3code.macos`
- Display name: `Tangent`
- App Store Connect name: `Tangent`
- App Store Connect app ID: `6790012550`
- Mobile URL scheme: `bpdev-code://`
- macOS Quick Chat action: `bpdev-code-action://quick-chat`
- Desktop state root: `~/.bpdev-code`
- Electron user-data directory: `bpdev-code`

## Expo project

The Expo project remains `@bpdev97/t3-code-personal`, with public project ID
`8c5853ac-04f2-4d67-9f59-a699cb3c9776`.

Add an Expo access token as the GitHub Actions secret `EXPO_TOKEN` before running the workflow.
The App Store Connect record is `Tangent` (`6790012550`), and the ID is committed in the
`submit.personal.ios.ascAppId` field in `apps/mobile/eas.json`.

The personal iOS workflow supports two manually selected operations:

- `build`: queue a native iOS build and submit it to TestFlight.
- `update`: publish a JavaScript/assets update to the `personal` channel.

Use `build` whenever the Expo fingerprint changes. Use `update` only when the installed native
runtime is compatible.

Mobile identity lives in `downstream/mobile-config.ts`, which is the only downstream distribution
module imported by the Expo config and mobile runtime. `downstream/config.ts` composes that mobile
slice with desktop and server identity. Keep this boundary narrow: changing a desktop-only release
field must not invalidate an otherwise compatible iOS update.

The mobile app checks this channel once per JavaScript launch. Offline and development-client
failures are recoverable and stay quiet during that automatic check. A manual check from Settings
continues to show its concrete failure so the user can retry or diagnose the release channel.

## macOS signing and notarization

Dispatch personal releases from `main`. The macOS workflow rejects versions already present as a
tag or release, including drafts, and versions below the highest personal release. Release jobs
are serialized per platform. macOS publishing creates a draft, uploads all required installer,
updater, and server assets, and only then publishes it. Repository release immutability must remain
enabled so published tags and assets cannot be replaced. Use a new patch version to correct a
published build. If upload fails, the draft remains unpublished for inspection.

Configure these GitHub Actions secrets:

- `CSC_LINK`: base64-encoded Developer ID Application certificate (`.p12`).
- `CSC_KEY_PASSWORD`: password used when exporting the certificate.
- `APPLE_API_KEY`: App Store Connect API private key contents (`.p8`).
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect issuer ID.

The personal build deliberately omits Clerk passkey entitlements. It therefore does not need an
Associated Domains provisioning profile or a Clerk relying-party domain. Electron still signs the
application with hardened runtime support and notarizes it through Apple.

## First release order

1. Run the personal CI workflow successfully.
2. Run the iOS workflow in `build` mode and install the result from TestFlight.
3. Make a harmless JavaScript-only change and run the workflow in `update` mode.
4. Confirm the update appears after fully closing and reopening the iOS app.
5. Dispatch the macOS workflow with version `1.0.0`.
6. Install the DMG and confirm the About panel reports the `Tangent` GitHub update feed.
7. Publish `1.0.1` and exercise the in-app desktop updater.

## Server release artifacts

Every personal release publishes standalone server archives for `darwin-arm64`,
`linux-arm64`, `linux-x64`, `win32-arm64`, and `win32-x64`, plus `SHA256SUMS`.
Names are `tangent-server-X.Y.Z-<platform>.tar.gz` (ZIP on Windows), under the
`personal-vX.Y.Z` tag. The archive format, installer, service launcher, and CLI update
flow follow upstream. Native binaries and their resource monitor ship inside each
archive; Node.js is not required on the target host. macOS archives are signed and notarized.

The fork changes only the distribution source, artifact prefix, state roots, service
identity, and download constraints. `packages/shared/src/cliRelease.ts` derives server
release identity from `downstream/config.ts`. The standalone shell installers mirror
these values because they run without Node. A matching version from upstream is never
a valid cached Tangent install: the install sentinel records both version and release URL.
SSH, CLI updates, and service installation use the same identity.

The server installer streams the archive into a unique temporary file, enforces a 200 MiB
limit, and computes SHA-256 before renaming it. Interrupted downloads are removed; the
current and one prior verified archive remain under `<Tangent home>/runtime/archives`.
These bounds preserve predictable memory and disk usage on remote hosts.

Launcher protocol 3 uses the standalone executable layout. Services from 0.1.55 and earlier
need the one-time local launcher replacement in [Updating Tangent](user/updating.md).
The old npm archive is retired; keeping two runtime installers would defeat the shared
upstream implementation. Desktop updates keep their existing feed and data directory.

## Upstream synchronization

The personal upstream-sync workflow runs once each Monday and opens a PR from
`sync/upstream-main`. It does not auto-merge and never receives Expo or Apple credentials. Conflicts
are resolved on the sync branch, all required checks run, and the resulting merge is reviewed before
entering `main`.
