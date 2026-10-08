// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { WalkthroughScope } from "@t3tools/shared/walkthrough";

import type { DiffPanelSelection } from "~/diffPanelStore";

/** A turn the diff panel can show, with when it completed. */
export interface WalkthroughTurn {
  readonly runId: string;
  readonly completedAt: string;
}

/**
 * Whether the panel shows the diff a walkthrough was written against. A
 * walkthrough written against one base must not narrow a diff against
 * another; an automatic base (null) only matches a walkthrough that named none.
 */
export function walkthroughMatchesSelection(
  scope: WalkthroughScope,
  selection: DiffPanelSelection,
): boolean {
  return scope.kind === "turn"
    ? selection.kind === "turn" && scope.turnId === selection.turnId
    : selection.kind === "branch" && (scope.baseRef ?? null) === selection.baseRef;
}

/**
 * Whether an ordinary diff navigation has moved the reader off the
 * walkthrough: another diff, or a file the section does not cover asked for
 * by a changed-files link (`requestedFile`, set only for a new request).
 * While the walkthrough waits for its turn's checkpoint the panel shows the
 * latest turn in its place, or keeps the requested turn when there is none;
 * that fallback is not leaving, but any other selection is.
 */
export function walkthroughNavigationLeaves(input: {
  readonly scope: WalkthroughScope;
  readonly selection: DiffPanelSelection;
  readonly sectionPaths: ReadonlySet<string>;
  readonly awaitingTurn: boolean;
  /** The awaited turn's checkpoint has arrived; the panel is about to select it. */
  readonly awaitedTurnAvailable: boolean;
  readonly latestTurnId: string | null;
  readonly requestedFile: string | null;
}): boolean {
  const {
    scope,
    selection,
    sectionPaths,
    awaitingTurn,
    awaitedTurnAvailable,
    latestTurnId,
    requestedFile,
  } = input;
  if (awaitingTurn) {
    // In the render where the checkpoint lands, the selection still shows the
    // fallback while the latest turn is already the awaited one; the handoff
    // selects it next, so nothing is judged until then.
    if (awaitedTurnAvailable) return false;
    const fallback =
      selection.kind === "turn" &&
      requestedFile === null &&
      ((scope.kind === "turn" && selection.turnId === scope.turnId) ||
        selection.turnId === latestTurnId);
    return !fallback;
  }
  if (!walkthroughMatchesSelection(scope, selection)) return true;
  return requestedFile !== null && !sectionPaths.has(requestedFile);
}

/**
 * Whether the agent has completed a turn after publishing, so the sections
 * may describe code that has since changed. The publishing turn itself does
 * not count, nor do turns that completed before the walkthrough was written:
 * those are the normal interval before the publishing turn finishes.
 */
export function walkthroughIsStale(input: {
  readonly sourceRunId: string | null;
  readonly publishedAt: string | undefined;
  /** Latest first. */
  readonly turns: ReadonlyArray<WalkthroughTurn>;
}): boolean {
  const { sourceRunId, publishedAt, turns } = input;
  const publishedTime = publishedAt === undefined ? Number.NaN : Date.parse(publishedAt);
  if (!Number.isNaN(publishedTime)) {
    return turns.some(
      (turn) => turn.runId !== sourceRunId && Date.parse(turn.completedAt) > publishedTime,
    );
  }
  if (sourceRunId === null) return false;
  const index = turns.findIndex((turn) => turn.runId === sourceRunId);
  return index > 0;
}
