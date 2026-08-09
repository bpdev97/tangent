import type { PreviewOpenInput, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import { openLinearPreviewDestination } from "./openLinearPreviewDestination";

const threadRef = {
  environmentId: "local",
  threadId: "thread-1",
} as ScopedThreadRef;
const reviewUrl = "https://linear.review/bpdev97/tangent/pull/52";
const ticketUrl = "https://linear.app/tangent/issue/TAN-42/native-ticket-opening";
const presentation = {
  _tag: "linear" as const,
  reviewUrl,
  tickets: [
    {
      id: "issue-1",
      identifier: "TAN-42",
      title: "Native ticket opening",
      url: ticketUrl,
    },
  ],
  ticketLookup: "ready" as const,
};

function snapshot(tabId: string, url: string): PreviewSessionSnapshot {
  return {
    threadId: threadRef.threadId,
    tabId,
    navStatus: { _tag: "Success", url, title: "Linear" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-08-08T00:00:00.000Z",
  };
}

beforeEach(() => {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("openLinearPreviewDestination", () => {
  it("reactivates an existing live Linear destination", async () => {
    const review = snapshot("tab-review", reviewUrl);
    const ticket = snapshot("tab-ticket", ticketUrl);
    applyPreviewServerSnapshot(threadRef, review);
    applyPreviewServerSnapshot(threadRef, ticket);
    useRightPanelStore
      .getState()
      .openBrowser(threadRef, review.tabId, { ...presentation, destinationUrl: reviewUrl });
    useRightPanelStore
      .getState()
      .openBrowser(threadRef, ticket.tabId, { ...presentation, destinationUrl: ticketUrl });
    const openPreview = vi.fn();

    const result = await openLinearPreviewDestination({
      threadRef,
      destinationUrl: reviewUrl,
      presentation,
      openPreview,
    });

    expect(result).toEqual(AsyncResult.success(review));
    expect(openPreview).not.toHaveBeenCalled();
    expect(readThreadPreviewState(threadRef).activeTabId).toBe(review.tabId);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef)
        .activeSurfaceId,
    ).toBe("browser:tab-review");
  });

  it("opens a separate browser tab for a new Linear destination", async () => {
    const review = snapshot("tab-review", reviewUrl);
    const ticket = snapshot("tab-ticket", ticketUrl);
    applyPreviewServerSnapshot(threadRef, review);
    useRightPanelStore
      .getState()
      .openBrowser(threadRef, review.tabId, { ...presentation, destinationUrl: reviewUrl });
    const openPreview = vi.fn(async (_input: PreviewOpenInput) => AsyncResult.success(ticket));

    await openLinearPreviewDestination({
      threadRef,
      destinationUrl: ticketUrl,
      presentation,
      openPreview: ({ input }) => openPreview(input),
    });

    expect(openPreview).toHaveBeenCalledExactlyOnceWith({
      threadId: threadRef.threadId,
      url: ticketUrl,
    });
    expect(
      selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        threadRef,
      ).surfaces.map((surface) => surface.id),
    ).toEqual(["browser:tab-review", "browser:tab-ticket"]);
  });
});
