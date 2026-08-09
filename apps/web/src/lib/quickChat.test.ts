import { describe, expect, it } from "vite-plus/test";

import { GENERIC_CHAT_PROJECT_ID } from "@t3tools/shared/genericChat";
import { resolveQuickChatTarget } from "./quickChat";

const NOW = Date.parse("2026-08-09T15:05:00.000Z");
const chat = {
  environmentId: "mac-mini",
  id: "chat-1",
  projectId: GENERIC_CHAT_PROJECT_ID,
  archivedAt: null,
  settledOverride: null,
};

describe("resolveQuickChatTarget", () => {
  it("resumes the most recently viewed generic chat inside the configured window", () => {
    expect(
      resolveQuickChatTarget({
        lastVisit: {
          environmentId: "mac-mini",
          threadId: "chat-1",
          visitedAt: "2026-08-09T15:01:00.000Z",
        },
        resumeMinutes: 5,
        threads: [chat],
        nowMs: NOW,
      }),
    ).toEqual({ kind: "resume", environmentId: "mac-mini", threadId: "chat-1" });
  });

  it("starts fresh when the visit is stale or resuming is disabled", () => {
    const lastVisit = {
      environmentId: "mac-mini",
      threadId: "chat-1",
      visitedAt: "2026-08-09T14:59:59.000Z",
    };

    expect(
      resolveQuickChatTarget({ lastVisit, resumeMinutes: 5, threads: [chat], nowMs: NOW }),
    ).toEqual({ kind: "new" });
    expect(
      resolveQuickChatTarget({ lastVisit, resumeMinutes: null, threads: [chat], nowMs: NOW }),
    ).toEqual({ kind: "new" });
  });

  it("never resumes a missing, archived, settled, or project-bound thread", () => {
    const lastVisit = {
      environmentId: "mac-mini",
      threadId: "chat-1",
      visitedAt: "2026-08-09T15:04:00.000Z",
    };

    expect(
      resolveQuickChatTarget({
        lastVisit,
        resumeMinutes: 5,
        threads: [{ ...chat, archivedAt: "2026-08-09T15:04:30.000Z" }],
        nowMs: NOW,
      }),
    ).toEqual({ kind: "new" });
    expect(
      resolveQuickChatTarget({
        lastVisit,
        resumeMinutes: 5,
        threads: [{ ...chat, settledOverride: "settled" }],
        nowMs: NOW,
      }),
    ).toEqual({ kind: "new" });
    expect(
      resolveQuickChatTarget({
        lastVisit,
        resumeMinutes: 5,
        threads: [{ ...chat, projectId: "project-1" }],
        nowMs: NOW,
      }),
    ).toEqual({ kind: "new" });
  });
});
