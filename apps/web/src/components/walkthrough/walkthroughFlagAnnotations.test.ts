// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { walkthroughFlagAnnotations } from "./walkthroughFlagAnnotations";

const [fileDiff] = parsePatchFiles(
  [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -10,3 +10,4 @@",
    " ten",
    "+eleven",
    " twelve",
    " thirteen",
  ].join("\n"),
  "walkthrough-flags",
)[0]!.files;

describe("walkthroughFlagAnnotations", () => {
  it("anchors a flag to its line, or to the first changed line of the file", () => {
    const annotations = walkthroughFlagAnnotations("src/app.ts", fileDiff!, [
      { severity: "blocker", line: 12, text: "Twelve is wrong." },
      { severity: "note", text: "About this file." },
    ]);
    expect(annotations.map((annotation) => annotation.range)).toEqual([
      { start: 12, end: 12, side: "additions" },
      { start: 10, end: 10, side: "additions" },
    ]);
  });

  it("gives a flag an id that changes with its severity", () => {
    const [asNote] = walkthroughFlagAnnotations("src/app.ts", fileDiff!, [
      { severity: "note", line: 12, text: "Same words." },
    ]);
    const [asBlocker] = walkthroughFlagAnnotations("src/app.ts", fileDiff!, [
      { severity: "blocker", line: 12, text: "Same words." },
    ]);
    expect(asNote?.entry.id).not.toBe(asBlocker?.entry.id);
  });
});
