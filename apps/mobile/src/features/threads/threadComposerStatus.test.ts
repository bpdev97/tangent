import { describe, expect, it } from "@effect/vitest";

import { projectThreadComposerStatus } from "./threadComposerStatus";

describe("thread composer status", () => {
  it("presents transient retries as recovery instead of a terminal failure", () => {
    expect(
      projectThreadComposerStatus({
        connectionError: "Socket closed.",
        connectionState: "reconnecting",
        environmentLabel: "Mac mini",
      }),
    ).toEqual({
      kind: "reconnecting",
      label: "Reconnecting to Mac mini...",
    });
  });

  it("keeps the failure reason for a terminal connection error", () => {
    expect(
      projectThreadComposerStatus({
        connectionError: "Authentication expired.",
        connectionState: "error",
        environmentLabel: "Mac mini",
      }),
    ).toEqual({
      kind: "unavailable",
      label: "Failed to connect to Mac mini: Authentication expired.",
    });
  });

  it("reports an uncached connected thread as loading", () => {
    expect(
      projectThreadComposerStatus({
        connectionError: null,
        connectionState: "connected",
        environmentLabel: "Mac mini",
        threadSyncPhase: "loading",
      }),
    ).toEqual({
      kind: "syncing",
      label: "Loading messages...",
    });
  });
});
