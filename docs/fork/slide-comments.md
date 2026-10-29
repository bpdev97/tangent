# FORK-SLIDES-001: Slide comments

## Why

Agents build slide decks, for example with Anthropic's `pptx` skill, and the file viewer shows
`.pptx` files with upstream's in-browser renderer. Reviewing a deck still meant describing every
change in words ("the chart on slide 4, the one on the right"). Tangent lets the user mark a region
of a slide, write what should change, and hand that to the agent with a screenshot, the way the
desktop browser preview already annotates web pages.

## Behavior

- The `Comment on slides` toggle sits in the presentation viewer's slide toolbar. While it is on,
  dragging on a slide marks a region, and a click or each slide's `Comment on slide N` button
  (the keyboard path) comments on the whole slide. A popover asks what should change. `Add to chat`
  (or Command/Control-Enter) adds the comment; Escape or `Cancel` discards it, and so does turning
  the toggle off. Clicking elsewhere keeps it. Only the toolbar opens commenting; there is no
  keybinding or command palette entry.
- A comment is an ordinary preview annotation in the composer draft, so chips, the agent prompt,
  stashing, and queued edits need no new code. Its page URL is the deck's absolute path plus
  `#slide=N`, its title is `Slide N of M in <file>`, and a marked region is its one region, in
  slide pixels. Comments are capped at the context's 8,000 characters, and a deck whose path would
  make the URL longer than the context's 2,048 characters cannot be commented on.
- The screenshot is the whole painted slide with the region outlined in the theme's primary color,
  at most 1280 pixels on its longest side, which keeps it far below the 10 MiB image limit. It is
  attached as the annotation's image, so removing the chip removes it too. A slide that has not
  painted, or a capture that fails, sends the comment without a screenshot. If the composer refuses
  the image (its attachment limit), the comment is not added and the popover says so.
- Pending comments for the open deck show on their slides as dashed outlines with a numbered label
  and a remove button. They are read from the composer draft, so removing the chip removes the
  outline, and the outline's remove button removes the chip.
- The file panel remounts the viewer whenever the agent changes the workspace or a draft thread
  becomes a real one, and slides unmount as they scroll away. Commenting and the slide shown
  therefore live in a small in-memory store keyed by environment and deck path, so a rebuilt deck reopens at
  the same slide, still commenting. After a reload the toolbar scrolls back to the remembered slide
  once the slide list can reach it (OfficePages mounts slides in batches), and stops as soon as the
  user scrolls, clicks, or types. The store is not persisted.
- Unfinished comments live in the same store, one per thread: the same deck open beside another
  thread neither shows nor clears them, and a draft thread's comment survives its first send,
  because the draft already carries its future thread ID. When a rebuilt deck loads, comments on
  slides it no longer has are dropped.
- Only workspace and linked files opened in the file panel beside a composer can be commented on.
  Chat attachments cannot, and mobile has no presentation viewer. Drafts are per device, so
  comments appear on mobile only in sent messages, as chips.

## Upstream hooks

Each hook is marked `Tangent(FORK-SLIDES-001)`.

- `apps/web/src/components/files/office/Presentation.tsx`: the import, one
  `useSlideAnnotationMode()` call, the toggle at the end of the slide toolbar (given the shown
  slide, the slide count, and `select` to restore the remembered slide), and the layer in the slide
  overlay.
- `apps/web/src/components/files/FilePreviewPanel.tsx`: the import, and the workspace document
  branch renders `SlideAnnotatedFilePreview` instead of `AttachmentFilePreview` with two extra
  props: the composer target and the absolute path.
- `docs/README.md`: the link to the user guide.

Fork-owned: `apps/web/src/components/files/SlideAnnotatedFilePreview.tsx`,
`apps/web/src/components/files/office/SlideAnnotations.tsx`,
`apps/web/src/components/files/office/slideAnnotation.ts`, their tests, and
`docs/user/slide-comments.md`.

## Resolving conflicts

- `Presentation.tsx`: take upstream's version and re-add the four hook lines. The layer belongs
  inside the per-slide `overlay`, which OfficePages renders over the slide's canvas; the layer finds
  the canvas as its sibling. If upstream stops drawing slides on a canvas in that container, update
  `screenshotOf` in `SlideAnnotations.tsx`. Restoring the slide looks for the slide list
  (`data-office-pages`) beside the toolbar and its `Slide N` rows; keep that lookup in step with
  `OfficePages.tsx`.
- `FilePreviewPanel.tsx`: take upstream's version and swap the workspace document branch's
  `AttachmentFilePreview` for `SlideAnnotatedFilePreview` again. Do not wrap the element in a
  provider; the formatter re-indents the whole block.
- If upstream changes `PreviewAnnotationPayload`, update `buildSlideAnnotation` and keep the page
  URL format, which agents and the pending outlines both read.

## Never

- Never add a contract, server, or provider change for this feature. Comments travel as preview
  annotations.
- Never write comments into the `.pptx` file. They are instructions for the agent, not PowerPoint
  review comments.

## Remove when

Upstream lets users annotate rendered documents in the file viewer and send the annotations to the
composer. Adopt upstream's version and delete the fork files and hooks.

## Verify

```sh
vp test run apps/web/src/components/files/office/slideAnnotation.test.ts apps/web/src/components/files/office/SlideAnnotations.browser.test.tsx
```

Plus one web or desktop pass with a real deck: open a `.pptx` from the workspace, mark a region on
one slide and comment on another whole slide, check the chips and outlines, remove one from each
side, and send the other to confirm the agent receives the slide path and screenshot. Then let the
agent rebuild the deck and check that the viewer stays on the same slide, still commenting.
