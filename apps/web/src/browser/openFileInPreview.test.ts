import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import type { PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resetPreviewStateForTests } from "~/previewStateStore";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

import { openUrlInPreviewSession } from "./openFileInPreview";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};

const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-linear",
  navStatus: {
    _tag: "Loading",
    url: "https://linear.review/bpdev97/tangent/pull/52",
    title: "",
  },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-08-08T20:00:00.000Z",
};

beforeEach(() => {
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
    browserDefaultProfileId: "work",
  });
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("openUrlInPreviewSession", () => {
  it("opens a Linear browser surface with its dedicated presentation", async () => {
    const presentation = {
      _tag: "linear",
      reviewUrl: "https://linear.review/bpdev97/tangent/pull/52",
      tickets: [],
      ticketLookup: "loading",
    } as const;
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot));

    const result = await openUrlInPreviewSession({
      threadRef,
      url: presentation.reviewUrl,
      openPreview,
      presentation,
    });

    expect(result._tag).toBe("Success");
    expect(openPreview).toHaveBeenCalledWith({
      environmentId: "local",
      input: {
        threadId: "thread-1",
        url: "https://linear.review/bpdev97/tangent/pull/52",
        profileId: "work",
        viewport: { _tag: "fill" },
      },
    });
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, threadRef),
    ).toMatchObject({
      id: "browser:tab-linear",
      kind: "preview",
      resourceId: "tab-linear",
      presentation,
    });
  });
});
