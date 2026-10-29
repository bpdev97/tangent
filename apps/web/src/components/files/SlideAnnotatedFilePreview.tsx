// Tangent(FORK-SLIDES-001): workspace documents opened beside a composer can comment on slides.
import type { ComponentProps } from "react";

import type { ComposerThreadTarget } from "~/composerDraftStore";

import { AttachmentFilePreview } from "./AttachmentFilePreview";
import { SlideAnnotationProvider } from "./office/SlideAnnotations";

export function SlideAnnotatedFilePreview({
  composerTarget,
  path,
  ...preview
}: ComponentProps<typeof AttachmentFilePreview> & {
  readonly composerTarget: ComposerThreadTarget;
  readonly path: string;
}) {
  return (
    <SlideAnnotationProvider composerTarget={composerTarget} path={path}>
      <AttachmentFilePreview {...preview} />
    </SlideAnnotationProvider>
  );
}
