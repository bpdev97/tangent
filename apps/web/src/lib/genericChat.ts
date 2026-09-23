/**
 * Tangent(FORK-CHAT-001): web capability rules for chats with no user project.
 *
 * Chat threads keep the terminal, browser, and devices, but not the files,
 * diffs, Git, and pull requests that assume a user project. Capability comes
 * from the thread's reserved project ID, never from the project catalog, so a
 * late catalog cannot briefly enable project tools. See docs/fork/generic-chat.md.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { isGenericChatThread } from "@t3tools/shared/genericChat";
import { useLayoutEffect } from "react";

import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../rightPanelStore";

/** Right-panel surfaces that need a user project. Attachments are thread content. */
function isProjectOnlyRightPanelSurface(surface: RightPanelSurface): boolean {
  switch (surface.kind) {
    case "diff":
    case "files":
    case "pull-request":
    case "pull-requests":
      return true;
    case "file":
      return surface.attachment === undefined;
    case "terminal":
    case "preview":
    case "device":
      return false;
  }
}

/** Surfaces a thread may keep open; normal project threads keep everything. */
export function allowedRightPanelSurfaces(
  thread: { readonly projectId: string } | null | undefined,
  surfaces: ReadonlyArray<RightPanelSurface>,
): ReadonlyArray<RightPanelSurface> {
  return isGenericChatThread(thread)
    ? surfaces.filter((surface) => !isProjectOnlyRightPanelSurface(surface))
    : surfaces;
}

/**
 * Closes project-only surfaces in a chat thread before they paint, whichever
 * entry point opened them: keyboard shortcuts, the command palette, links in
 * the transcript, or panel state persisted from an earlier session.
 */
export function useGenericChatRightPanelGuard(
  threadRef: ScopedThreadRef | null,
  thread: { readonly projectId: string } | null | undefined,
) {
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const genericChat = isGenericChatThread(thread);
  useLayoutEffect(() => {
    if (!genericChat || threadRef === null) return;
    const allowed = allowedRightPanelSurfaces(thread, surfaces);
    if (allowed.length === surfaces.length) return;
    const store = useRightPanelStore.getState();
    for (const surface of surfaces) {
      if (!allowed.includes(surface)) store.closeSurface(threadRef, surface.id);
    }
  }, [genericChat, surfaces, thread, threadRef]);
}
