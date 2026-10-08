// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { ProjectId, RunId, ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveThreadCurrentPullRequestLink } from "@t3tools/shared/threadPullRequests";
import type { WalkthroughFlag } from "@t3tools/shared/walkthrough";
import { useEffect, useMemo, useRef } from "react";

import { type DiffPanelSelection, useDiffPanelStore } from "~/diffPanelStore";
import { fnv1a32, getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { useRightPanelStore } from "~/rightPanelStore";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import {
  selectActiveWalkthrough,
  useWalkthroughStore,
  type WalkthroughReveal,
} from "~/walkthroughStore";

import type { AnnotatableCodeViewHandle } from "../diffs/AnnotatableCodeView";
import {
  nextPendingReviewCommentId,
  pullRequestReviewKey,
  usePullRequestReviewStore,
} from "../pullRequest/pullRequestReviewStore";
import { toastManager } from "../ui/toast";
import { resolvePullRequestReviewTarget } from "./pullRequestReviewTarget";
import {
  walkthroughIsStale,
  walkthroughMatchesSelection,
  walkthroughNavigationLeaves,
  type WalkthroughTurn,
} from "./walkthroughMode.logic";
import { WalkthroughSectionHeader, WalkthroughWaitingHeader } from "./WalkthroughSectionHeader";

/**
 * Everything the diff panel needs while a walkthrough section is being read,
 * so the panel itself keeps only the call sites: which files to show, the
 * flags to hang under lines, the comment context, a way to send a line
 * comment to the thread's pull request review, and the header above the
 * viewer. A walkthrough reads only while the panel shows the diff it was
 * written against; on any other selection the panel is unchanged.
 */
export function useWalkthroughMode(input: {
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly thread:
    | {
        readonly projectId: ProjectId;
        readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink>;
      }
    | null
    | undefined;
  readonly diffSelection: DiffPanelSelection;
  /** The diff's files in source order, before any narrowing. */
  readonly renderableFiles: ReadonlyArray<FileDiffMetadata>;
  readonly lazy: boolean;
  readonly settledFileCount: number;
  readonly requestFile: (index: number) => void;
  /** The turns the panel can show, latest first. */
  readonly turns: ReadonlyArray<WalkthroughTurn>;
}) {
  const {
    routeThreadRef,
    thread,
    diffSelection,
    renderableFiles,
    lazy,
    settledFileCount,
    requestFile,
    turns,
  } = input;
  const active = useWalkthroughStore((state) =>
    selectActiveWalkthrough(state.byThreadKey, routeThreadRef),
  );
  const matchesSelection =
    active !== null && walkthroughMatchesSelection(active.walkthrough.scope, diffSelection);
  const section = matchesSelection
    ? (active.walkthrough.sections[active.sectionIndex] ?? null)
    : null;
  // A turn walkthrough published mid-turn names a turn the panel cannot show
  // until its checkpoint lands, and the panel falls back to the latest turn
  // meanwhile. Select the turn once it exists, then leave the selection alone.
  const awaitedTurnId =
    active?.awaitingTurn && active.walkthrough.scope.kind === "turn"
      ? (active.walkthrough.scope.turnId as RunId)
      : null;
  const awaitedTurnAvailable =
    awaitedTurnId !== null && turns.some((turn) => turn.runId === awaitedTurnId);
  useEffect(() => {
    if (!routeThreadRef || awaitedTurnId === null || !awaitedTurnAvailable) return;
    if (!(diffSelection.kind === "turn" && diffSelection.turnId === awaitedTurnId)) {
      useDiffPanelStore.getState().selectTurn(routeThreadRef, awaitedTurnId);
    }
    useWalkthroughStore.getState().settleTurn(routeThreadRef);
  }, [awaitedTurnAvailable, awaitedTurnId, diffSelection, routeThreadRef]);
  const waitingForTurn = awaitedTurnId !== null && !awaitedTurnAvailable;
  const sectionPaths = useMemo(
    () => new Set(section?.files.map((file) => file.path) ?? []),
    [section],
  );
  // Ordinary diff navigation (another turn, Uncommitted, a changed-files link
  // to a file outside the section) ends the reading; the card can reopen it.
  // A file link counts once, when its request id differs from the one the
  // store recorded: the selection keeps the path afterwards, so moving to
  // another section must not re-read it, and the record outlives this panel,
  // which the link may have remounted to serve.
  const activeScope = active?.walkthrough.scope ?? null;
  const awaitingTurn = active?.awaitingTurn ?? false;
  const seenFileRequestId = active?.seenFileRequestId ?? null;
  const latestTurnId = turns[0]?.runId ?? null;
  const fileRequestId = diffSelection.kind === "turn" ? diffSelection.revealRequestId : 0;
  useEffect(() => {
    if (!routeThreadRef || activeScope === null) return;
    const requestedFile =
      diffSelection.kind === "turn" &&
      seenFileRequestId !== null &&
      fileRequestId !== seenFileRequestId
        ? diffSelection.filePath
        : null;
    const store = useWalkthroughStore.getState();
    store.markFileRequest(routeThreadRef, fileRequestId);
    if (
      walkthroughNavigationLeaves({
        scope: activeScope,
        selection: diffSelection,
        sectionPaths,
        awaitingTurn,
        awaitedTurnAvailable,
        latestTurnId,
        requestedFile,
      })
    ) {
      store.close(routeThreadRef);
    }
  }, [
    activeScope,
    awaitedTurnAvailable,
    awaitingTurn,
    diffSelection,
    fileRequestId,
    latestTurnId,
    routeThreadRef,
    sectionPaths,
    seenFileRequestId,
  ]);
  const visibleFiles = useMemo(
    () =>
      section
        ? renderableFiles.filter((file) => sectionPaths.has(resolveFileDiffPath(file)))
        : renderableFiles,
    [renderableFiles, section, sectionPaths],
  );
  const presentPaths = useMemo(
    () => new Set(renderableFiles.map((file) => resolveFileDiffPath(file))),
    [renderableFiles],
  );
  const notes = useMemo(() => {
    const byPath = new Map<string, ReadonlyArray<WalkthroughFlag>>();
    for (const file of section?.files ?? []) {
      if (file.flags && file.flags.length > 0) byPath.set(file.path, file.flags);
    }
    return byPath;
  }, [section]);

  // A lazy source loads files in diff order, which can leave a section's files
  // unloaded for a long time; ask for them directly.
  useEffect(() => {
    if (!lazy || !section) return;
    for (const file of section.files) {
      const index = renderableFiles.findIndex(
        (candidate) => resolveFileDiffPath(candidate) === file.path,
      );
      if (index >= 0 && index >= settledFileCount) requestFile(index);
    }
  }, [lazy, renderableFiles, requestFile, section, settledFileCount]);

  // A turn completed after publishing means the agent changed code the
  // sections do not describe.
  const stale =
    active !== null &&
    walkthroughIsStale({
      sourceRunId: active.sourceRunId,
      publishedAt: active.walkthrough.publishedAt,
      turns,
    });

  // Comments can also go to the thread's pull request review, held with the
  // PR panel's other pending comments until the review is sent. The position
  // is resolved against the pull request's own diff, so it is loaded while a
  // section is open on a thread with a pull request.
  const pullRequest = thread
    ? resolveThreadCurrentPullRequestLink(thread.pullRequests ?? [])
    : null;
  const pullRequestDiff = useEnvironmentQuery(
    section && pullRequest && thread && routeThreadRef
      ? pullRequestEnvironment.diff({
          environmentId: routeThreadRef.environmentId,
          input: {
            projectId: thread.projectId,
            host: pullRequest.host,
            repository: pullRequest.repository,
            number: pullRequest.number,
          },
        })
      : null,
  );
  const pullRequestPatch = pullRequestDiff.data?.patch;
  const pullRequestFiles = useMemo(() => {
    if (pullRequestPatch === undefined) return null;
    const parsed = getRenderablePatch(
      pullRequestPatch,
      `walkthrough-pull-request:${fnv1a32(pullRequestPatch)}`,
      { compactPartialHunkOffsets: true },
    );
    return parsed?.kind === "files" ? parsed.sourceFiles : [];
  }, [pullRequestPatch]);
  const draftSecondaryAction =
    section && pullRequest && thread
      ? {
          label: `Add to PR #${pullRequest.number} review`,
          onAction: (draft: {
            readonly filePath: string;
            readonly fileDiff: FileDiffMetadata;
            readonly range: SelectedLineRange;
            readonly text: string;
          }) => {
            // A refusal keeps the draft open with its text, so the reader can
            // send it to the composer instead.
            const refuse = (title: string, description?: string) => {
              toastManager.add({ type: "error", title, ...(description ? { description } : {}) });
              return false;
            };
            if (pullRequestFiles === null) {
              return refuse(
                pullRequestDiff.error ?? "The pull request diff has not loaded yet.",
                "Try again in a moment, or add the comment from the pull request panel.",
              );
            }
            const target = resolvePullRequestReviewTarget({
              pullRequestFiles,
              localFile: draft.fileDiff,
              line: draft.range.end,
              side: draft.range.endSide ?? draft.range.side,
            });
            switch (target.kind) {
              case "missing":
                return refuse(
                  pullRequestDiff.data?.nextCursor
                    ? "That file is past the first page of the pull request diff."
                    : `That file is not part of pull request #${pullRequest.number}.`,
                  "Add the comment from the pull request panel instead.",
                );
              case "unanchored":
                return refuse("That line is not part of the pull request diff.");
              case "moved":
                return refuse(
                  "This line differs from the pull request.",
                  "Push the branch, then add the comment from the pull request panel.",
                );
              case "ok":
                break;
            }
            const reference = {
              projectId: thread.projectId,
              host: pullRequest.host,
              repository: pullRequest.repository,
              number: pullRequest.number,
            };
            usePullRequestReviewStore.getState().addComment(pullRequestReviewKey(reference), {
              id: nextPendingReviewCommentId(),
              path: target.path,
              ...(target.oldPath === undefined ? {} : { oldPath: target.oldPath }),
              position: target.position,
              body: draft.text,
            });
            toastManager.add({
              type: "success",
              title: `Added to the review of #${pullRequest.number}`,
              description: "Send it from the pull request panel.",
            });
            return true;
          },
        }
      : undefined;

  return {
    section,
    visibleFiles,
    /** The section's paths, or null when the panel shows the whole diff. */
    visiblePaths: section ? sectionPaths : null,
    notes,
    draftSecondaryAction,
    /** The line a card asked the panel to show, cleared once the viewer has scrolled. */
    reveal: section ? (active?.reveal ?? null) : null,
    /** Comments name the section they were asked in, so the agent knows which explanation is questioned. */
    commentSectionTitle: (base: string) => (section ? `${base} · ${section.title}` : base),
    /** The section header above the viewer; `revealFile` opens a listed file in the viewer. */
    renderHeader: (revealFile: (path: string) => void) =>
      waitingForTurn && active && routeThreadRef ? (
        <WalkthroughWaitingHeader
          walkthrough={active.walkthrough}
          onClose={() => useWalkthroughStore.getState().close(routeThreadRef)}
        />
      ) : section && active && routeThreadRef ? (
        <WalkthroughSectionHeader
          walkthrough={active.walkthrough}
          sectionIndex={active.sectionIndex}
          presentPaths={presentPaths}
          stale={stale}
          environmentId={routeThreadRef.environmentId}
          onOpenFile={(attachment) =>
            useRightPanelStore.getState().openAttachment(routeThreadRef, attachment)
          }
          onSelectSection={(index) =>
            useWalkthroughStore.getState().setSection(routeThreadRef, index)
          }
          onSelectFile={revealFile}
          onClose={() => useWalkthroughStore.getState().close(routeThreadRef)}
        />
      ) : null,
  };
}

/**
 * Scrolls the viewer to the line a card's flag pointed at, once that file is
 * in the viewer. Each request runs once: revealing a file changes the panel's
 * collapsed set and so the file list's identity, which must not re-run this.
 */
export function useWalkthroughReveal(input: {
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly reveal: WalkthroughReveal | null;
  readonly codeView: AnnotatableCodeViewHandle | null;
  readonly codeViewFiles: ReadonlyArray<{ readonly filePath: string; readonly fileKey: string }>;
  readonly revealFile: (path: string) => void;
}) {
  const { routeThreadRef, reveal, codeView, codeViewFiles, revealFile } = input;
  // Read at run time: the panel re-creates these (and its thread ref) on every
  // render, and the reveal itself causes renders, so they must not be deps.
  const latest = useRef({ routeThreadRef, codeViewFiles, revealFile });
  latest.current = { routeThreadRef, codeViewFiles, revealFile };
  const threadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const handledRequestId = useRef<number | null>(null);
  const requestId = reveal?.requestId ?? null;
  const ready =
    reveal !== null &&
    codeView !== null &&
    codeViewFiles.some((candidate) => candidate.filePath === reveal.path);
  useEffect(() => {
    if (!reveal || !ready || threadKey === null || handledRequestId.current === requestId) return;
    const current = latest.current;
    const routeThreadRef = current.routeThreadRef;
    const file = current.codeViewFiles.find((candidate) => candidate.filePath === reveal.path);
    const viewer = codeView;
    // Handled only once a mounted viewer takes it: the panel remounts the
    // viewer when the diff changes, and the new one must get the request.
    if (!file || !viewer?.getInstance() || !routeThreadRef) return;
    handledRequestId.current = requestId;
    current.revealFile(reveal.path);
    // The viewer virtualises files: bring the file into view first so its
    // lines are measured, then land on the line once they are.
    viewer.scrollTo({ type: "item", id: file.fileKey, align: "start" });
    const timer = window.setTimeout(() => {
      if (reveal.line !== undefined) {
        viewer.scrollTo({
          type: "line",
          id: file.fileKey,
          lineNumber: reveal.line,
          side: "additions",
          align: "center",
        });
      }
      useWalkthroughStore.getState().consumeReveal(routeThreadRef, reveal.requestId);
    }, 250);
    // A section change or a closed panel in the meantime must not scroll a
    // viewer that now shows something else. A re-run for the same request
    // starts over, so a reveal interrupted mid-way still lands.
    return () => {
      window.clearTimeout(timer);
      handledRequestId.current = null;
    };
  }, [codeView, ready, requestId, reveal, threadKey]);
}
