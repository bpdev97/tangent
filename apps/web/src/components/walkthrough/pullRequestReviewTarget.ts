// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { FileDiffMetadata, SelectionSide } from "@pierre/diffs";
import type { PullRequestReviewPosition } from "@t3tools/contracts";

import { resolveFileDiffPath, resolveFileDiffPreviousPath } from "~/lib/diffRendering";
import { resolveDiffReviewPosition } from "~/reviewCommentContext";

export type PullRequestReviewTarget =
  | {
      readonly kind: "ok";
      readonly path: string;
      /** The file's name on the base side when the pull request renamed it. */
      readonly oldPath?: string;
      readonly position: PullRequestReviewPosition;
    }
  /** The file is not in the loaded part of the pull request diff. */
  | { readonly kind: "missing" }
  /** The pull request diff has no such line. */
  | { readonly kind: "unanchored" }
  /** The pull request's copy of the line reads differently: the branch has moved on. */
  | { readonly kind: "moved" };

function stripTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * The text of one line of a diff, found by walking the hunks the way the
 * viewer numbers them. Outside the hunks only a complete file (one the viewer
 * can expand) still has the line.
 */
export function diffLineText(
  fileDiff: FileDiffMetadata,
  lineNumber: number,
  side: SelectionSide,
): string | null {
  for (const hunk of fileDiff.hunks) {
    let oldLine = hunk.deletionStart;
    let newLine = hunk.additionStart;
    let deletionIndex = hunk.deletionLineIndex;
    let additionIndex = hunk.additionLineIndex;
    for (const segment of hunk.hunkContent) {
      if (segment.type === "context") {
        for (let index = 0; index < segment.lines; index += 1) {
          if (side === "additions" ? newLine === lineNumber : oldLine === lineNumber) {
            return stripTrailingNewline(
              fileDiff.additionLines[additionIndex] ?? fileDiff.deletionLines[deletionIndex] ?? "",
            );
          }
          oldLine += 1;
          newLine += 1;
          deletionIndex += 1;
          additionIndex += 1;
        }
        continue;
      }
      for (let index = 0; index < segment.deletions; index += 1) {
        if (side === "deletions" && oldLine === lineNumber) {
          return stripTrailingNewline(fileDiff.deletionLines[deletionIndex] ?? "");
        }
        oldLine += 1;
        deletionIndex += 1;
      }
      for (let index = 0; index < segment.additions; index += 1) {
        if (side === "additions" && newLine === lineNumber) {
          return stripTrailingNewline(fileDiff.additionLines[additionIndex] ?? "");
        }
        newLine += 1;
        additionIndex += 1;
      }
    }
  }
  if (fileDiff.isPartial) return null;
  const lines = side === "additions" ? fileDiff.additionLines : fileDiff.deletionLines;
  const text = lines[lineNumber - 1];
  return text === undefined ? null : stripTrailingNewline(text);
}

/**
 * Where a comment on a line of the local diff lands in the pull request's
 * own diff. The position comes from the pull request's patch, never the local
 * one, and only when both carry the same text on that line: the pull request
 * is the reviewer's record, and a comment anchored to a line it does not have
 * would be placed on whatever line now sits at that number.
 */
export function resolvePullRequestReviewTarget(input: {
  readonly pullRequestFiles: ReadonlyArray<FileDiffMetadata>;
  readonly localFile: FileDiffMetadata;
  readonly line: number;
  readonly side: SelectionSide | undefined;
}): PullRequestReviewTarget {
  const { pullRequestFiles, localFile, line } = input;
  const side: SelectionSide = input.side ?? "additions";
  const path = resolveFileDiffPath(localFile);
  const pullRequestFile = pullRequestFiles.find(
    (candidate) => resolveFileDiffPath(candidate) === path,
  );
  if (pullRequestFile === undefined) return { kind: "missing" };
  const position = resolveDiffReviewPosition(pullRequestFile, line, side);
  if (position === null) return { kind: "unanchored" };
  const local = diffLineText(localFile, line, side);
  const remote = diffLineText(pullRequestFile, line, side);
  if (local === null || remote === null || local !== remote) return { kind: "moved" };
  const oldPath = resolveFileDiffPreviousPath(pullRequestFile);
  return oldPath === path
    ? { kind: "ok", path, position }
    : { kind: "ok", path, oldPath, position };
}
