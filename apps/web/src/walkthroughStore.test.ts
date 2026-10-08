// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { WalkthroughReference } from "@t3tools/shared/walkthrough";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useDiffPanelStore } from "./diffPanelStore";
import {
  followWalkthrough,
  openWalkthrough,
  selectActiveWalkthrough,
  useWalkthroughStore,
  walkthroughSectionKey,
} from "./walkthroughStore";

const ref = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

function walkthrough(
  id: string,
  overrides: Partial<WalkthroughReference> = {},
): WalkthroughReference {
  return {
    id,
    title: id,
    scope: { kind: "branch" },
    sections: [
      { title: "One", summary: "First.", files: [{ path: "a.ts" }] },
      { title: "Two", summary: "Second.", files: [{ path: "b.ts" }] },
      { title: "Three", summary: "Third.", files: [{ path: "c.ts" }] },
    ],
    ...overrides,
  };
}

const active = () => selectActiveWalkthrough(useWalkthroughStore.getState().byThreadKey, ref);
const selection = () => useDiffPanelStore.getState().byThreadKey["environment-1:thread-1"];

beforeEach(() => {
  useWalkthroughStore.setState({ byThreadKey: {} });
  useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} });
});

describe("openWalkthrough", () => {
  it("shows the walkthrough's diff, including an automatic base", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(ref, "release");
    openWalkthrough(ref, { id: "row-1", runId: null }, walkthrough("w1"), 1);
    expect(active()?.sectionIndex).toBe(1);
    expect(active()?.awaitingTurn).toBe(false);
    expect(selection()).toMatchObject({ kind: "branch", baseRef: null });
  });

  it("waits for a turn's checkpoint when the walkthrough names a turn", () => {
    openWalkthrough(
      ref,
      { id: "row-1", runId: "run-1" },
      walkthrough("w1", { scope: { kind: "turn", turnId: "run-1" } }),
      0,
    );
    expect(active()?.awaitingTurn).toBe(true);
    expect(selection()).toMatchObject({ kind: "turn", turnId: "run-1" });
    useWalkthroughStore.getState().settleTurn(ref);
    expect(active()?.awaitingTurn).toBe(false);
  });
});

describe("file requests", () => {
  it("records the request the reader opened with, so only a later link counts", () => {
    useDiffPanelStore.getState().selectTurn(ref, "run-1" as never, "a.ts");
    openWalkthrough(
      ref,
      { id: "row-1", runId: "run-1" },
      walkthrough("w1", { scope: { kind: "turn", turnId: "run-1" } }),
      0,
    );
    const opened = active();
    const atOpen = selection();
    expect(atOpen?.kind).toBe("turn");
    expect(opened?.seenFileRequestId).toBe(atOpen?.kind === "turn" ? atOpen.revealRequestId : -1);
    // A changed-files link, even one that remounts the panel, advances the request.
    useDiffPanelStore.getState().selectTurn(ref, "run-1" as never, "b.ts");
    const afterLink = selection();
    expect(afterLink?.kind === "turn" ? afterLink.revealRequestId : -1).not.toBe(
      opened?.seenFileRequestId,
    );
    useWalkthroughStore.getState().markFileRequest(ref, 7);
    expect(active()?.seenFileRequestId).toBe(7);
  });
});

describe("walkthroughSectionKey", () => {
  it("changes with the section being read and clears when the reader leaves", () => {
    expect(walkthroughSectionKey(active())).toBe("");
    openWalkthrough(ref, { id: "row-1", runId: null }, walkthrough("w1"), 1);
    expect(walkthroughSectionKey(active())).toBe("w1:1");
    useWalkthroughStore.getState().setSection(ref, 2);
    expect(walkthroughSectionKey(active())).toBe("w1:2");
    useWalkthroughStore.getState().close(ref);
    expect(walkthroughSectionKey(active())).toBe("");
  });
});

describe("followWalkthrough", () => {
  it("moves the reader onto the replacement at the same section", () => {
    openWalkthrough(ref, { id: "row-1", runId: null }, walkthrough("w1"), 2, { path: "c.ts" });
    followWalkthrough(
      ref,
      { id: "row-2", runId: "run-2" },
      walkthrough("w2", { replaces: "w1", scope: { kind: "branch", baseRef: "main" } }),
    );
    const next = active();
    expect(next?.walkthrough.id).toBe("w2");
    expect(next?.sourceId).toBe("row-2");
    expect(next?.sectionIndex).toBe(2);
    expect(next?.reveal).toBeNull();
    expect(selection()).toMatchObject({ kind: "branch", baseRef: "main" });
  });

  it("clamps the section when the replacement is shorter", () => {
    openWalkthrough(ref, { id: "row-1", runId: null }, walkthrough("w1"), 2);
    const shorter = walkthrough("w2", { replaces: "w1" });
    followWalkthrough(
      ref,
      { id: "row-2", runId: null },
      { ...shorter, sections: shorter.sections.slice(0, 1) },
    );
    expect(active()?.sectionIndex).toBe(0);
  });

  it("ignores a walkthrough that replaces some other one", () => {
    openWalkthrough(ref, { id: "row-1", runId: null }, walkthrough("w1"), 1);
    followWalkthrough(ref, { id: "row-9", runId: null }, walkthrough("w9", { replaces: "w0" }));
    expect(active()?.walkthrough.id).toBe("w1");
  });
});
