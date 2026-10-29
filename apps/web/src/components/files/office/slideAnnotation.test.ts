import { PreviewAnnotationContextRecord } from "@t3tools/contracts";
import {
  formatComposerContextReference,
  projectComposerContextForProvider,
} from "@t3tools/shared/composerContextReferences";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  previewAnnotationContextId,
  previewAnnotationContextRecord,
  previewAnnotationContextReference,
} from "~/lib/composerContextRecords";

import {
  annotatedSlideIndex,
  buildSlideAnnotation,
  SLIDE_MARK_MIN_SIDE,
  slideMarkRect,
} from "./slideAnnotation";

const isContextRecord = Schema.is(PreviewAnnotationContextRecord);
const SLIDE = { width: 960, height: 540 };
const DECK = "/Users/me/work/q3-review.pptx";

describe("slideMarkRect", () => {
  it("normalizes a drag in any direction and clamps it to the slide", () => {
    expect(slideMarkRect({ x: 900, y: 500 }, { x: 100.4, y: 40.6 }, SLIDE)).toEqual({
      x: 100,
      y: 41,
      width: 800,
      height: 459,
    });
    expect(slideMarkRect({ x: -50, y: -20 }, { x: 2000, y: 900 }, SLIDE)).toEqual({
      x: 0,
      y: 0,
      ...SLIDE,
    });
  });

  it("treats a click or tiny drag as a comment on the whole slide", () => {
    expect(slideMarkRect({ x: 10, y: 10 }, { x: 10, y: 10 }, SLIDE)).toBeNull();
    const nudge = SLIDE_MARK_MIN_SIDE - 1;
    expect(slideMarkRect({ x: 10, y: 10 }, { x: 10 + nudge, y: 10 + nudge }, SLIDE)).toBeNull();
    // A thin but long mark, such as underlining a heading, is still a region.
    expect(slideMarkRect({ x: 10, y: 10 }, { x: 300, y: 12 }, SLIDE)).toEqual({
      x: 10,
      y: 10,
      width: 290,
      height: 2,
    });
  });
});

describe("annotatedSlideIndex", () => {
  it("finds the slide only for annotations on the same deck", () => {
    const annotation = (pageUrl: string) => ({ pageUrl });
    expect(annotatedSlideIndex(annotation(`${DECK}#slide=4`), DECK)).toBe(3);
    expect(annotatedSlideIndex(annotation(`${DECK}#slide=0`), DECK)).toBeNull();
    expect(annotatedSlideIndex(annotation(`${DECK}#slide=two`), DECK)).toBeNull();
    expect(annotatedSlideIndex(annotation("/Users/me/work/q3.pptx#slide=4"), DECK)).toBeNull();
    expect(annotatedSlideIndex(annotation("https://example.com/#slide=4"), DECK)).toBeNull();
  });
});

describe("buildSlideAnnotation", () => {
  it("tells the agent which deck, slide, and region the comment is about", () => {
    const annotation = buildSlideAnnotation({
      id: "slide-comment-1",
      path: DECK,
      slideIndex: 3,
      slideCount: 12,
      comment: "  Make this a bar chart and drop the legend \n",
      mark: { x: 480, y: 120, width: 400, height: 300 },
      screenshot: null,
      createdAt: "2026-10-28T00:00:00.000Z",
    });
    const record = previewAnnotationContextRecord(annotation, {
      screenshotContextId: annotation.id,
    });
    expect(isContextRecord(record)).toBe(true);

    const prompt = projectComposerContextForProvider({
      text: `Please fix ${formatComposerContextReference({
        kind: "preview-annotation",
        contextId: previewAnnotationContextId(annotation.id),
        label: previewAnnotationContextReference(annotation).label,
      })}`,
      records: [record],
    });
    expect(prompt).toContain("page: Slide 4 of 12 in q3-review.pptx");
    expect(prompt).toContain(`url: ${DECK}#slide=4`);
    expect(prompt).toContain("comment: Make this a bar chart and drop the legend");
    expect(prompt).toContain("targets: 1 marked region");
    expect(prompt).toContain("screenshot: ref=");
  });

  it("marks no region for a whole-slide comment", () => {
    const annotation = buildSlideAnnotation({
      id: "slide-comment-2",
      path: "C:\\decks\\pitch.pptx",
      slideIndex: 0,
      slideCount: 1,
      comment: "Too much text",
      mark: null,
      screenshot: null,
      createdAt: "2026-10-28T00:00:00.000Z",
    });
    expect(annotation.pageTitle).toBe("Slide 1 of 1 in pitch.pptx");
    expect(annotation.regions).toEqual([]);
    expect(previewAnnotationContextRecord(annotation).targetSummary).toBe("");
  });
});
