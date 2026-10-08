// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { WalkthroughFlag, WalkthroughFlagSeverity } from "@t3tools/shared/walkthrough";

export interface WalkthroughFlagAnnotation {
  readonly range: SelectedLineRange;
  readonly entry: {
    readonly id: string;
    readonly kind: "note";
    readonly severity: WalkthroughFlagSeverity;
    readonly range: SelectedLineRange;
    readonly rangeLabel: string;
    readonly text: string;
  };
}

const NONE: ReadonlyArray<WalkthroughFlagAnnotation> = [];

/**
 * The line annotations a file's walkthrough flags become. A flag anchors to
 * its line on the new side, or to the file's first changed line when it
 * speaks about the file as a whole. The id carries the severity because the
 * viewer repaints an annotation from its id and text, and a flag whose
 * severity changed must repaint too.
 */
export function walkthroughFlagAnnotations(
  filePath: string,
  fileDiff: FileDiffMetadata,
  flags: ReadonlyArray<WalkthroughFlag> | undefined,
): ReadonlyArray<WalkthroughFlagAnnotation> {
  if (!flags || flags.length === 0) return NONE;
  const firstHunk = fileDiff.hunks[0];
  const anchor =
    firstHunk === undefined
      ? null
      : firstHunk.additionCount > 0
        ? { line: firstHunk.additionStart, side: "additions" as const }
        : { line: firstHunk.deletionStart, side: "deletions" as const };
  const annotations: WalkthroughFlagAnnotation[] = [];
  flags.forEach((flag, index) => {
    const target =
      flag.line !== undefined ? { line: flag.line, side: "additions" as const } : anchor;
    if (target === null || target.line < 1) return;
    const range = { start: target.line, end: target.line, side: target.side };
    annotations.push({
      range,
      entry: {
        id: `walkthrough-flag:${filePath}:${index}:${flag.severity}`,
        kind: "note",
        severity: flag.severity,
        range,
        rangeLabel: `L${target.line}`,
        text: flag.text,
      },
    });
  });
  return annotations;
}
