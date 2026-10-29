// Tangent(FORK-SLIDES-001): mark a region of a slide, comment on it, and add it to the composer.
import type { PreviewAnnotationPayload, PreviewAnnotationRect } from "@t3tools/contracts";
import { MessageSquarePlusIcon, XIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { create } from "zustand";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup } from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { useStableCallback } from "~/hooks/useStableCallback";
import { capturePreviewAnnotationScreenshot } from "~/lib/previewAnnotation";
import { randomUUID } from "~/lib/utils";

import { isCommentSubmitShortcut } from "../../diffs/commentSubmitShortcut";
import { FileSurfaceAction } from "../fileSurfaceChrome";
import { useDeckVersionSlot } from "./deckVersions";
import {
  annotatedSlideIndex,
  buildSlideAnnotation,
  canAnnotateDeck,
  captureSlideScreenshot,
  SLIDE_COMMENT_MAX_CHARS,
  slideMarkRect,
  type SlidePoint,
  type SlideSize,
} from "./slideAnnotation";

interface SlideAnnotationTarget {
  readonly composerTarget: ComposerThreadTarget;
  /** The deck's absolute path, which agents use to find the file. */
  readonly path: string;
}

const SlideAnnotationContext = createContext<SlideAnnotationTarget | null>(null);

/** Presentations under this provider can add slide comments to the composer for the deck at `path`. */
export function SlideAnnotationProvider(
  props: SlideAnnotationTarget & { readonly children: ReactNode },
) {
  const target = canAnnotateDeck(props.path)
    ? { composerTarget: props.composerTarget, path: props.path }
    : null;
  return <SlideAnnotationContext value={target}>{props.children}</SlideAnnotationContext>;
}

interface SlideDraft {
  readonly slideIndex: number;
  readonly mark: PreviewAnnotationRect | null;
  readonly comment: string;
}

/**
 * One deck's view, kept outside the viewer because a rebuilt deck is a new viewer and slides unmount
 * offscreen. Keyed by environment and path; unfinished comments are keyed by thread, since several
 * threads can show the same deck.
 */
interface SlideView {
  readonly active: boolean;
  readonly page: number;
  readonly drafts: Readonly<Record<string, SlideDraft>>;
}

const EMPTY_VIEW: SlideView = { active: false, page: 0, drafts: {} };

const useSlideViewStore = create<{
  readonly views: Readonly<Record<string, SlideView>>;
  readonly update: (key: string, patch: Partial<Omit<SlideView, "drafts">>) => void;
  readonly setDraft: (key: string, owner: string, draft: SlideDraft | null) => void;
  /** Drops unfinished comments on slides a rebuilt deck no longer has. */
  readonly prune: (key: string, slideCount: number) => void;
}>()((set) => {
  const edit = (key: string, change: (view: SlideView) => SlideView) =>
    set((state) => ({ views: { ...state.views, [key]: change(state.views[key] ?? EMPTY_VIEW) } }));
  return {
    views: {},
    update: (key, patch) => edit(key, (view) => ({ ...view, ...patch })),
    setDraft: (key, owner, draft) =>
      edit(key, (view) => {
        const { [owner]: _previous, ...drafts } = view.drafts;
        return { ...view, drafts: draft ? { ...drafts, [owner]: draft } : drafts };
      }),
    prune: (key, slideCount) =>
      set((state) => {
        const view = state.views[key];
        const kept = Object.entries(view?.drafts ?? {}).filter(
          ([, draft]) => draft.slideIndex < slideCount,
        );
        if (!view || kept.length === Object.keys(view.drafts).length) return state;
        return { views: { ...state.views, [key]: { ...view, drafts: Object.fromEntries(kept) } } };
      }),
  };
});

function useSlideView<T>(key: string, select: (view: SlideView) => T): T {
  return useSlideViewStore((state) => select(state.views[key] ?? EMPTY_VIEW));
}

/** This thread's unfinished comment, while its slide exists; the toolbar prunes the rest on load. */
function liveDraft(view: SlideView, owner: string, slideCount: number): SlideDraft | null {
  const draft = view.drafts[owner];
  return draft && draft.slideIndex < slideCount ? draft : null;
}

type DraftThreads = Readonly<Record<string, { environmentId: string; threadId: string }>>;

/** The thread a composer belongs to. A draft thread keeps its thread ID when it is first sent. */
function composerOwner(draftThreads: DraftThreads, target: ComposerThreadTarget): string {
  if (typeof target !== "string") return `${target.environmentId}:${target.threadId}`;
  const session = draftThreads[target];
  return session ? `${session.environmentId}:${session.threadId}` : target;
}

/** Decks on different machines can share a path, so view state is per environment. */
function composerEnvironment(draftThreads: DraftThreads, target: ComposerThreadTarget): string {
  return typeof target === "string"
    ? (draftThreads[target]?.environmentId ?? "")
    : target.environmentId;
}

export interface SlideAnnotationMode {
  /** Null when the deck is not open beside a composer, as for chat attachments. */
  readonly target: SlideAnnotationTarget | null;
  /** Identifies the deck's view state. */
  readonly key: string;
  /** Identifies the thread that unfinished comments belong to. */
  readonly owner: string;
}

/** Holds no view state itself, so the presentation does not rerender while a comment is typed. */
export function useSlideAnnotationMode(): SlideAnnotationMode {
  const target = useContext(SlideAnnotationContext);
  const owner = useComposerDraftStore((store) =>
    target ? composerOwner(store.draftThreadsByThreadKey, target.composerTarget) : "",
  );
  const environment = useComposerDraftStore((store) =>
    target ? composerEnvironment(store.draftThreadsByThreadKey, target.composerTarget) : "",
  );
  return { target, key: target ? `${environment}\u0000${target.path}` : "", owner };
}

/** Whether this thread has an unfinished comment on the deck. */
export function useSlideCommentOpen(mode: SlideAnnotationMode): boolean {
  return useSlideView(mode.key, (view) => view.drafts[mode.owner] !== undefined);
}

/** Whether the slide list has `row` where the restore puts it: 24px below the top, or at the end. */
function slideLanded(pages: HTMLElement, row: HTMLElement, slideCount: number) {
  const offset = row.getBoundingClientRect().top - pages.getBoundingClientRect().top;
  const allMounted = pages.querySelectorAll('[role="group"]').length >= slideCount;
  const atEnd = pages.scrollTop + pages.clientHeight >= pages.scrollHeight - 1;
  return Math.abs(offset - 24) <= 2 || (allMounted && atEnd);
}

/**
 * The commenting toggle. It also returns a reloaded deck to the slide it showed before, and
 * remembers the slide shown since. A version loading behind the shown one follows that slide, and
 * says it is ready once the slide is painted.
 */
export function SlideAnnotationToggle(props: {
  readonly mode: SlideAnnotationMode;
  readonly page: number;
  readonly slideCount: number;
  readonly onRestore: (index: number) => void;
}) {
  if (!props.mode.target) return null;
  return <SlideAnnotationToolbar {...props} />;
}

function SlideAnnotationToolbar(props: {
  readonly mode: SlideAnnotationMode;
  readonly page: number;
  readonly slideCount: number;
  readonly onRestore: (index: number) => void;
}) {
  const { mode, page, slideCount } = props;
  const version = useDeckVersionSlot();
  const hidden = version?.hidden ?? false;
  const followed = useSlideView(mode.key, (view) => (hidden ? view.page : 0));
  const active = useSlideView(mode.key, (view) => view.active);
  const update = useSlideViewStore((state) => state.update);
  const setDraft = useSlideViewStore((state) => state.setDraft);
  const prune = useSlideViewStore((state) => state.prune);
  const onRestore = useStableCallback(props.onRestore);
  const onReady = useStableCallback(() => version?.onReady());
  const anchor = useRef<HTMLSpanElement>(null);
  const restored = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Drop unfinished comments on slides this version of the deck does not have.
  useEffect(() => {
    if (!hidden) prune(mode.key, slideCount);
  }, [hidden, mode.key, slideCount, prune]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scroll a reopened deck back to its remembered slide once the slide list can reach it, unless the user navigates first.
  useEffect(() => {
    if (restored.current && !hidden) return;
    restored.current = false;
    const remembered = hidden
      ? followed
      : (useSlideViewStore.getState().views[mode.key]?.page ?? 0);
    const index = Math.min(remembered, slideCount - 1);
    // The toolbar shares the presentation's root with the slide list.
    const root = anchor.current?.parentElement?.parentElement;
    const pages = root?.querySelector(":scope > [data-office-pages]");
    if ((index <= 0 && !hidden) || !root || !(pages instanceof HTMLElement)) {
      restored.current = true;
      return;
    }
    const loop = { frame: 0, tries: 0 };
    const stop = () => {
      restored.current = true;
      cancelAnimationFrame(loop.frame);
    };
    const attempt = () => {
      const row = pages.querySelector(`[role="group"][aria-label="Slide ${index + 1}"]`);
      if (row instanceof HTMLElement && row.offsetHeight > 0) {
        onRestore(index);
        // OfficePages scrolls a slide to 24px below the top, which needs the slides after it
        // mounted; it mounts them in batches, so keep scrolling until the slide lands.
        if (slideLanded(pages, row, slideCount)) return stop();
      }
      loop.tries += 1;
      if (loop.tries < 240) loop.frame = requestAnimationFrame(attempt);
      else stop();
    };
    // The user's own navigation wins over a restore still in progress.
    const interrupts = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const type of interrupts) root.addEventListener(type, stop, { passive: true });
    loop.frame = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(loop.frame);
      for (const type of interrupts) root.removeEventListener(type, stop);
    };
  }, [followed, hidden, mode.key, slideCount, onRestore]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Remember the slide shown, once the remembered one has been restored.
  useEffect(() => {
    if (restored.current && !hidden) update(mode.key, { page });
  }, [hidden, mode.key, page, update]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll this hidden version's slide list, which reports no paint, until the followed slide is drawn.
  useEffect(() => {
    if (!hidden) return;
    const pages = anchor.current?.parentElement?.parentElement?.querySelector(
      ":scope > [data-office-pages]",
    );
    if (!(pages instanceof HTMLElement)) return;
    const index = Math.min(followed, slideCount - 1);
    let drawn = false;
    const timer = setInterval(() => {
      const row = pages.querySelector(`[role="group"][aria-label="Slide ${index + 1}"]`);
      const canvas = row?.querySelector("canvas");
      const landed = row instanceof HTMLElement && slideLanded(pages, row, slideCount);
      // A slide that cannot be drawn shows that instead of its canvas, and is as ready as it gets.
      const settled =
        landed && ((canvas && canvas.width > 0) || row.querySelector('[role="status"]'));
      // A new canvas has a default size until OfficePages clears it, so one sighting proves nothing.
      if (settled && drawn) {
        clearInterval(timer);
        onReady();
      }
      drawn = Boolean(settled);
    }, 50);
    return () => clearInterval(timer);
  }, [followed, hidden, onReady, slideCount]);
  return (
    <span ref={anchor} className="contents">
      <FileSurfaceAction
        label="Comment on slides"
        pressed={active}
        onPress={() => {
          update(mode.key, { active: !active });
          setDraft(mode.key, mode.owner, null);
        }}
      >
        <MessageSquarePlusIcon className="size-3.5" />
      </FileSurfaceAction>
    </span>
  );
}

/** Shows the slide's pending comments and, while commenting, turns drags into new ones. */
export function SlideAnnotationLayer(props: {
  readonly mode: SlideAnnotationMode;
  readonly index: number;
  readonly slides: readonly SlideSize[];
}) {
  const slide = props.slides[props.index];
  const version = useDeckVersionSlot();
  if (!props.mode.target || !slide || version?.hidden) return null;
  return (
    <SlideAnnotationSurface
      target={props.mode.target}
      viewKey={props.mode.key}
      owner={props.mode.owner}
      index={props.index}
      slide={slide}
      slideCount={props.slides.length}
    />
  );
}

type Drag = { readonly pointerId: number; readonly start: SlidePoint; readonly end: SlidePoint };

const NO_ANNOTATIONS: readonly PreviewAnnotationPayload[] = [];

function SlideAnnotationSurface(props: {
  readonly target: SlideAnnotationTarget;
  readonly viewKey: string;
  readonly owner: string;
  readonly index: number;
  readonly slide: SlideSize;
  readonly slideCount: number;
}) {
  const { target, viewKey, owner, index, slide, slideCount } = props;
  const layer = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useSlideView(viewKey, (view) => view.active);
  const drafting = useSlideView(viewKey, (view) => liveDraft(view, owner, slideCount) !== null);
  const draft = useSlideView(viewKey, (view) => {
    const live = liveDraft(view, owner, slideCount);
    return live?.slideIndex === index ? live : null;
  });
  const setDraft = useSlideViewStore((state) => state.setDraft);
  const annotations = useComposerDraftStore(
    (store) => store.getComposerDraft(target.composerTarget)?.previewAnnotations ?? NO_ANNOTATIONS,
  );
  const pending = annotations.filter(
    (annotation) => annotatedSlideIndex(annotation, target.path) === index,
  );
  const addPreviewAnnotation = useComposerDraftStore((store) => store.addPreviewAnnotation);
  const addImage = useComposerDraftStore((store) => store.addImage);
  const removePreviewAnnotation = useComposerDraftStore((store) => store.removePreviewAnnotation);
  if (!active && drag) setDrag(null);

  const toSlidePoint = (event: PointerEvent<HTMLDivElement>): SlidePoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * slide.width,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * slide.height,
    };
  };
  const startDraft = (mark: PreviewAnnotationRect | null) => {
    setError(null);
    setDraft(viewKey, owner, { slideIndex: index, mark, comment: "" });
  };
  const cancel = () => {
    setError(null);
    setDraft(viewKey, owner, null);
  };
  const submit = () => {
    const text = draft?.comment.trim();
    if (!draft || !text) return;
    const annotation = buildSlideAnnotation({
      id: randomUUID(),
      path: target.path,
      slideIndex: index,
      slideCount,
      comment: text,
      mark: draft.mark,
      screenshot: screenshotOf(layer.current, slide, draft.mark),
      createdAt: new Date().toISOString(),
    });
    // Mirror browser preview annotations: a crop that cannot be decoded is dropped, never claimed.
    const capture = capturePreviewAnnotationScreenshot(annotation);
    const kept = capture.status === "failed" ? { ...annotation, screenshot: null } : annotation;
    addPreviewAnnotation(target.composerTarget, kept);
    if (capture.status === "captured" && kept.screenshot) {
      const attached = addImage(target.composerTarget, {
        type: "image",
        id: kept.id,
        name: capture.file.name,
        mimeType: capture.file.type,
        sizeBytes: capture.file.size,
        previewUrl: kept.screenshot.dataUrl,
        file: capture.file,
      } satisfies ComposerImageAttachment);
      // Without its screenshot the agent cannot see which region was marked, so keep the draft.
      if (!attached) {
        removePreviewAnnotation(target.composerTarget, kept.id);
        setError("The slide screenshot could not be attached. Remove an attachment and try again.");
        return;
      }
    }
    cancel();
  };

  const dragMark = drag ? slideMarkRect(drag.start, drag.end, slide) : null;
  return (
    <div
      ref={layer}
      data-slide-annotation-layer
      className={
        active && !drafting ? "absolute inset-0 cursor-crosshair touch-none" : "absolute inset-0"
      }
      onPointerDown={(event) => {
        if (!active || drafting || drag || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = toSlidePoint(event);
        setDrag({ pointerId: event.pointerId, start: point, end: point });
      }}
      onPointerMove={(event) => {
        if (drag?.pointerId !== event.pointerId) return;
        setDrag({ ...drag, end: toSlidePoint(event) });
      }}
      onPointerUp={(event) => {
        if (drag?.pointerId !== event.pointerId) return;
        setDrag(null);
        startDraft(slideMarkRect(drag.start, toSlidePoint(event), slide));
      }}
      onPointerCancel={(event) => {
        if (drag?.pointerId === event.pointerId) setDrag(null);
      }}
    >
      {pending.map((annotation, position) => (
        <PendingSlideMark
          key={annotation.id}
          annotation={annotation}
          number={position + 1}
          slide={slide}
          onRemove={() => removePreviewAnnotation(target.composerTarget, annotation.id)}
        />
      ))}
      {dragMark ? (
        <div
          className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10"
          style={markStyle(dragMark, slide)}
        />
      ) : null}
      {active && !drafting ? (
        // Keyboard users, and anyone who prefers a button, comment on the whole slide here.
        <div
          className="absolute right-2 bottom-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button size="xs" variant="outline" onClick={() => startDraft(null)}>
            <MessageSquarePlusIcon />
            Comment on slide {index + 1}
          </Button>
        </div>
      ) : null}
      {draft ? (
        <>
          <div
            ref={markRef}
            className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/10"
            style={draft.mark ? markStyle(draft.mark, slide) : WHOLE_SLIDE}
          />
          <Popover
            open
            onOpenChange={(open, details) => {
              // Only Escape discards; clicking elsewhere, such as into the deck, keeps the comment.
              if (!open && details.reason === "escape-key") cancel();
            }}
          >
            <PopoverPopup
              anchor={markRef}
              side={draft.mark ? "bottom" : "top"}
              align="start"
              width="md"
              padding="compact"
            >
              <Textarea
                autoFocus
                size="sm"
                value={draft.comment}
                maxLength={SLIDE_COMMENT_MAX_CHARS}
                placeholder={
                  draft.mark ? "What should change here?" : "What should change on this slide?"
                }
                aria-label={`Comment on slide ${index + 1}`}
                onChange={(event) =>
                  setDraft(viewKey, owner, { ...draft, comment: event.target.value })
                }
                onKeyDown={(event) => {
                  if (isCommentSubmitShortcut(event, draft.comment, false)) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              {error ? (
                <p role="alert" className="mt-1.5 text-xs text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="mt-1.5 flex items-center gap-1">
                <span className="mr-auto text-3xs text-muted-foreground/70">
                  ⌘/Ctrl Enter to add
                </span>
                <Button variant="ghost-muted" size="xs" onClick={cancel}>
                  Cancel
                </Button>
                <Button size="xs" disabled={!draft.comment.trim()} onClick={submit}>
                  Add to chat
                </Button>
              </div>
            </PopoverPopup>
          </Popover>
        </>
      ) : null}
    </div>
  );
}

function PendingSlideMark(props: {
  readonly annotation: PreviewAnnotationPayload;
  readonly number: number;
  readonly slide: SlideSize;
  readonly onRemove: () => void;
}) {
  const rect = props.annotation.regions[0]?.rect;
  return (
    <div
      role="note"
      aria-label={`Slide comment ${props.number}: ${props.annotation.comment}`}
      className="pointer-events-none absolute rounded-sm border-2 border-dashed border-primary/80"
      style={rect ? markStyle(rect, props.slide) : WHOLE_SLIDE}
    >
      {/* The layer captures pointers to draw marks; the label keeps its own clicks. */}
      <div
        className="pointer-events-auto absolute top-0 left-0 flex max-w-64 items-center gap-1 rounded-br-md bg-primary py-0.5 ps-1.5 pe-0.5 text-2xs text-primary-foreground"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="font-medium tabular-nums">{props.number}</span>
        <Tooltip>
          <TooltipTrigger
            render={<span className="min-w-0 truncate">{props.annotation.comment}</span>}
          />
          <TooltipPopup side="top">{props.annotation.comment}</TooltipPopup>
        </Tooltip>
        <button
          type="button"
          aria-label={`Remove slide comment ${props.number}`}
          className="flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-primary-foreground/20"
          onClick={props.onRemove}
        >
          <XIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}

const WHOLE_SLIDE: CSSProperties = { inset: 0 };

const percent = (value: number, total: number) => `${(value / Math.max(1, total)) * 100}%`;

function markStyle(rect: PreviewAnnotationRect, slide: SlideSize): CSSProperties {
  return {
    left: percent(rect.x, slide.width),
    top: percent(rect.y, slide.height),
    width: percent(rect.width, slide.width),
    height: percent(rect.height, slide.height),
  };
}

/** The slide's canvas is the layer's sibling in the page OfficePages draws. */
function screenshotOf(
  layer: HTMLDivElement | null,
  slide: SlideSize,
  mark: PreviewAnnotationRect | null,
) {
  const canvas = layer?.parentElement?.querySelector(":scope > canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const color =
    getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#2563eb";
  try {
    return captureSlideScreenshot(canvas, slide, mark, color);
  } catch {
    return null;
  }
}
