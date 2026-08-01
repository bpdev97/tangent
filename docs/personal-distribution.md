# Tangent iOS and macOS Distribution

This guide covers the `bpdev97` personal distribution. It intentionally omits Android, the hosted web
app, npm publishing, Clerk, and the managed relay. Mobile connects directly to an environment over
LAN or a tailnet.

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

The mobile app checks this channel once per JavaScript launch. Offline and development-client
failures are recoverable and stay quiet during that automatic check. A manual check from Settings
continues to show its concrete failure so the user can retry or diagnose the release channel.

## macOS signing and notarization

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

Every personal macOS release also publishes `tangent-server-X.Y.Z.tgz` and its SHA-256 sidecar.
Manual launch, SSH launch, background-service installation, and self-update must resolve that exact
GitHub Release asset. They must not fall back to the upstream npm package merely because its version
matches.

The self-updater streams the archive into a unique temporary file while enforcing the 200 MiB limit
and computing SHA-256. It renames the file into place only after the sidecar checksum matches,
removes failed temporary files, and keeps the current archive plus one previous download under
`<Tangent home>/runtime/downloads`.

## Upstream synchronization

The personal upstream-sync workflow runs once each Monday and opens a PR from
`sync/upstream-main`. It does not auto-merge and never receives Expo or Apple credentials. Conflicts
are resolved on the sync branch, all required checks run, and the resulting merge is reviewed before
entering `main`.
