import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { render } from "../../../../test/render";

import {
  SlideAnnotationLayer,
  SlideAnnotationProvider,
  SlideAnnotationToggle,
  useSlideAnnotationMode,
} from "./SlideAnnotations";

const DECK = "/Users/me/work/q3-review.pptx";
const SLIDE_COLOR = [30, 39, 97];
// Slides are 960 by 540 CSS pixels and shown at half size, as in a narrow file panel.
const SLIDES = [
  { id: "title", width: 960, height: 540, hidden: false, notes: undefined },
  { id: "chart", width: 960, height: 540, hidden: false, notes: undefined },
  { id: "summary", width: 960, height: 540, hidden: false, notes: undefined },
];

function threadRef(name: string, environment = "environment-1") {
  return { environmentId: EnvironmentId.make(environment), threadId: ThreadId.make(name) };
}

/** Lays out like Presentation: the toolbar and the slide list share one root. */
function Deck(props: { readonly showSecond?: boolean; readonly slideCount?: number }) {
  const mode = useSlideAnnotationMode();
  const slides = SLIDES.slice(0, props.slideCount ?? SLIDES.length);
  const [shown, setShown] = useState(0);
  const pages = useRef<HTMLDivElement>(null);
  // Like OfficePages, scroll the slide to 24px below the top of the list.
  const select = (index: number) => {
    setShown(index);
    const row = pages.current?.querySelector(`[aria-label="Slide ${index + 1}"]`);
    if (pages.current && row instanceof HTMLElement) pages.current.scrollTop = row.offsetTop - 24;
  };
  return (
    <div>
      <div>
        <button type="button" onClick={() => select(1)}>
          Go to slide 2
        </button>
        <span>Showing slide {shown + 1}</span>
        <SlideAnnotationToggle
          mode={mode}
          page={shown}
          slideCount={slides.length}
          onRestore={select}
        />
      </div>
      <div
        ref={pages}
        data-office-pages
        style={{ position: "relative", height: 300, overflow: "auto", padding: "24px 0" }}
      >
        {slides.map((slide, index) =>
          index === 1 && props.showSecond === false ? null : (
            <div
              key={slide.id}
              role="group"
              aria-label={`Slide ${index + 1}`}
              className="relative"
              style={{ width: slide.width / 2, height: slide.height / 2 }}
            >
              <canvas ref={paintSlide} className="absolute inset-0 block size-full" />
              <SlideAnnotationLayer mode={mode} index={index} slides={slides} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function paintSlide(canvas: HTMLCanvasElement | null) {
  if (!canvas || canvas.width === 960) return;
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = `rgb(${SLIDE_COLOR.join(" ")})`;
  context.fillRect(0, 0, 960, 540);
}

// View state is per deck path, so each test opens its own deck.
function deck(
  ref: ReturnType<typeof threadRef> | DraftId,
  options: {
    readonly showSecond?: boolean;
    readonly slideCount?: number;
    readonly path?: string;
  } = {},
) {
  const path =
    options.path ??
    (typeof ref !== "string" && ref.threadId === "thread-slide-mark"
      ? DECK
      : `/Users/me/work/${typeof ref === "string" ? ref : ref.threadId}.pptx`);
  return (
    <SlideAnnotationProvider composerTarget={ref} path={path}>
      <Deck
        {...(options.showSecond === undefined ? {} : { showSecond: options.showSecond })}
        {...(options.slideCount === undefined ? {} : { slideCount: options.slideCount })}
      />
    </SlideAnnotationProvider>
  );
}

const draftOf = (ref: ReturnType<typeof threadRef>) =>
  useComposerDraftStore.getState().getComposerDraft(ref);

async function markSecondSlide(from: { x: number; y: number }, to: { x: number; y: number }) {
  const layer = page.getByRole("group", { name: "Slide 2" }).element().lastElementChild;
  if (!(layer instanceof HTMLElement)) throw new Error("Missing annotation layer");
  await userEvent.dragAndDrop(layer, layer, { sourcePosition: from, targetPosition: to });
}

async function pixelsOf(dataUrl: string) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D context");
  context.drawImage(image, 0, 0);
  return (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
}

describe("slide annotations", () => {
  it("adds a marked region to the composer with a screenshot, shows it, and removes it", async () => {
    const ref = threadRef("thread-slide-mark");
    await using _screen = await render(deck(ref));

    // Dragging does nothing until commenting is turned on.
    await markSecondSlide({ x: 40, y: 40 }, { x: 240, y: 140 });
    await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Comment on slides" }).click();
    await markSecondSlide({ x: 40, y: 40 }, { x: 240, y: 140 });
    const add = page.getByRole("button", { name: "Add to chat" });
    await expect.element(add).toBeDisabled();
    await page.getByRole("textbox", { name: "Comment on slide 2" }).fill("Make this a bar chart");
    await add.click();

    const draft = draftOf(ref);
    expect(draft?.previewAnnotations).toHaveLength(1);
    const [annotation] = draft?.previewAnnotations ?? [];
    expect(annotation).toMatchObject({
      pageUrl: `${DECK}#slide=2`,
      pageTitle: "Slide 2 of 3 in q3-review.pptx",
      comment: "Make this a bar chart",
    });
    const rect = annotation?.regions[0]?.rect;
    expect(rect?.x).toBeCloseTo(80, -1);
    expect(rect?.y).toBeCloseTo(80, -1);
    expect(rect?.width).toBeCloseTo(400, -1);
    expect(rect?.height).toBeCloseTo(200, -1);
    expect(draft?.prompt).toContain("Make this a bar chart");

    // The screenshot is the painted slide with the region outlined, attached as the annotation's image.
    expect(draft?.images.map((image) => image.id)).toEqual([annotation?.id]);
    const screenshot = draft?.images[0];
    expect(screenshot?.mimeType).toBe("image/png");
    const pixel = await pixelsOf(screenshot?.previewUrl ?? "");
    // The painted canvas is 960 wide, so screenshot pixels are slide pixels.
    expect(pixel(300, 200)).toEqual(SLIDE_COLOR);
    expect(pixel((rect?.x ?? 0) + 1, 200)).not.toEqual(SLIDE_COLOR);

    const mark = page.getByRole("note", { name: "Slide comment 1: Make this a bar chart" });
    await expect.element(mark).toBeVisible();
    await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Remove slide comment 1" }).click();
    expect(draftOf(ref)?.previewAnnotations ?? []).toHaveLength(0);
    expect(draftOf(ref)?.images ?? []).toHaveLength(0);
    await expect.element(mark).not.toBeInTheDocument();
  });

  it("comments on a whole slide from the keyboard, and Escape discards the comment", async () => {
    const ref = threadRef("thread-slide-whole");
    await using _screen = await render(deck(ref));
    await page.getByRole("button", { name: "Comment on slides" }).click();

    const commentOnSlide = page.getByRole("button", { name: "Comment on slide 2" });
    commentOnSlide.element().focus();
    await userEvent.keyboard("{Enter}");
    const textbox = page.getByRole("textbox", { name: "Comment on slide 2" });
    await expect.element(textbox).toHaveFocus();
    await userEvent.keyboard("Discard me");
    await userEvent.keyboard("{Escape}");
    await expect.element(textbox).not.toBeInTheDocument();
    expect(draftOf(ref)?.previewAnnotations ?? []).toHaveLength(0);

    // A click without a drag also comments on the whole slide.
    await markSecondSlide({ x: 100, y: 100 }, { x: 101, y: 101 });
    await textbox.fill("Too much text on this slide");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    const [annotation] = draftOf(ref)?.previewAnnotations ?? [];
    expect(annotation?.comment).toBe("Too much text on this slide");
    expect(annotation?.regions).toEqual([]);
  });

  it("keeps an unfinished comment, commenting, and the slide across unmounts and reloads", async () => {
    const ref = threadRef("thread-slide-reload");
    {
      await using screen = await render(deck(ref));
      await page.getByRole("button", { name: "Go to slide 2" }).click();
      await page.getByRole("button", { name: "Comment on slides" }).click();
      await markSecondSlide({ x: 40, y: 40 }, { x: 240, y: 140 });
      await page.getByRole("textbox").fill("Unfinished");

      // A slide scrolled out of range unmounts its overlay; the comment waits for it.
      await screen.rerender(deck(ref, { showSecond: false }));
      await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
      await screen.rerender(deck(ref));
      await expect.element(page.getByRole("textbox")).toHaveValue("Unfinished");
    }

    // The agent rebuilt the deck: the file panel mounts a new viewer.
    await using _screen = await render(deck(ref));
    await expect.element(page.getByText("Showing slide 2")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Comment on slides" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("textbox")).toHaveValue("Unfinished");

    // Turning commenting off drops the unfinished comment for good.
    await page.getByRole("button", { name: "Comment on slides" }).click();
    await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Comment on slides" }).click();
    await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
    expect(draftOf(ref)?.previewAnnotations ?? []).toHaveLength(0);
  });

  it("keeps an unfinished comment with its own thread", async () => {
    const mine = threadRef("thread-slide-mine");
    const other = threadRef("thread-slide-other");
    const path = "/Users/me/work/shared.pptx";
    {
      await using _screen = await render(deck(mine, { path }));
      await page.getByRole("button", { name: "Comment on slides" }).click();
      await markSecondSlide({ x: 40, y: 40 }, { x: 240, y: 140 });
      await page.getByRole("textbox").fill("For my thread only");
    }

    // The same deck beside another thread neither shows nor overwrites it, even when that thread
    // comments, cancels, and turns commenting off.
    {
      await using _screen = await render(deck(other, { path }));
      await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
      await page.getByRole("button", { name: "Comment on slide 2" }).click();
      await expect.element(page.getByRole("textbox")).toHaveValue("");
      await page.getByRole("textbox").fill("Another thread's comment");
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Comment on slides" }).click();
      await page.getByRole("button", { name: "Comment on slides" }).click();
    }
    expect(draftOf(other)?.previewAnnotations ?? []).toHaveLength(0);

    await using _screen = await render(deck(mine, { path }));
    await expect.element(page.getByRole("textbox")).toHaveValue("For my thread only");
  });

  it("keeps decks at the same path on different machines apart", async () => {
    const laptop = threadRef("thread-slide-laptop", "environment-laptop");
    const server = threadRef("thread-slide-server", "environment-server");
    const path = "/Users/me/work/same-path.pptx";
    {
      await using _screen = await render(deck(laptop, { path }));
      await page.getByRole("button", { name: "Comment on slides" }).click();
      page.getByRole("group", { name: "Slide 3" }).element().scrollIntoView();
      await page.getByRole("button", { name: "Comment on slide 3" }).click();
      await page.getByRole("textbox").fill("On the laptop's deck");
    }

    // A shorter deck at the same path on another machine is a different deck.
    {
      await using _screen = await render(deck(server, { path, slideCount: 2 }));
      await expect
        .element(page.getByRole("button", { name: "Comment on slides" }))
        .toHaveAttribute("aria-pressed", "false");
    }

    await using _screen = await render(deck(laptop, { path }));
    await expect.element(page.getByRole("textbox")).toHaveValue("On the laptop's deck");
  });

  it("keeps an unfinished comment when its draft thread is first sent", async () => {
    const draftId = DraftId.make("draft-slide-promoted");
    const promoted = threadRef("thread-slide-promoted");
    const path = "/Users/me/work/promoted.pptx";
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(
        { environmentId: promoted.environmentId, projectId: ProjectId.make("project-1") },
        draftId,
        { threadId: promoted.threadId },
      );
    {
      await using _screen = await render(deck(draftId, { path }));
      await page.getByRole("button", { name: "Comment on slides" }).click();
      await markSecondSlide({ x: 40, y: 40 }, { x: 240, y: 140 });
      await page.getByRole("textbox").fill("Started in the draft");
    }

    await using _screen = await render(deck(promoted, { path }));
    await expect.element(page.getByRole("textbox")).toHaveValue("Started in the draft");
  });

  it("drops an unfinished comment on a slide the rebuilt deck no longer has", async () => {
    const ref = threadRef("thread-slide-removed");
    {
      await using _screen = await render(deck(ref));
      await page.getByRole("button", { name: "Comment on slides" }).click();
      page.getByRole("group", { name: "Slide 3" }).element().scrollIntoView();
      await page.getByRole("button", { name: "Comment on slide 3" }).click();
      await page.getByRole("textbox").fill("On a slide that goes away");
    }

    {
      await using _screen = await render(deck(ref, { slideCount: 2 }));
      await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
      await expect
        .element(page.getByRole("button", { name: "Comment on slide 2" }))
        .toBeInTheDocument();
    }

    // A later slide 3 is a different slide; the old comment does not come back.
    await using _screen = await render(deck(ref));
    await expect
      .element(page.getByRole("button", { name: "Comment on slide 3" }))
      .toBeInTheDocument();
    await expect.element(page.getByRole("textbox")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Comment on slide 2" }).click();
    await expect.element(page.getByRole("textbox", { name: "Comment on slide 2" })).toHaveValue("");
  });

  it("keeps the comment open when the composer refuses its screenshot", async () => {
    const ref = threadRef("thread-slide-full");
    const { addImage } = useComposerDraftStore.getState();
    useComposerDraftStore.setState({ addImage: () => false });
    try {
      await using _screen = await render(deck(ref));
      await page.getByRole("button", { name: "Comment on slides" }).click();
      await markSecondSlide({ x: 40, y: 40 }, { x: 240, y: 140 });
      await page.getByRole("textbox").fill("Bigger title");
      await page.getByRole("button", { name: "Add to chat" }).click();

      await expect
        .poll(() => document.querySelector('[role="alert"]')?.textContent)
        .toContain("The slide screenshot could not be attached.");
      await expect.element(page.getByRole("textbox")).toHaveValue("Bigger title");
      expect(draftOf(ref)?.previewAnnotations ?? []).toHaveLength(0);
    } finally {
      useComposerDraftStore.setState({ addImage });
    }
  });
});
