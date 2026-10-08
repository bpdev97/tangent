# FORK-WALK-001: Guided diff walkthroughs

## Why

Reviewing an agent's change file by file buries the one file the change is really about under
whichever directory sorts first. Linear's guided reviews and similar tools solve this by letting the
author (here, the agent) order the diff into sections that each explain why a group of files
changed. Upstream has no way for an agent to publish such structure; an HTML render cannot reach the
app's diff renderer, so it would have to retype the diff, badly, into a frame that scrolls inside
the thread.

## Behavior

- Agents on every provider publish a walkthrough with the `walkthrough_publish` MCP tool: a title,
  a summary of what the whole change does, a scope (`branch` with an optional base ref, or
  `turn`), and ordered sections of title, one paragraph, an attention level (`review`, `skim`,
  `trust`) with a reason, and the files they cover. A file may carry flags with a severity
  (`blocker`, `question`, `nit`, `note`) anchored to a new-side line.
- The thread shows a compact card: the summary first, then the sections in reading order with
  their attention chip, flag counts, and the blockers and questions listed under each. The diffs
  are never in the card.
- Opening a section (or a flag) opens the diff panel on the walkthrough's diff (Changes with that
  base, or the turn) with the section's counter, title, attention, paragraph, and files above the
  viewer, and the viewer and file tree narrowed to that section's files. Flags appear under their
  lines in severity colours; a flag opened from the card scrolls to its line. Previous/next move
  between sections; the close mark returns to the full diff.
- Line comments work as in any diff and go to the composer, naming the section in their context.
  When the thread has a linked pull request, the draft also offers "Add to PR review", which puts
  the comment in the PR panel's pending review, to be sent with the rest. The position comes from
  the pull request's own diff (its first page is loaded while a section is open on such a thread),
  and only when that diff has the same text at that line; a line the pull request lacks or has
  elsewhere is refused with a reason, since a comment placed by local line number would land on
  whatever the host has at that number. A renamed file carries its old name for hosts that need it.
- The server records the head commit and time at publish. When another turn completes after that
  time, the header shows "branch moved" so the reader knows to ask for an update; the publishing
  turn's own completion does not count.
- An update is a full republish with `replaces` naming the earlier walkthrough's id, which the
  tool result hands back. The earlier card collapses to one line; the newest carries the reading,
  and a reader who has the earlier one open is moved onto the new one at the same section.
- A walkthrough reads only while the panel shows the diff it was written against. Ordinary diff
  navigation ends the reading: another turn, Uncommitted, or a changed-files link to a file the
  section does not cover shows the plain diff, and the card can reopen the section. A turn
  walkthrough published while that turn is still running waits (the header says so) until the
  turn's checkpoint exists, then selects it once; after that the reader's selection wins.
- Mobile has no walkthrough card. The tool result and the agent instructions ask for a short text
  summary of the sections and blockers after publishing, so the thread still reads there.
- A file the diff no longer contains is listed struck through, so a walkthrough written before a
  rebase still reads.
- The reference travels in the compact tool output with its own 32 KB cap, so it survives the
  projection the way `html_render`'s reference does without a second storage path. The compact
  reader's parse budget is raised from 16 KiB to 200 KB for this, since every serialized envelope
  level is charged again; every other key keeps its 8 KiB trim.
- Diagrams: `walkthrough_visual` stores a self-contained HTML page through the same service as
  `html_render` but under its own tool name, so nothing appears in the thread; the agent attaches
  the returned reference to the walkthrough (shown with the summary in the card) or to a section
  (shown above its files, hideable). Deleting the thread removes them with the other renders.
- The review policy, how to order, grade, flag, draw, and update, is not fork code. The server
  reads `<state dir>/walkthrough-policy.md` at startup (`~/.bpdev-code/userdata` for the live
  install) and puts it in `walkthrough_publish`'s description, which every provider reads. The file
  is written with the shipped default on first start; edit it and restart the server to tune
  reviews. The agent instructions only say to call the tool and follow its policy.

## Upstream hooks

Each hook is marked `Tangent(FORK-WALK-001)`.

- `packages/shared/src/toolOutput.ts` (+ test): the raised parse budget, keeps `walkthrough` in
  the compact output, and exports `walkthroughFromToolItem`.
- `packages/shared/src/t3McpToolPresentation.ts`: tool labels and the `walkthrough` summary action.
- `packages/shared/package.json`: the `./walkthrough` export.
- `packages/client-runtime/src/t3ToolSummary.ts`: the summary phrase.
- `apps/server/src/mcp/McpHttpServer.ts`: registers the toolkit, built from the policy file, with
  the fork's `WalkthroughService` (the publish logic; handlers only decode and map errors).
- `apps/server/src/attachmentStore.ts`: counts stored diagrams among a thread's renders for cleanup.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` (+ test): read-only allowlist.
- `apps/server/src/mcp/toolkits/core.test.ts`: the toolkit in the unique-name check.
- `apps/server/src/provider/T3OrchestrationInstructions.ts`: when agents should publish one, and
  the text summary that clients without the card rely on.
- `apps/web/src/session-logic.ts`, `components/chat/MessagesTimeline.logic.ts`,
  `components/chat/MessagesTimeline.tsx`: the `walkthrough` entry, row, and card, and one
  `useWalkthroughFollow` call that moves a reader onto a replacement.
- `apps/web/src/components/ChatView.tsx`: `onOpenWalkthrough` calls the store's `openWalkthrough`
  and opens the panel.
- `apps/web/src/components/DiffPanel.tsx`: one `useWalkthroughMode` call and one
  `useWalkthroughReveal` call, and their results at the file list, the stats, the loading footer,
  the header slot (also in the "No completed turns yet" state, for the waiting header), and the
  viewer's `sectionTitle`/`notes`/`draftSecondaryAction` props; the viewer's mount key also carries
  the section being read, so a section change drops a comment draft on a file it no longer shows. The lazy reveal also looks files up in the
  unfiltered source list. The logic itself lives in `components/walkthrough/useWalkthroughMode.tsx`
  and the pure decisions in `walkthroughMode.logic.ts`.
- `apps/web/src/components/diffs/AnnotatableCodeView.tsx`: the `notes` and `draftSecondaryAction`
  props, the `note` entry kind with its severity, and one `walkthroughFlagAnnotations` call.

Another fork feature's files (FORK-HERMES-001), since Hermes lists the `t3-code` tools itself
instead of attaching the MCP server:

- `apps/server/src/provider/hermes/HermesT3Tools.ts` (+ test): the `walkthrough` entry in
  `HERMES_T3_TOOLKITS`, built from the policy passed in `HermesT3ToolOptions`.
- `apps/server/src/provider/hermes/HermesDriver.ts`: reads the policy file and passes it to the
  bridge, so a tuned policy reaches Hermes threads after a server restart like every other provider.

Fork-owned: `packages/shared/src/walkthrough.ts`, `apps/server/src/mcp/toolkits/walkthrough/`,
`apps/web/src/walkthroughStore.ts`, `apps/web/src/components/walkthrough/`, and their tests.

## Resolving conflicts

- Take upstream's `DiffPanel.tsx` and re-add the `useWalkthroughMode` call after the lazy patch
  hook, feed `walkthrough.visibleFiles` into the entries, tree, and stats, render
  `walkthrough.renderHeader(revealDiffFile)` above the viewer, and pass the `notes`/`sectionTitle`
  props. Everything else is in the hook.
- Take upstream's timeline files and re-add the `walkthrough` cases beside the `html-render` ones;
  they are shaped identically.
- If upstream changes `compactDynamicToolOutput`, keep the walkthrough key outside the generic
  8 KB check and the parse budget above the walkthrough cap; the reference has its own cap in
  `readWalkthroughReference`.
- If upstream changes how pull request review drafts resolve their position, keep
  `pullRequestReviewTarget.ts` resolving against the pull request's parsed `sourceFiles` with the
  line-text check; the local diff is never the source of a host position.

## Never

- Never put diff text in the card or the tool input; the panel renders the live diff.
- Never edit a published walkthrough in place; an update is a new card that replaces the old one.
- Never put review methodology in fork code; it belongs in the policy file so it can change without
  a release.
- Never persist the active walkthrough across sessions; the card is the durable record.

## Remove when

Upstream ships guided or sectioned review in the diff panel, or an agent-publishable structure the
panel can read.

## Verify

```sh
vp test run packages/shared/src/walkthrough.test.ts packages/shared/src/toolOutput.test.ts apps/server/src/mcp/toolkits/walkthrough apps/server/src/mcp/toolkits/core.test.ts apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts apps/web/src/walkthroughStore.test.ts apps/web/src/components/walkthrough
```

Plus one pass in the web client: ask an agent for a walkthrough of a branch, open a section, and
confirm the panel narrows to its files, the note shows under its line, and a line comment reaches
the composer with the section's title.
