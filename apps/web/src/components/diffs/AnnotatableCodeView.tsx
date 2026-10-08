import type {
  AnnotationSide,
  CodeViewDiffItem,
  CodeViewItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo, useState, type ReactNode, type Ref } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { fnv1a32, resolveFileDiffPath } from "~/lib/diffRendering";
import {
  buildDiffReviewComment,
  restoreDiffReviewCommentRange,
  type ReviewCommentContext,
} from "~/reviewCommentContext";

import { nextFileCommentId } from "../files/fileCommentAnnotations";
import { DiffCommentAnnotation } from "./DiffCommentAnnotation";
import { WalkthroughNoteAnnotation } from "../walkthrough/WalkthroughNoteAnnotation"; // Tangent(FORK-WALK-001)
import { walkthroughFlagAnnotations } from "../walkthrough/walkthroughFlagAnnotations"; // Tangent(FORK-WALK-001)
import type { WalkthroughFlag, WalkthroughFlagSeverity } from "@t3tools/shared/walkthrough"; // Tangent(FORK-WALK-001)
import { StyledDiffCodeView, type StyledDiffCodeViewOptions } from "./StyledDiffCodeView";

interface DiffCommentAnnotationEntry {
  id: string;
  kind: "draft" | "comment" | "note"; // Tangent(FORK-WALK-001): "note" is an agent remark
  severity?: WalkthroughFlagSeverity; // Tangent(FORK-WALK-001)
  range: SelectedLineRange;
  rangeLabel: string;
  text: string;
}

interface DiffCommentAnnotationGroup {
  entries: DiffCommentAnnotationEntry[];
}

type DiffCommentLineAnnotation = DiffLineAnnotation<DiffCommentAnnotationGroup>;
export type AnnotatableCodeViewHandle = CodeViewHandle<DiffCommentAnnotationGroup, undefined>;
const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

function annotationSide(range: SelectedLineRange): AnnotationSide {
  return (range.endSide ?? range.side) === "deletions" ? "deletions" : "additions";
}

function appendAnnotationEntry(
  annotations: ReadonlyArray<DiffCommentLineAnnotation>,
  range: SelectedLineRange,
  entry: DiffCommentAnnotationEntry,
): DiffCommentLineAnnotation[] {
  const side = annotationSide(range);
  const annotationIndex = annotations.findIndex(
    (annotation) => annotation.side === side && annotation.lineNumber === range.end,
  );
  if (annotationIndex < 0) {
    return [
      ...annotations,
      {
        side,
        lineNumber: range.end,
        metadata: { entries: [entry] },
      },
    ];
  }
  return annotations.map((annotation, index) =>
    index === annotationIndex
      ? {
          ...annotation,
          metadata: { entries: [...annotation.metadata.entries, entry] },
        }
      : annotation,
  );
}

interface AnnotatableCodeViewProps {
  codeViewKey: string;
  files: ReadonlyArray<{
    fileDiff: FileDiffMetadata;
    filePath: string;
    fileKey: string;
    fileVersion: number;
    collapsed: boolean;
  }>;
  sectionId: string;
  sectionTitle: string;
  composerDraftTarget: ScopedThreadRef | DraftId;
  /** Tangent(FORK-WALK-001): agent flags by file path, shown under a line of the new side. */
  notes?: ReadonlyMap<string, ReadonlyArray<WalkthroughFlag>>;
  /**
   * Tangent(FORK-WALK-001): a second way to finish a draft, such as adding it
   * to a PR review. Returns whether it took the comment; a refused draft stays open.
   */
  draftSecondaryAction?:
    | {
        readonly label: string;
        readonly onAction: (input: {
          readonly filePath: string;
          readonly fileDiff: FileDiffMetadata;
          readonly range: SelectedLineRange;
          readonly text: string;
        }) => boolean;
      }
    | undefined;
  options: StyledDiffCodeViewOptions<DiffCommentAnnotationGroup>;
  viewerRef?: Ref<AnnotatableCodeViewHandle>;
  className?: string;
  renderCodeViewFooter?: () => ReactNode;
  unsafeCSSExtra?: string;
  renderHeaderMetadata?: (fileDiff: FileDiffMetadata) => ReactNode;
  renderHeaderFilenameSuffix: (fileDiff: FileDiffMetadata) => ReactNode;
  renderHeaderPrefix: (
    fileDiff: FileDiffMetadata,
    fileKey: string,
    collapsed: boolean,
  ) => ReactNode;
  /** Unfold a collapsed file that holds the find match being navigated to. */
  onRevealSearchMatch: (fileKey: string) => void;
}

interface DiffSelectionContext {
  item: CodeViewItem<DiffCommentAnnotationGroup>;
}

export function AnnotatableCodeView({
  codeViewKey,
  files,
  sectionId,
  sectionTitle,
  composerDraftTarget,
  notes, // Tangent(FORK-WALK-001)
  draftSecondaryAction, // Tangent(FORK-WALK-001)
  options,
  viewerRef,
  className,
  renderCodeViewFooter,
  unsafeCSSExtra,
  renderHeaderMetadata,
  renderHeaderFilenameSuffix,
  renderHeaderPrefix,
  onRevealSearchMatch,
}: AnnotatableCodeViewProps) {
  const addReviewComment = useComposerDraftStore((store) => store.addReviewComment);
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const [selectedLines, setSelectedLines] = useState<{
    id: string;
    range: SelectedLineRange;
  } | null>(null);
  const [draft, setDraft] = useState<{
    fileKey: string;
    annotation: DiffCommentLineAnnotation;
  } | null>(null);
  const [draftText, setDraftText] = useState("");

  const filesByKey = useMemo(() => new Map(files.map((file) => [file.fileKey, file])), [files]);
  const items = useMemo<CodeViewDiffItem<DiffCommentAnnotationGroup>[]>(
    () =>
      files.map(({ fileDiff, filePath, fileKey, fileVersion, collapsed }) => {
        const persisted = reviewComments
          .filter(
            (comment) =>
              comment.sectionId === sectionId &&
              comment.filePath === filePath &&
              (comment.fenceLanguage ?? "diff") === "diff",
          )
          .reduce<DiffCommentLineAnnotation[]>((annotations, comment) => {
            const range = restoreDiffReviewCommentRange(fileDiff, comment);
            if (!range) return annotations;
            return appendAnnotationEntry(annotations, range, {
              id: comment.id,
              kind: "comment",
              range,
              rangeLabel: comment.rangeLabel,
              text: comment.text,
            });
          }, []);
        // Tangent(FORK-WALK-001): agent flags sit under their lines like comments.
        const withNote = walkthroughFlagAnnotations(
          filePath,
          fileDiff,
          notes?.get(filePath),
        ).reduce(
          (annotations, flag) => appendAnnotationEntry(annotations, flag.range, flag.entry),
          persisted,
        );
        const annotations = draft?.fileKey === fileKey ? [...withNote, draft.annotation] : withNote;
        return {
          id: fileKey,
          type: "diff",
          fileDiff,
          annotations,
          collapsed,
          version: fnv1a32(
            `${fileVersion}:${collapsed ? "1" : "0"}:${annotations
              .flatMap((annotation) =>
                annotation.metadata.entries.map(
                  (entry) => `${entry.id}:${entry.rangeLabel}:${entry.text}`,
                ),
              )
              .join(":")}`,
          ),
        };
      }),
    [draft, files, notes, reviewComments, sectionId],
  );

  const removeEntry = useCallback(
    (entryId: string) => {
      setSelectedLines(null);
      if (draft?.annotation.metadata.entries.some((entry) => entry.id === entryId)) {
        setDraft(null);
        setDraftText("");
      } else {
        removeReviewComment(composerDraftTarget, entryId);
      }
    },
    [composerDraftTarget, draft, removeReviewComment],
  );

  const submitEntry = useCallback(
    (entryId: string, text: string) => {
      const entry = draft?.annotation.metadata.entries.find(
        (candidate) => candidate.id === entryId,
      );
      const file = draft ? filesByKey.get(draft.fileKey) : undefined;
      if (!entry || !file) return;
      const comment = buildDiffReviewComment({
        id: entry.id,
        sectionId,
        sectionTitle,
        filePath: file.filePath,
        fileDiff: file.fileDiff,
        range: entry.range,
        text,
      });
      if (comment) addReviewComment(composerDraftTarget, comment);
      setSelectedLines(null);
      setDraft(null);
      setDraftText("");
    },
    [addReviewComment, composerDraftTarget, draft, filesByKey, sectionId, sectionTitle],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange | null, context: DiffSelectionContext) => {
      if (!range) return;
      const item = context.item;
      if (item.type !== "diff") return;
      // Read from the item, not the file list, so this callback keeps its identity as
      // patches arrive; the viewer re-applies its options whenever it changes.
      const id = nextFileCommentId();
      const comment = buildDiffReviewComment({
        id,
        sectionId,
        sectionTitle,
        filePath: resolveFileDiffPath(item.fileDiff),
        fileDiff: item.fileDiff,
        range,
        text: "",
      });
      if (!comment) return;
      setDraftText("");
      setDraft({
        fileKey: item.id,
        annotation: {
          side: annotationSide(range),
          lineNumber: range.end,
          metadata: {
            entries: [{ id, kind: "draft", range, rangeLabel: comment.rangeLabel, text: "" }],
          },
        },
      });
    },
    [sectionId, sectionTitle],
  );

  const hasOpenComment = draft !== null;
  return (
    <StyledDiffCodeView<DiffCommentAnnotationGroup>
      key={codeViewKey}
      {...(viewerRef ? { viewerRef } : {})}
      {...(className ? { className } : {})}
      {...(unsafeCSSExtra ? { unsafeCSSExtra } : {})}
      {...(renderHeaderMetadata
        ? {
            renderHeaderMetadata: (item: CodeViewItem<DiffCommentAnnotationGroup>) =>
              item.type === "diff" ? renderHeaderMetadata(item.fileDiff) : null,
          }
        : {})}
      {...(renderCodeViewFooter ? { renderCodeViewFooter } : {})}
      items={items}
      selectedLines={selectedLines}
      onSelectedLinesChange={setSelectedLines}
      onRevealSearchMatch={(item) => onRevealSearchMatch(item.id)}
      options={{
        ...options,
        enableGutterUtility: !hasOpenComment,
        enableLineSelection: !hasOpenComment,
        onGutterUtilityClick: beginComment,
      }}
      renderHeaderFilenameSuffix={(item) =>
        item.type === "diff" ? renderHeaderFilenameSuffix(item.fileDiff) : null
      }
      renderHeaderPrefix={(item) =>
        item.type === "diff"
          ? renderHeaderPrefix(item.fileDiff, item.id, item.collapsed === true)
          : null
      }
      renderAnnotation={(annotation) => {
        const hasDraft = annotation.metadata.entries.some((entry) => entry.kind === "draft");
        return (
          <div
            className={hasDraft ? "py-1" : "divide-y divide-border/30 border-y border-border/30"}
          >
            {annotation.metadata.entries.map((entry) =>
              entry.kind === "note" ? (
                // Tangent(FORK-WALK-001)
                <WalkthroughNoteAnnotation
                  key={entry.id}
                  severity={entry.severity ?? "note"}
                  text={entry.text}
                />
              ) : (
                <DiffCommentAnnotation
                  key={entry.id}
                  kind={entry.kind}
                  rangeLabel={entry.rangeLabel}
                  text={entry.kind === "draft" ? draftText : entry.text}
                  onTextChange={setDraftText}
                  onCancel={() => removeEntry(entry.id)}
                  onComment={(text) => submitEntry(entry.id, text)}
                  onDelete={() => removeEntry(entry.id)}
                  // Tangent(FORK-WALK-001): the draft can also leave through the caller's action.
                  {...(entry.kind === "draft" && draftSecondaryAction
                    ? {
                        secondaryAction: {
                          label: draftSecondaryAction.label,
                          onAction: (text: string) => {
                            const file = draft ? filesByKey.get(draft.fileKey) : undefined;
                            if (!file) return;
                            const taken = draftSecondaryAction.onAction({
                              filePath: file.filePath,
                              fileDiff: file.fileDiff,
                              range: entry.range,
                              text,
                            });
                            if (taken) removeEntry(entry.id);
                          },
                        },
                      }
                    : {})}
                />
              ),
            )}
          </div>
        );
      }}
    />
  );
}
