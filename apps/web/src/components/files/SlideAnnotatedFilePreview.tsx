// Tangent(FORK-SLIDES-001): workspace documents opened beside a composer can comment on slides, and
// reload only when their file changes.
import { officePreviewKind } from "@t3tools/shared/filePreview";
import { useEffect, useState, type ComponentProps } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import type { ComposerThreadTarget } from "~/composerDraftStore";

import { AttachmentFilePreview } from "./AttachmentFilePreview";
import { FileSurfaceNotice } from "./fileSurfaceChrome";
import {
  DeckVersionContext,
  INITIAL_DECK_VERSIONS,
  markVersionFailed,
  markVersionReady,
  markVersionRecovered,
  markVersionStalled,
  observeRevision,
  showReadyVersion,
  UNAVAILABLE_REVISION,
} from "./office/deckVersions";
import {
  SlideAnnotationProvider,
  useSlideAnnotationMode,
  useSlideCommentOpen,
} from "./office/SlideAnnotations";

/** How long a new version loads before the user is told they are looking at the old one. */
const VERSION_STALL_MS = 30_000;

type PreviewProps = ComponentProps<typeof AttachmentFilePreview>;
type WorkspaceAsset = Extract<NonNullable<PreviewProps["asset"]>, { readonly resource: unknown }>;
type WorkspacePreviewProps = Omit<PreviewProps, "asset"> & {
  readonly asset: WorkspaceAsset;
  readonly workspaceMutationId: string | null;
};

export function SlideAnnotatedFilePreview({
  composerTarget,
  path,
  ...preview
}: WorkspacePreviewProps & {
  readonly composerTarget: ComposerThreadTarget;
  readonly path: string;
}) {
  return (
    <SlideAnnotationProvider composerTarget={composerTarget} path={path}>
      <RevisionedFilePreview {...preview} />
    </SlideAnnotationProvider>
  );
}

function RevisionedFilePreview({ workspaceMutationId, ...preview }: WorkspacePreviewProps) {
  const { environmentId, resource } = preview.asset;
  const mode = useSlideAnnotationMode();
  // Only the slide toolbar can report that a hidden copy is ready.
  const swaps = mode.target !== null && officePreviewKind({ name: preview.name }) === "pptx";
  // Each workspace mutation asks for a new URL, whose revision says whether this file changed.
  const asset = useAssetUrlState(environmentId, resource, workspaceMutationId ?? undefined);
  const commenting = useSlideCommentOpen(mode);
  const [versions, setVersions] = useState(INITIAL_DECK_VERSIONS);
  // A waiting result still holds the previous mint's revision, which may not be the bytes on screen.
  const revision =
    asset._tag === "Failure"
      ? UNAVAILABLE_REVISION
      : asset._tag === "Success" && !("waiting" in asset)
        ? (asset.fileRevision ?? workspaceMutationId)
        : null;
  const observed = revision === null ? versions : observeRevision(versions, revision, swaps);
  // An open comment is about the slide on screen, so the deck does not change under it.
  const current = commenting ? observed : showReadyVersion(observed);
  if (current !== versions) setVersions(current);

  const loading = current.next !== null && !current.next.ready ? current.next.id : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the timer that tells the user a hidden version has not finished loading.
  useEffect(() => {
    if (loading === null) return;
    const timer = setTimeout(
      () => setVersions((value) => markVersionStalled(value, loading)),
      VERSION_STALL_MS,
    );
    return () => clearTimeout(timer);
  }, [loading]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {current.next?.ready ? (
        <FileSurfaceNotice>
          A new version is ready. Finish or cancel your comment to see it.
        </FileSurfaceNotice>
      ) : current.rejected === UNAVAILABLE_REVISION ? (
        <FileSurfaceNotice>
          Could not reach this file. Showing the last version that loaded.
        </FileSurfaceNotice>
      ) : current.rejected !== null ? (
        <FileSurfaceNotice>
          Could not load the latest version. Showing the previous one.
        </FileSurfaceNotice>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {[current.shown, ...(current.next ? [current.next] : [])].map((version) => {
          const hidden = version.id !== current.shown.id;
          return (
            <div
              key={version.id}
              inert={hidden}
              className={
                hidden ? "invisible absolute inset-0 flex flex-col" : "flex min-h-0 flex-1 flex-col"
              }
            >
              <DeckVersionContext
                value={{
                  hidden,
                  onReady: () => setVersions((value) => markVersionReady(value, version.id)),
                  onFailed: () => setVersions((value) => markVersionFailed(value, version.id)),
                  onRecovered: () =>
                    setVersions((value) => markVersionRecovered(value, version.id)),
                }}
              >
                <AttachmentFilePreview {...preview} />
              </DeckVersionContext>
            </div>
          );
        })}
      </div>
    </div>
  );
}
