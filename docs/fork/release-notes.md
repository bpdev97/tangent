# FORK-NOTES-001: Release notes after an update

## Why

Every Tangent release already has plain-language notes on GitHub, written by the sync run, but
nothing in the app shows them. Upstream's in-app notes appear only on the nightly channel and only
before an update is installed, so Tangent never sees them, and its one release link pointed at
upstream's repository. The owner wants to see what changed right after updating, on every device.

## Behavior

- Each client remembers the release it last ran: web and desktop in the browser profile's local
  storage, iOS in device preferences. A first run and a downgrade are remembered silently.
- When a client finds itself on a newer release, it shows one notice: a pill in the sidebar footer
  on web and desktop, a row above the thread list on iOS. The notice goes away once the notes for
  that release have been shown, or when it is dismissed. An iOS update can arrive before the
  macOS workflow publishes the release; opening the notes then says so and the notice stays.
- The notes are read from GitHub's public release list for `bpdev97/tangent` each time they are
  opened. Nothing is fetched at launch, and no token is sent. If GitHub cannot be reached, the
  view says so and links to the releases page.
- The view lists every release since the one the client last ran, marked New, then up to ten
  earlier releases. Releases newer than the running build are left out.
- The notes stay reachable from Settings → About → Release notes on every client, and from the
  command palette on web and desktop.
- The desktop "Update downloaded" link and upstream's update popover open Tangent's release pages.
- The iOS app's own version is the App Store version and does not change between releases, so the
  iOS release workflow writes the release into
  `apps/mobile/src/features/release-notes/release-version.json` before it bundles.
  `tangent-sync.ts publish` passes the same version it gives the macOS release. The file is not
  part of the native fingerprint, so stamping never forces a native build.
- A build the workflow did not stamp (development, a local `eas build`, a manual dispatch without
  a version, or a publish retried while the macOS release is still building) shows no notice and
  keeps the last remembered release. The next stamped build then lists everything in between.

## Upstream hooks

Fork logic lives in `packages/shared/src/releaseNotes.ts` (update detection, release list parsing
and selection, the GitHub loader), `apps/web/src/lib/releaseNotes.ts`,
`apps/web/src/components/releaseNotes/ReleaseNotesDialog.tsx`,
`apps/web/src/components/sidebar/SidebarReleaseNotesPill.tsx`,
`apps/web/src/components/settings/ReleaseNotesSettingsRow.tsx`, and
`apps/mobile/src/features/release-notes/`. The fork-owned release tooling changes are the
`version` input and stamp step in `.github/workflows/personal-ios-release.yml` and the version
`scripts/tangent-sync.ts` passes to it. Each upstream hook is marked `Tangent(FORK-NOTES-001)`:

- `packages/shared/package.json`: the `./releaseNotes` export.
- `apps/web/src/routes/__root.tsx`: mounts `ReleaseNotesDialog` once.
- `apps/web/src/components/sidebar/SidebarChrome.tsx`: renders the pill in the footer both
  sidebars share.
- `apps/web/src/components/settings/SettingsPanels.tsx` and `settingsSearch.ts`: the About row and
  its search entry.
- `apps/web/src/components/CommandPalette.tsx`: the **Show release notes** action.
- `apps/web/src/components/desktopUpdate.logic.ts`: release URLs use Tangent's repository and tag
  prefix. Its tests, `desktopUpdate.toast.test.tsx`, and `SidebarUpdateReleaseNotes.test.tsx`
  expect `bpdev97/tangent/releases/tag/personal-v<version>`.
- `apps/mobile/src/persistence/mobile-preferences.ts`: the `releaseNotesLastSeenVersion` field and
  its sanitizer.
- `apps/mobile/src/features/home/HomeScreen.tsx`: wraps the thread list's header in
  `ReleaseNotesListHeader`.
- `apps/mobile/src/Stack.tsx` and
  `apps/mobile/src/features/settings/components/settings-sheet-targets.ts`: the
  `SettingsReleaseNotes` screen.
- `apps/mobile/src/features/settings/SettingsAboutRouteScreen.tsx`: the Release notes row.
- `apps/mobile/src/features/files/FileMarkdownPreview.tsx`: exports `useMarkdownPreviewStyles`.

## Resolving conflicts

- Take upstream's file and re-add the one-line mount, row, or route. None of the hooks changes
  upstream behavior.
- If upstream restructures the sidebar footer or the mobile thread list header, put the notice
  wherever the provider update notice or the first list row now lives.
- If upstream renames the markdown styles in `FileMarkdownPreview.tsx`, export whatever the file
  preview itself uses and pass it through in `SettingsReleaseNotesRouteScreen.tsx`.
- `RELEASE_NOTES_REPOSITORY` and `RELEASE_NOTES_TAG_PREFIX` repeat `downstream/config.ts`, because
  mobile code must not import it. `releaseNotes.test.ts` fails when they drift.

## Never

- Never fetch release notes at launch or on a timer; only when the user opens them.
- Never open the notes on their own. The notice waits to be clicked.
- Never retire the notice just because the notes were opened; its release may not be published
  yet.
- Never read the release version from `app.config.ts`, `Constants.expoConfig`, or anything
  `app.config.ts` imports: that puts it in the native fingerprint and every release would need a
  native build.
- Never send a token to GitHub from a client.

## Remove when

Upstream shows release notes after an update on the stable channel, on desktop, web, and mobile,
and lets a distribution point them at its own releases. Keep the `desktopUpdate.logic.ts` URL hook
under the distribution feature if only the links still need it.

## Verify

```sh
vp test run packages/shared/src/releaseNotes.test.ts apps/web/src/components/desktopUpdate.logic.test.ts apps/web/src/components/desktopUpdate.toast.test.tsx apps/web/src/components/sidebar/SidebarUpdateReleaseNotes.test.tsx scripts/lib/tangent-sync.test.ts
```

Plus one pass per client. On web, set `tangent:release-notes:last-seen-version` in local storage
to an older release and reload: the pill appears, opens the notes with the newer releases marked
New, and does not return after a reload. On iOS, put a release in `release-version.json` and an
older `releaseNotesLastSeenVersion` in device preferences, and check the row, the screen, and
Settings → About → Release notes.
