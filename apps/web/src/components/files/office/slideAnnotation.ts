// Tangent(FORK-SLIDES-001): slide marks become preview annotations, so the composer, its chips, and the
// agent prompt treat them like browser preview annotations.
import type {
  PreviewAnnotationPayload,
  PreviewAnnotationRect,
  PreviewAnnotationScreenshot,
} from "@t3tools/contracts";

/** A drag shorter than this, in slide pixels, comments on the whole slide instead of marking a region. */
export const SLIDE_MARK_MIN_SIDE = 8;

/**
 * The longest side of a slide screenshot, in pixels. Even a noisy PNG this size stays well under the
 * composer's 10 MiB image limit.
 */
const SLIDE_SCREENSHOT_MAX_SIDE = 1280;

/** Matches the composer context limit on preview annotation comments. */
export const SLIDE_COMMENT_MAX_CHARS = 8_000;

/** Annotation URLs and titles longer than this are dropped from the message context. */
const SLIDE_ANNOTATION_TEXT_MAX_CHARS = 2_048;

export interface SlidePoint {
  readonly x: number;
  readonly y: number;
}

export interface SlideSize {
  readonly width: number;
  readonly height: number;
}

/** Agents read the deck path and slide number from the annotation's page URL. */
function slideAnnotationUrl(path: string, slideIndex: number): string {
  return `${path}#slide=${slideIndex + 1}`;
}

/** Whether comments on this deck fit the message context; a path too long for it disables them. */
export function canAnnotateDeck(path: string): boolean {
  return slideAnnotationUrl(path, 99_999).length <= SLIDE_ANNOTATION_TEXT_MAX_CHARS;
}

/** The zero-based slide an annotation marks in `path`, or null for annotations on anything else. */
export function annotatedSlideIndex(
  annotation: Pick<PreviewAnnotationPayload, "pageUrl">,
  path: string,
): number | null {
  const prefix = `${path}#slide=`;
  if (!annotation.pageUrl.startsWith(prefix)) return null;
  const slide = Number(annotation.pageUrl.slice(prefix.length));
  return Number.isInteger(slide) && slide > 0 ? slide - 1 : null;
}

/** The dragged rectangle clamped to the slide, or null when the drag is too small to be a region. */
export function slideMarkRect(
  start: SlidePoint,
  end: SlidePoint,
  slide: SlideSize,
): PreviewAnnotationRect | null {
  const clampX = (value: number) => Math.min(slide.width, Math.max(0, value));
  const clampY = (value: number) => Math.min(slide.height, Math.max(0, value));
  const left = clampX(Math.min(start.x, end.x));
  const top = clampY(Math.min(start.y, end.y));
  const width = clampX(Math.max(start.x, end.x)) - left;
  const height = clampY(Math.max(start.y, end.y)) - top;
  if (width < SLIDE_MARK_MIN_SIDE && height < SLIDE_MARK_MIN_SIDE) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function buildSlideAnnotation(input: {
  readonly id: string;
  readonly path: string;
  readonly slideIndex: number;
  readonly slideCount: number;
  readonly comment: string;
  readonly mark: PreviewAnnotationRect | null;
  readonly screenshot: PreviewAnnotationScreenshot | null;
  readonly createdAt: string;
}): PreviewAnnotationPayload {
  const fileName = input.path.split(/[\\/]/).at(-1) || input.path;
  return {
    id: input.id,
    pageUrl: slideAnnotationUrl(input.path, input.slideIndex),
    pageTitle: `Slide ${input.slideIndex + 1} of ${input.slideCount} in ${fileName}`,
    comment: input.comment.trim().slice(0, SLIDE_COMMENT_MAX_CHARS),
    elements: [],
    regions: input.mark ? [{ id: `${input.id}:region`, rect: input.mark }] : [],
    strokes: [],
    styleChanges: [],
    screenshot: input.screenshot,
    createdAt: input.createdAt,
  };
}

/**
 * The painted slide with the mark outlined, so the agent sees what was marked in context. Returns
 * null while the slide has not been painted.
 */
export function captureSlideScreenshot(
  source: HTMLCanvasElement,
  slide: SlideSize,
  mark: PreviewAnnotationRect | null,
  markColor: string,
): PreviewAnnotationScreenshot | null {
  if (source.width === 0 || source.height === 0) return null;
  const shrink = Math.min(1, SLIDE_SCREENSHOT_MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * shrink));
  const height = Math.max(1, Math.round(source.height * shrink));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);
  if (mark) {
    const scale = width / slide.width;
    const line = Math.max(3, Math.round(width / 320));
    context.strokeStyle = markColor;
    context.lineWidth = line;
    context.strokeRect(
      mark.x * scale + line / 2,
      mark.y * scale + line / 2,
      Math.max(1, mark.width * scale - line),
      Math.max(1, mark.height * scale - line),
    );
  }
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    cropRect: { x: 0, y: 0, width: slide.width, height: slide.height },
  };
}
