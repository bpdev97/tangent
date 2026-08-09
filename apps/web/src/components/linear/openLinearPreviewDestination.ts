import type { ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { type OpenPreviewMutation, openUrlInPreviewSession } from "~/browser/openFileInPreview";
import { readThreadPreviewState, setActivePreviewTab } from "~/previewStateStore";
import {
  type LinearPreviewPresentation,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "~/rightPanelStore";

import { isActiveLinearDestination } from "./linearPreviewPresentation";

function findDestinationTab(threadRef: ScopedThreadRef, destinationUrl: string) {
  const previewState = readThreadPreviewState(threadRef);
  const panelState = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  for (const surface of panelState.surfaces) {
    if (surface.kind !== "preview" || surface.resourceId === null) continue;
    if (surface.presentation?._tag !== "linear") continue;
    const snapshot = previewState.sessions[surface.resourceId];
    if (!snapshot) continue;
    const currentUrl = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
    if (
      (surface.presentation.destinationUrl !== undefined &&
        isActiveLinearDestination(surface.presentation.destinationUrl, destinationUrl)) ||
      (currentUrl !== null && isActiveLinearDestination(currentUrl, destinationUrl))
    ) {
      return snapshot;
    }
  }
  return null;
}

export async function openLinearPreviewDestination<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly destinationUrl: string;
  readonly presentation: LinearPreviewPresentation;
  readonly openPreview: OpenPreviewMutation<E>;
}) {
  const presentation = { ...input.presentation, destinationUrl: input.destinationUrl };
  const existing = findDestinationTab(input.threadRef, input.destinationUrl);
  if (existing) {
    const panel = useRightPanelStore.getState();
    panel.setBrowserPresentation(input.threadRef, existing.tabId, presentation);
    panel.activateSurface(input.threadRef, `browser:${existing.tabId}`);
    setActivePreviewTab(input.threadRef, existing.tabId);
    return AsyncResult.success(existing);
  }

  return openUrlInPreviewSession({
    threadRef: input.threadRef,
    url: input.destinationUrl,
    openPreview: input.openPreview,
    presentation,
  });
}
