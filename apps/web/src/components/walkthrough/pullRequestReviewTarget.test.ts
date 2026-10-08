// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import { describe, expect, it } from "vite-plus/test";

import { diffLineText, resolvePullRequestReviewTarget } from "./pullRequestReviewTarget";

function parse(patch: ReadonlyArray<string>, scope: string) {
  return parsePatchFiles(patch.join("\n"), scope)[0]!.files[0]!;
}

const pullRequest = parse(
  [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,4 +1,4 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    " four",
  ],
  "walkthrough-pr",
);

describe("diffLineText", () => {
  it("reads a line by its number on either side", () => {
    expect(diffLineText(pullRequest, 2, "additions")).toBe("TWO");
    expect(diffLineText(pullRequest, 2, "deletions")).toBe("two");
    expect(diffLineText(pullRequest, 3, "additions")).toBe("three");
    expect(diffLineText(pullRequest, 9, "additions")).toBeNull();
  });
});

describe("resolvePullRequestReviewTarget", () => {
  it("anchors to the pull request's own diff when the line text agrees", () => {
    // The local branch has an extra hunk above, so line 2 of the local new
    // side is a different line than in the pull request, but line 3 agrees.
    const local = parse(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,4 +1,4 @@",
        " one",
        "-two",
        "+TWO",
        " three",
        " four",
      ],
      "walkthrough-local",
    );
    expect(
      resolvePullRequestReviewTarget({
        pullRequestFiles: [pullRequest],
        localFile: local,
        line: 2,
        side: "additions",
      }),
    ).toEqual({ kind: "ok", path: "src/app.ts", position: { kind: "added", newLine: 2 } });
    expect(
      resolvePullRequestReviewTarget({
        pullRequestFiles: [pullRequest],
        localFile: local,
        line: 2,
        side: "deletions",
      }),
    ).toEqual({ kind: "ok", path: "src/app.ts", position: { kind: "deleted", oldLine: 2 } });
  });

  it("refuses a line the pull request has at another number", () => {
    const local = parse(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,4 +1,5 @@",
        "+zero",
        " one",
        "-two",
        "+TWO",
        " three",
        " four",
      ],
      "walkthrough-local-shifted",
    );
    expect(
      resolvePullRequestReviewTarget({
        pullRequestFiles: [pullRequest],
        localFile: local,
        line: 3,
        side: "additions",
      }),
    ).toEqual({ kind: "moved" });
  });

  it("reports a file or line the pull request diff does not carry", () => {
    const other = parse(
      [
        "diff --git a/src/other.ts b/src/other.ts",
        "--- a/src/other.ts",
        "+++ b/src/other.ts",
        "@@ -1 +1 @@",
        "-a",
        "+b",
      ],
      "walkthrough-other",
    );
    expect(
      resolvePullRequestReviewTarget({
        pullRequestFiles: [pullRequest],
        localFile: other,
        line: 1,
        side: "additions",
      }),
    ).toEqual({ kind: "missing" });
    expect(
      resolvePullRequestReviewTarget({
        pullRequestFiles: [pullRequest],
        localFile: pullRequest,
        line: 40,
        side: "additions",
      }),
    ).toEqual({ kind: "unanchored" });
  });

  it("carries the old name of a renamed file", () => {
    const renamed = parse(
      [
        "diff --git a/src/old.ts b/src/new.ts",
        "similarity index 80%",
        "rename from src/old.ts",
        "rename to src/new.ts",
        "--- a/src/old.ts",
        "+++ b/src/new.ts",
        "@@ -1,2 +1,2 @@",
        " keep",
        "-drop",
        "+add",
      ],
      "walkthrough-renamed",
    );
    expect(
      resolvePullRequestReviewTarget({
        pullRequestFiles: [renamed],
        localFile: renamed,
        line: 2,
        side: "additions",
      }),
    ).toEqual({
      kind: "ok",
      path: "src/new.ts",
      oldPath: "src/old.ts",
      position: { kind: "added", newLine: 2 },
    });
  });
});
