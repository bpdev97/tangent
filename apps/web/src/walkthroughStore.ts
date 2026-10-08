// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { RunId, ScopedThreadRef } from "@t3tools/contracts";
import type { WalkthroughReference } from "@t3tools/shared/walkthrough";
import { create } from "zustand";

import { useDiffPanelStore } from "./diffPanelStore";

/** A line the panel should scroll to once the section's files are in the viewer. */
export interface WalkthroughReveal {
  readonly path: string;
  readonly line?: number;
  /** Changes on every request so the same line can be revealed twice. */
  readonly requestId: number;
}

/**
 * Which walkthrough the diff panel is currently reading for a thread, and
 * which of its sections. Session-only on purpose: a walkthrough belongs to the
 * card that published it, and reopening the panel from anywhere else shows the
 * plain diff again.
 */
export interface ActiveWalkthrough {
  /** The timeline entry that published it, so the card can show itself as open. */
  readonly sourceId: string;
  /** The turn that published it; a later turn means the code may have moved on. */
  readonly sourceRunId: string | null;
  readonly walkthrough: WalkthroughReference;
  readonly sectionIndex: number;
  readonly reveal: WalkthroughReveal | null;
  /**
   * A turn walkthrough can be published before the turn's checkpoint exists,
   * when the diff panel cannot show the turn yet. True until the panel has
   * selected the turn once; after that the reader's own selection wins.
   */
  readonly awaitingTurn: boolean;
  /**
   * The diff panel's file request (its turn selection's reveal request id) the
   * reader had when the walkthrough opened or was last judged, so a later
   * changed-files link counts as navigation exactly once, even when the panel
   * was closed and remounts to serve it. Null until the first observation.
   */
  readonly seenFileRequestId: number | null;
}

interface WalkthroughSource {
  readonly id: string;
  readonly runId: string | null;
}

interface WalkthroughStoreState {
  byThreadKey: Record<string, ActiveWalkthrough>;
  open: (
    ref: ScopedThreadRef,
    source: WalkthroughSource,
    walkthrough: WalkthroughReference,
    sectionIndex: number,
    reveal?: { readonly path: string; readonly line?: number },
  ) => void;
  /** Moves the reader onto a walkthrough that replaces the one they have open, keeping their place. */
  follow: (
    ref: ScopedThreadRef,
    source: WalkthroughSource,
    replacement: WalkthroughReference,
  ) => void;
  setSection: (ref: ScopedThreadRef, sectionIndex: number) => void;
  /** The diff panel has shown the walkthrough's turn; stop steering the selection. */
  settleTurn: (ref: ScopedThreadRef) => void;
  /** Records the diff panel's file request the reader has been shown. */
  markFileRequest: (ref: ScopedThreadRef, requestId: number) => void;
  /** Clears a reveal the panel has acted on, so a re-render does not scroll again. */
  consumeReveal: (ref: ScopedThreadRef, requestId: number) => void;
  close: (ref: ScopedThreadRef) => void;
}

let revealSequence = 0;

export const useWalkthroughStore = create<WalkthroughStoreState>()((set) => ({
  byThreadKey: {},
  open: (ref, source, walkthrough, sectionIndex, reveal) =>
    set((state) => ({
      byThreadKey: {
        ...state.byThreadKey,
        [scopedThreadKey(ref)]: {
          sourceId: source.id,
          sourceRunId: source.runId,
          walkthrough,
          sectionIndex: clampSection(walkthrough, sectionIndex),
          reveal: reveal ? { ...reveal, requestId: ++revealSequence } : null,
          awaitingTurn: walkthrough.scope.kind === "turn",
          seenFileRequestId: null,
        },
      },
    })),
  follow: (ref, source, replacement) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const active = state.byThreadKey[key];
      if (!active || replacement.replaces !== active.walkthrough.id) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [key]: {
            sourceId: source.id,
            sourceRunId: source.runId,
            walkthrough: replacement,
            sectionIndex: clampSection(replacement, active.sectionIndex),
            reveal: null,
            awaitingTurn: replacement.scope.kind === "turn",
            seenFileRequestId: null,
          },
        },
      };
    }),
  settleTurn: (ref) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const active = state.byThreadKey[key];
      if (!active?.awaitingTurn) return state;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...active, awaitingTurn: false } } };
    }),
  markFileRequest: (ref, requestId) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const active = state.byThreadKey[key];
      if (!active || active.seenFileRequestId === requestId) return state;
      return {
        byThreadKey: { ...state.byThreadKey, [key]: { ...active, seenFileRequestId: requestId } },
      };
    }),
  setSection: (ref, sectionIndex) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const active = state.byThreadKey[key];
      if (!active) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [key]: {
            ...active,
            sectionIndex: clampSection(active.walkthrough, sectionIndex),
            reveal: null,
          },
        },
      };
    }),
  consumeReveal: (ref, requestId) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      const active = state.byThreadKey[key];
      if (!active || active.reveal?.requestId !== requestId) return state;
      return { byThreadKey: { ...state.byThreadKey, [key]: { ...active, reveal: null } } };
    }),
  close: (ref) =>
    set((state) => {
      const key = scopedThreadKey(ref);
      if (!(key in state.byThreadKey)) return state;
      const { [key]: _closed, ...rest } = state.byThreadKey;
      return { byThreadKey: rest };
    }),
}));

function clampSection(walkthrough: WalkthroughReference, index: number) {
  return Math.max(0, Math.min(walkthrough.sections.length - 1, index));
}

/** Points the diff panel at the diff a walkthrough was written against. */
function selectWalkthroughDiff(ref: ScopedThreadRef, walkthrough: WalkthroughReference) {
  const diffPanel = useDiffPanelStore.getState();
  if (walkthrough.scope.kind === "turn") {
    diffPanel.selectTurn(ref, walkthrough.scope.turnId as RunId);
    return;
  }
  // An unnamed base means the automatic one, which is a null base ref here;
  // leaving a previous explicit base in place would show a different diff.
  diffPanel.selectGitScope(ref, "branch");
  diffPanel.selectBranchBaseRef(ref, walkthrough.scope.baseRef ?? null);
}

/** The diff panel's current file request for a thread; zero outside a turn selection. */
function currentFileRequestId(ref: ScopedThreadRef): number {
  const selection = useDiffPanelStore.getState().byThreadKey[scopedThreadKey(ref)];
  return selection?.kind === "turn" ? selection.revealRequestId : 0;
}

/** Opens a walkthrough for reading and shows its diff; the caller opens the panel. */
export function openWalkthrough(
  ref: ScopedThreadRef,
  source: WalkthroughSource,
  walkthrough: WalkthroughReference,
  sectionIndex: number,
  reveal?: { readonly path: string; readonly line?: number },
) {
  const store = useWalkthroughStore.getState();
  store.open(ref, source, walkthrough, sectionIndex, reveal);
  selectWalkthroughDiff(ref, walkthrough);
  store.markFileRequest(ref, currentFileRequestId(ref));
}

/** Moves a reader onto the walkthrough that replaces their open one, if any. */
export function followWalkthrough(
  ref: ScopedThreadRef,
  source: WalkthroughSource,
  replacement: WalkthroughReference,
) {
  const store = useWalkthroughStore.getState();
  const before = selectActiveWalkthrough(store.byThreadKey, ref);
  store.follow(ref, source, replacement);
  const after = selectActiveWalkthrough(useWalkthroughStore.getState().byThreadKey, ref);
  if (after !== null && after !== before) {
    selectWalkthroughDiff(ref, replacement);
    store.markFileRequest(ref, currentFileRequestId(ref));
  }
}

/**
 * Identity of the section being read, or "" outside a walkthrough. The diff
 * panel keys its viewer on it so a section change remounts the viewer: a
 * comment draft on a file the next section does not show would otherwise
 * stay open invisibly and keep the gutter disabled.
 */
export function walkthroughSectionKey(active: ActiveWalkthrough | null): string {
  return active ? `${active.walkthrough.id}:${active.sectionIndex}` : "";
}

export function useWalkthroughSectionKey(ref: ScopedThreadRef | null | undefined): string {
  return useWalkthroughStore((state) =>
    walkthroughSectionKey(selectActiveWalkthrough(state.byThreadKey, ref)),
  );
}

export function selectActiveWalkthrough(
  byThreadKey: Record<string, ActiveWalkthrough>,
  ref: ScopedThreadRef | null | undefined,
): ActiveWalkthrough | null {
  return ref ? (byThreadKey[scopedThreadKey(ref)] ?? null) : null;
}
