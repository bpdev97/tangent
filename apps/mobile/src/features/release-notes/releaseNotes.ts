/**
 * Tangent(FORK-NOTES-001): the mobile side of release notes. The device
 * remembers the release it last ran in its preferences, and both entry points
 * (the row above the thread list and Settings → About) open one settings
 * screen. See docs/fork/release-notes.md.
 */
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { resolveReleaseUpdate, type ReleaseUpdate } from "@t3tools/shared/releaseNotes";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import releaseStamp from "./release-version.json";

/**
 * The Tangent release this bundle was built for. The app's own version is the
 * App Store version and never changes between releases, so the iOS release
 * workflow writes the release into release-version.json before it bundles.
 * Null in development and in any build that workflow did not stamp.
 */
export const MOBILE_RELEASE_VERSION: string | null = (
  releaseStamp as { readonly version: string | null }
).version;

/** The update this launch found, kept after it is acknowledged so the notes can mark what is new. */
export const sessionReleaseUpdateAtom = Atom.make<ReleaseUpdate | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:release-notes:session-update"),
);

const NO_UPDATE = { update: null, remember: null } as const;

/**
 * The update the device has not acknowledged yet, once preferences have
 * loaded. A first run and a downgrade are remembered here without a notice.
 */
export function useReleaseUpdate(): {
  readonly update: ReleaseUpdate | null;
  readonly acknowledge: () => void;
} {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const setSessionUpdate = useAtomSet(sessionReleaseUpdateAtom);
  const loaded = AsyncResult.isSuccess(preferences);
  const lastSeenVersion = loaded ? preferences.value.releaseNotesLastSeenVersion : undefined;
  const { update, remember } = useMemo(
    () =>
      loaded
        ? resolveReleaseUpdate({ lastSeenVersion, currentVersion: MOBILE_RELEASE_VERSION })
        : NO_UPDATE,
    [lastSeenVersion, loaded],
  );

  useEffect(() => {
    if (remember) savePreferences({ releaseNotesLastSeenVersion: remember });
  }, [remember, savePreferences]);

  const acknowledge = useCallback(() => {
    if (!update) return;
    setSessionUpdate(update);
    savePreferences({ releaseNotesLastSeenVersion: update.to });
  }, [savePreferences, setSessionUpdate, update]);

  return { update, acknowledge };
}
