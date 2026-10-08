/**
 * Tangent(FORK-NOTES-001): the web and desktop side of release notes. This
 * browser profile remembers the release it last ran, and every entry point
 * (sidebar notice, Settings, command palette) opens the one dialog mounted at
 * the root. See docs/fork/release-notes.md.
 */
import { resolveReleaseUpdate, type ReleaseUpdate } from "@t3tools/shared/releaseNotes";
import { Atom } from "effect/reactivity";

import { APP_VERSION } from "../branding";
import { appAtomRegistry } from "../rpc/atomRegistry";

const LAST_SEEN_VERSION_STORAGE_KEY = "tangent:release-notes:last-seen-version";

interface ReleaseNotesState {
  /** The update this client started the session on, kept so the notes can mark what is new. */
  readonly update: ReleaseUpdate | null;
  /** Its notes were read, or it was dismissed; the sidebar notice shows until then. */
  readonly acknowledged: boolean;
  readonly open: boolean;
}

function readLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberVersion(version: string): void {
  try {
    localStorage.setItem(LAST_SEEN_VERSION_STORAGE_KEY, version);
  } catch {
    /* Without storage the notice returns next launch; nothing else depends on it. */
  }
}

function initialReleaseNotesState(): ReleaseNotesState {
  const { update, remember } = resolveReleaseUpdate({
    lastSeenVersion: readLastSeenVersion(),
    currentVersion: APP_VERSION,
  });
  if (remember) rememberVersion(remember);
  return { update, acknowledged: update === null, open: false };
}

export const releaseNotesStateAtom = Atom.make(initialReleaseNotesState()).pipe(
  Atom.keepAlive,
  Atom.withLabel("release-notes"),
);

function setOpen(open: boolean): void {
  const state = appAtomRegistry.get(releaseNotesStateAtom);
  appAtomRegistry.set(releaseNotesStateAtom, { ...state, open });
}

export function openReleaseNotes(): void {
  setOpen(true);
}

export function closeReleaseNotes(): void {
  setOpen(false);
}

/**
 * Retires the sidebar notice: the notes for the update were shown, or the user
 * dismissed it. Opening the notes is not enough, because an update can arrive
 * before its release is published.
 */
export function acknowledgeReleaseUpdate(): void {
  const state = appAtomRegistry.get(releaseNotesStateAtom);
  if (state.acknowledged) return;
  rememberVersion(APP_VERSION);
  appAtomRegistry.set(releaseNotesStateAtom, { ...state, acknowledged: true });
}
