// Tangent(FORK-SLIDES-001): a rebuilt deck loads behind the one on screen and replaces it when ready.
import { createContext, use, useEffect, useRef } from "react";

/** One mounted copy of the document. `id` keeps it mounted when it moves from hidden to shown. */
export interface DeckVersion {
  readonly id: number;
  readonly revision: string | null;
  /** Painted at the slide the user is on, so showing it cannot flash. */
  readonly ready: boolean;
}

export interface DeckVersions {
  readonly shown: DeckVersion;
  /** The newer version loading behind `shown`. */
  readonly next: DeckVersion | null;
  /** The newest revision that failed or is slow to load, while `shown` stays up. */
  readonly rejected: string | null;
  /** `shown` could not open, so there is nothing worth keeping on screen. */
  readonly shownFailed: boolean;
}

/** Stands in for a revision when the file cannot be reached: it is gone, or the host is. */
export const UNAVAILABLE_REVISION = "unavailable";

export const INITIAL_DECK_VERSIONS: DeckVersions = {
  shown: { id: 0, revision: null, ready: true },
  next: null,
  rejected: null,
  shownFailed: false,
};

/**
 * Applies the file's latest revision. `swaps` is false for documents that cannot report being
 * ready, which replace the shown copy outright.
 */
export function observeRevision(
  versions: DeckVersions,
  revision: string,
  swaps: boolean,
): DeckVersions {
  const { shown, next, rejected } = versions;
  // The shown copy was minted alongside this first revision, so there is nothing to reload.
  if (shown.revision === null) return { ...versions, shown: { ...shown, revision } };
  if (revision === shown.revision) {
    return next === null && rejected === null
      ? versions
      : { ...versions, next: null, rejected: null };
  }
  if (revision === (next?.revision ?? null) || revision === rejected) return versions;
  const id = Math.max(shown.id, next?.id ?? 0) + 1;
  const version = { id, revision, ready: false };
  // Whatever is on screen beats a copy that could not load either, even while disconnected.
  if (revision === UNAVAILABLE_REVISION) {
    return versions.shownFailed ? versions : { ...versions, next: null, rejected: revision };
  }
  if (!swaps || versions.shownFailed) {
    return { shown: { ...version, ready: true }, next: null, rejected: null, shownFailed: false };
  }
  return { ...versions, next: version, rejected: null };
}

export function markVersionReady(versions: DeckVersions, id: number): DeckVersions {
  const { next } = versions;
  return next?.id === id && !next.ready
    ? { ...versions, next: { ...next, ready: true } }
    : versions;
}

export function markVersionFailed(versions: DeckVersions, id: number): DeckVersions {
  if (versions.shown.id === id && !versions.shownFailed) {
    return { ...versions, shownFailed: true };
  }
  const { next } = versions;
  return next?.id === id ? { ...versions, next: null, rejected: next.revision } : versions;
}

/** The shown copy's Retry worked, so it is worth keeping on screen again. */
export function markVersionRecovered(versions: DeckVersions, id: number): DeckVersions {
  return versions.shown.id === id && versions.shownFailed
    ? { ...versions, shownFailed: false }
    : versions;
}

/** Keeps loading, so a version that was only slow still replaces the shown one. */
export function markVersionStalled(versions: DeckVersions, id: number): DeckVersions {
  const { next } = versions;
  return next?.id === id ? { ...versions, rejected: next.revision } : versions;
}

/** Shows the waiting version once it is ready. */
export function showReadyVersion(versions: DeckVersions): DeckVersions {
  const { next } = versions;
  return next?.ready ? { shown: next, next: null, rejected: null, shownFailed: false } : versions;
}

/** What a mounted copy of the document tells the swap, and whether it is the hidden one. */
export interface DeckVersionSlot {
  readonly hidden: boolean;
  readonly onReady: () => void;
  readonly onFailed: () => void;
  readonly onRecovered: () => void;
}

export const DeckVersionContext = createContext<DeckVersionSlot | null>(null);

export function useDeckVersionSlot() {
  return use(DeckVersionContext);
}

/** Lets a viewer report that this copy could not open, or that its Retry worked. */
export function useDeckVersionFailure(error: string | null) {
  const slot = useDeckVersionSlot();
  const reported = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Tell the swap outside this viewer that this copy failed or recovered, once it has rendered that state.
  useEffect(() => {
    if (error !== null) slot?.onFailed();
    else if (reported.current) slot?.onRecovered();
    reported.current = error !== null;
  }, [error, slot]);
}
