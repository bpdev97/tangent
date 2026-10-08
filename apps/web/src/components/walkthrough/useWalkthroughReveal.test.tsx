// @vitest-environment jsdom
// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useWalkthroughStore, type WalkthroughReveal } from "~/walkthroughStore";

import type { AnnotatableCodeViewHandle } from "../diffs/AnnotatableCodeView";
import { useWalkthroughReveal } from "./useWalkthroughMode";

const ref = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const files = [{ filePath: "a.ts", fileKey: "key:a.ts" }];

function fakeViewer(mounted = true) {
  const scrollTo = vi.fn();
  const viewer = {
    getInstance: () => (mounted ? ({} as never) : null),
    scrollTo,
  } as unknown as AnnotatableCodeViewHandle;
  return { viewer, scrollTo };
}

interface Props {
  readonly reveal: WalkthroughReveal | null;
  readonly codeView: AnnotatableCodeViewHandle | null;
  readonly revealFile: (path: string) => void;
}

function Probe(props: Props) {
  useWalkthroughReveal({ routeThreadRef: ref, codeViewFiles: files, ...props });
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
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
      sections: [{ title: "One", summary: "First.", files: [{ path: "a.ts" }] }],
    },
    0,
    { path: "a.ts", line: 7 },
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const activeReveal = () =>
  useWalkthroughStore.getState().byThreadKey["environment-1:thread-1"]?.reveal ?? null;

function render(props: Props) {
  act(() => root.render(createElement(Probe, props)));
}

describe("useWalkthroughReveal", () => {
  it("brings the file into view, then lands on the line and consumes the request", () => {
    const { viewer, scrollTo } = fakeViewer();
    const revealFile = vi.fn();
    render({ reveal: activeReveal(), codeView: viewer, revealFile });
    expect(revealFile).toHaveBeenCalledWith("a.ts");
    expect(scrollTo).toHaveBeenCalledWith({ type: "item", id: "key:a.ts", align: "start" });
    act(() => vi.advanceTimersByTime(250));
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "line", id: "key:a.ts", lineNumber: 7 }),
    );
    expect(activeReveal()).toBeNull();
  });

  it("hands the request to the viewer that replaces an unmounted one", () => {
    const stale = fakeViewer(false);
    const revealFile = vi.fn();
    render({ reveal: activeReveal(), codeView: stale.viewer, revealFile });
    expect(stale.scrollTo).not.toHaveBeenCalled();
    const fresh = fakeViewer();
    render({ reveal: activeReveal(), codeView: fresh.viewer, revealFile });
    expect(fresh.scrollTo).toHaveBeenCalledWith({ type: "item", id: "key:a.ts", align: "start" });
    act(() => vi.advanceTimersByTime(250));
    expect(activeReveal()).toBeNull();
  });

  it("drops a reveal that a section change interrupts, without scrolling later", () => {
    const { viewer, scrollTo } = fakeViewer();
    render({ reveal: activeReveal(), codeView: viewer, revealFile: () => {} });
    act(() => useWalkthroughStore.getState().setSection(ref, 0));
    render({ reveal: activeReveal(), codeView: viewer, revealFile: () => {} });
    act(() => vi.advanceTimersByTime(250));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
