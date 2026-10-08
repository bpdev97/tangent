// @vitest-environment jsdom
// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useWalkthroughStore, walkthroughSectionKey } from "~/walkthroughStore";

// The viewer is replaced by a probe that exposes the options the annotatable
// view hands it, which is where it enables or disables commenting.
const latestOptions: { current: Record<string, unknown> | null } = { current: null };
vi.mock("../diffs/StyledDiffCodeView", () => ({
  StyledDiffCodeView: (props: { options: Record<string, unknown> }) => {
    latestOptions.current = props.options;
    return null;
  },
}));

const { AnnotatableCodeView } = await import("../diffs/AnnotatableCodeView");

const ref = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const fileDiff = parsePatchFiles(
  ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1 +1 @@", "-one", "+ONE"].join(
    "\n",
  ),
  "walkthrough-draft-reset",
)[0]!.files[0]!;
const files = [
  { filePath: "a.ts", fileKey: "key:a.ts", fileDiff, fileVersion: 1, collapsed: false },
];

function Panel() {
  // Keyed the way DiffPanel keys its viewer: the scope plus the section being read.
  const sectionKey = useWalkthroughStore((state) =>
    walkthroughSectionKey(state.byThreadKey["environment-1:thread-1"] ?? null),
  );
  return createElement(AnnotatableCodeView, {
    key: `scope:${sectionKey}`,
    codeViewKey: "view",
    files,
    renderHeaderFilenameSuffix: () => null,
    renderHeaderPrefix: () => null,
    onRevealSearchMatch: () => {},
    sectionId: "branch",
    sectionTitle: "Changes",
    composerDraftTarget: ref,
    options: {},
  });
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  useWalkthroughStore.setState({ byThreadKey: {} });
  useWalkthroughStore.getState().open(
    ref,
    { id: "row-1", runId: null },
    {
      id: "w1",
      title: "w1",
      scope: { kind: "branch" },
      sections: [
        { title: "A", summary: "First.", files: [{ path: "a.ts" }] },
        { title: "B", summary: "Second.", files: [{ path: "b.ts" }] },
      ],
    },
    0,
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  latestOptions.current = null;
});

function beginDraft() {
  const begin = latestOptions.current?.onGutterUtilityClick as (
    range: { start: number; end: number; side: "additions" },
    context: { item: { type: "diff"; id: string; fileDiff: typeof fileDiff } },
  ) => void;
  act(() =>
    begin(
      { start: 1, end: 1, side: "additions" },
      { item: { type: "diff", id: "key:a.ts", fileDiff } },
    ),
  );
}

describe("walkthrough section changes and comment drafts", () => {
  it("drops a draft on a file the next section does not show, so commenting stays enabled", () => {
    act(() => root.render(createElement(Panel)));
    expect(latestOptions.current?.enableGutterUtility).toBe(true);
    beginDraft();
    expect(latestOptions.current?.enableGutterUtility).toBe(false);
    act(() => useWalkthroughStore.getState().setSection(ref, 1));
    expect(latestOptions.current?.enableGutterUtility).toBe(true);
    expect(latestOptions.current?.enableLineSelection).toBe(true);
  });
});
