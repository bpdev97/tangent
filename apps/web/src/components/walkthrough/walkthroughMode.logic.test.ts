// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  walkthroughIsStale,
  walkthroughMatchesSelection,
  walkthroughNavigationLeaves,
} from "./walkthroughMode.logic";

const run1 = RunId.make("run-1");
const run2 = RunId.make("run-2");
const paths = new Set(["a.ts"]);

describe("walkthroughMatchesSelection", () => {
  it("matches the turn or the exact base, treating an unnamed base as automatic", () => {
    expect(
      walkthroughMatchesSelection(
        { kind: "turn", turnId: run1 },
        { kind: "turn", turnId: run1, filePath: null, revealRequestId: 1 },
      ),
    ).toBe(true);
    expect(
      walkthroughMatchesSelection(
        { kind: "turn", turnId: run1 },
        { kind: "turn", turnId: run2, filePath: null, revealRequestId: 1 },
      ),
    ).toBe(false);
    expect(walkthroughMatchesSelection({ kind: "branch" }, { kind: "branch", baseRef: null })).toBe(
      true,
    );
    expect(
      walkthroughMatchesSelection({ kind: "branch" }, { kind: "branch", baseRef: "main" }),
    ).toBe(false);
    expect(
      walkthroughMatchesSelection(
        { kind: "branch", baseRef: "main" },
        { kind: "branch", baseRef: "main" },
      ),
    ).toBe(true);
    expect(walkthroughMatchesSelection({ kind: "branch" }, { kind: "unstaged" })).toBe(false);
  });
});

describe("walkthroughNavigationLeaves", () => {
  const scope = { kind: "turn", turnId: run1 } as const;
  const base = {
    scope,
    sectionPaths: paths,
    awaitingTurn: false,
    awaitedTurnAvailable: false,
    latestTurnId: run1,
  };

  it("leaves when the reader picks another diff or asks for a file outside the section", () => {
    const selection = { kind: "turn", turnId: run1, filePath: null, revealRequestId: 1 } as const;
    expect(walkthroughNavigationLeaves({ ...base, selection, requestedFile: null })).toBe(false);
    expect(walkthroughNavigationLeaves({ ...base, selection, requestedFile: "a.ts" })).toBe(false);
    expect(walkthroughNavigationLeaves({ ...base, selection, requestedFile: "b.ts" })).toBe(true);
    expect(
      walkthroughNavigationLeaves({
        ...base,
        scope: { kind: "branch" },
        selection: { kind: "unstaged" },
        requestedFile: null,
      }),
    ).toBe(true);
  });

  it("keeps a file selection retained from an earlier request", () => {
    // The selection still names a.ts from a previous link; moving to a
    // section without it is not a new navigation.
    expect(
      walkthroughNavigationLeaves({
        ...base,
        selection: { kind: "turn", turnId: run1, filePath: "a.ts", revealRequestId: 2 },
        sectionPaths: new Set(["c.ts"]),
        requestedFile: null,
      }),
    ).toBe(false);
  });

  it("tolerates only the checkpoint fallback while waiting for the turn", () => {
    const waiting = { ...base, scope: { kind: "turn", turnId: run2 } as const, awaitingTurn: true };
    // The panel fell back to the latest turn, or kept the requested one with no turns yet.
    expect(
      walkthroughNavigationLeaves({
        ...waiting,
        selection: { kind: "turn", turnId: run1, filePath: null, revealRequestId: 1 },
        requestedFile: null,
      }),
    ).toBe(false);
    expect(
      walkthroughNavigationLeaves({
        ...waiting,
        latestTurnId: null,
        selection: { kind: "turn", turnId: run2, filePath: null, revealRequestId: 1 },
        requestedFile: null,
      }),
    ).toBe(false);
    // The checkpoint just landed: the latest turn is the awaited one while the
    // selection still shows the fallback, until the handoff selects it.
    expect(
      walkthroughNavigationLeaves({
        ...waiting,
        awaitedTurnAvailable: true,
        latestTurnId: run2,
        selection: { kind: "turn", turnId: run1, filePath: null, revealRequestId: 1 },
        requestedFile: null,
      }),
    ).toBe(false);
    // The reader chose Uncommitted, an older turn, or a file link meanwhile.
    expect(
      walkthroughNavigationLeaves({
        ...waiting,
        selection: { kind: "unstaged" },
        requestedFile: null,
      }),
    ).toBe(true);
    expect(
      walkthroughNavigationLeaves({
        ...waiting,
        latestTurnId: RunId.make("run-0"),
        selection: { kind: "turn", turnId: run1, filePath: null, revealRequestId: 1 },
        requestedFile: null,
      }),
    ).toBe(true);
    expect(
      walkthroughNavigationLeaves({
        ...waiting,
        selection: { kind: "turn", turnId: run1, filePath: "a.ts", revealRequestId: 2 },
        requestedFile: "a.ts",
      }),
    ).toBe(true);
  });
});

describe("walkthroughIsStale", () => {
  const turns = [
    { runId: run2, completedAt: "2026-10-08T10:05:00.000Z" },
    { runId: run1, completedAt: "2026-10-08T10:00:00.000Z" },
  ];

  it("is fresh while the publishing turn is still the newest work", () => {
    expect(
      walkthroughIsStale({ sourceRunId: run2, publishedAt: "2026-10-08T10:03:00.000Z", turns }),
    ).toBe(false);
    // Published during run2, before run2 completed: run1 is the latest checkpoint.
    expect(
      walkthroughIsStale({
        sourceRunId: run2,
        publishedAt: "2026-10-08T10:03:00.000Z",
        turns: turns.slice(1),
      }),
    ).toBe(false);
  });

  it("goes stale once another turn completes after publishing", () => {
    expect(
      walkthroughIsStale({ sourceRunId: run1, publishedAt: "2026-10-08T10:01:00.000Z", turns }),
    ).toBe(true);
    expect(
      walkthroughIsStale({ sourceRunId: null, publishedAt: "2026-10-08T10:01:00.000Z", turns }),
    ).toBe(true);
  });

  it("falls back to turn order when the publish time is unknown", () => {
    expect(walkthroughIsStale({ sourceRunId: run1, publishedAt: undefined, turns })).toBe(true);
    expect(walkthroughIsStale({ sourceRunId: run2, publishedAt: undefined, turns })).toBe(false);
    expect(walkthroughIsStale({ sourceRunId: null, publishedAt: undefined, turns })).toBe(false);
  });
});
