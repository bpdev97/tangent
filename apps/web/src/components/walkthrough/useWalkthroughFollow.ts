// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import {
  followWalkthrough,
  selectActiveWalkthrough,
  useWalkthroughStore,
} from "~/walkthroughStore";

import type { MessagesTimelineRow } from "../chat/MessagesTimeline.logic";

/**
 * When the agent republishes the walkthrough a reader has open, move them
 * onto the new one at the same section instead of leaving the old card's
 * sections, which the new diff may no longer match, in the panel.
 */
export function useWalkthroughFollow(
  threadRef: ScopedThreadRef | null,
  rows: ReadonlyArray<MessagesTimelineRow>,
) {
  const activeId = useWalkthroughStore(
    (state) => selectActiveWalkthrough(state.byThreadKey, threadRef)?.walkthrough.id ?? null,
  );
  useEffect(() => {
    if (!threadRef || activeId === null) return;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.kind === "walkthrough" && row.walkthrough.replaces === activeId) {
        followWalkthrough(threadRef, { id: row.id, runId: row.runId }, row.walkthrough);
        return;
      }
    }
  }, [activeId, rows, threadRef]);
}
