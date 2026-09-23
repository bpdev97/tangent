# FORK-DIST-001: Tangent distribution

## Why

Tangent must run beside the official T3 Code app without sharing its state, updates, or identity.
It also has to update itself on headless hosts, such as the Hermes box, that only run the server.
Without a separate identity, the official app's updater could replace the fork, and the two apps
would read and write the same database.

## Behavior

Public identity:

- GitHub repository `bpdev97/tangent`; Expo owner `bpdev97`; Apple team `BL9B7SKPHX`.
- iOS bundle `com.bpdev97.t3code.ios`; macOS bundle `com.bpdev97.t3code.macos`; display name
  `Tangent`; App Store Connect app `6790012550`.
- Expo project `@bpdev97/t3-code-personal` (`8c5853ac-04f2-4d67-9f59-a699cb3c9776`), channel
  `personal`.
- Mobile URL scheme `bpdev-code://`.
- State root `~/.bpdev-code`; Electron user-data directory `bpdev-code`.
- Releases are tagged `personal-vX.Y.Z`. Server archives are named
  `tangent-server-X.Y.Z-<platform>`, with `SHA256SUMS`. The service is `tangent.service`, and the
  launchd label is `com.bpdev97.tangent.service`.

Invariants:

- Canonical identity is composed in `downstream/config.ts`. The mobile-only slice lives in
  `downstream/mobile-config.ts`, and Expo and mobile code import only that slice, so desktop-only
  changes do not change the iOS runtime fingerprint.
- Keep upstream edits to the minimum that changes behavior: identity values, the release source,
  and packaging. Prefer upstream's existing configuration options over edits, leave upstream's
  user docs and tests alone where they still pass, and never edit a file only to rename T3 Code.
- The Tangent name appears only at install, release, update, service, state, and compatibility
  boundaries. In-app vocabulary, wordmarks, icons, and splash art stay T3 Code.
- The server updater streams into a unique temporary file, enforces a 200 MiB limit, verifies
  SHA-256 before renaming, and keeps the current and one prior archive. Never buffer a whole
  archive in memory.
- A matching upstream version is never a valid Tangent install. The install sentinel records both
  version and release URL. Local updates, SSH launches, service installs, and pinned runtimes all
  use Tangent's GitHub releases.
- Automatic mobile update checks stay quiet on network and dev-client errors. A manual check from
  Settings shows the error.
- Release workflows publish only when checks pass and the requested version does not exist yet.
  macOS releases stay drafts until every asset is uploaded, and release immutability stays enabled.
- The personal build has no Clerk, no managed relay, and no Associated Domains entitlement. Mobile
  connects directly over LAN or tailnet.
- The `app-builder-lib@26.15.6` patch keeps certificate import passwords separate from the temporary
  keychain password. Remove it only when an unpatched version passes the macOS signing regression.
- The development CORS policy allows the custom renderer origins derived from `downstream/config.ts`;
  otherwise a branded desktop opens but cannot finish authentication.

## Upstream hooks

To be filled in as the feature is ported. The target is fewer than 30 edited upstream files,
grouped as:

- identity values in desktop, mobile, web, server, and `packages/shared/src/cliRelease.ts`, read
  from `downstream/config.ts`;
- release-source behavior: pinned runtime, boot service, self-update, service install, CLI update,
  and SSH launch;
- `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, and desktop packaging and signing;
- the standalone installers (`scripts/install.sh`, `scripts/install.ps1`), which run without Node
  and so repeat the identity values.

Tangent install, update, and service instructions live in this record. Upstream's `docs/user`
pages stay unedited.

## Resolving conflicts

- Upstream wins on how installation, updating, and packaging work. Re-apply only the identity: the
  source repository, names, prefixes, and state roots.
- When upstream adds a new identity value that matters to installs, updates, or state, read it from
  `downstream/config.ts`. Leave purely cosmetic T3 Code names alone.
- When upstream changes the archive layout or launcher protocol, adopt it and keep the Tangent
  artifact prefix and verified-download rules.

## Never

- Never fall back to the official app's state directory, update feed, or release artifacts.
- Never put credentials in the repository. They live in GitHub Actions, Expo, App Store Connect, or
  deployed secret files.
- Never rebrand in-app product vocabulary or artwork.
- Never let desktop-only identity changes reach `downstream/mobile-config.ts`.

## Remove when

This feature exists as long as the fork is distributed separately. Individual hooks go away if
upstream adds a distribution-config seam that covers them.

## Verify

Focused tests are listed by `check-fork` once the feature is ported. Before a release, confirm the
personal identity, build and release inputs, and workflow availability.
