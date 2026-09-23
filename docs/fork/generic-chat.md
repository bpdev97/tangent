# FORK-CHAT-001: generic chats

## Why

Upstream threads always belong to a project, but many conversations have nothing to do with a
repository: questions, writing, planning, quick lookups. Tangent adds chats with no project
attached. Chats keep the terminal, which is useful for general tasks, but hide files and Git,
because there is no user project behind them.

Chats use a managed project rather than a thread without a project. That keeps upstream's
invariants intact: every thread still has a project, and every provider session still gets a
real working directory.

## Behavior

- Every server keeps one managed project with the reserved ID `t3code-generic-chat`, titled
  `Chats`. The reserved ID is the capability marker, and it groups the same logical `Chats` entry
  across environments.
- Startup creates or repairs the managed project idempotently. It never deletes threads or
  replaces the project's model preference. The project cannot be deleted, because its reserved ID
  could never be created again.
- The project's working directory is app-owned scratch space at
  `<baseDir>/workspaces/generic-chat`. It is not user content and is never shown as a workspace.
- Every turn sent to a provider is wrapped with short, factual context: no user project or
  repository is attached, and the working directory is app-owned scratch space. The context does
  not direct tool use or replace the provider's own instructions and approval behavior. The stored
  user message is unchanged, and attachment-only turns still get the context. Slash commands such
  as `/compact` pass through verbatim so T3 and provider commands keep working.
- New chat threads use `approval-required`.
- Checkpoints never run for chats. v2 skips checkpoints outside Git, but Git detection walks up the
  tree, and in development the scratch directory sits inside the worktree's `.t3`. The checkpoint
  store therefore reports the managed project's workspace as not a repository.
- The managed project is not evidence of user setup, so it does not skip the first-run wizard, and
  a plain new thread defaults to a user project rather than `Chats`.
- Web and mobile show `Chats` as a destination with a new-chat action. Chat threads hide files,
  diffs, Git, worktrees, branches, and project scripts, and those routes are guarded against deep
  links and keyboard shortcuts. The terminal remains available.
- Existing-thread capability comes from `thread.projectId`, because the project catalog can arrive a
  render later and must not briefly enable project tools.
- Conversation presentation is upstream's; chats have no separate message grouping.

## Upstream hooks

Fork logic lives in `packages/shared/src/genericChat.ts` (reserved ID, predicates, provider
context), `apps/server/src/genericChat.ts` (startup ensure, turn text, checkpoint guard),
`apps/web/src/lib/genericChat.ts` (right-panel guard),
`apps/web/src/components/sidebar/SidebarChatsEntry.tsx`,
`apps/mobile/src/features/threads/ProjectThreadRouteGuard.tsx`, and
`apps/mobile/src/features/home/useGenericChatHeaderItem.ts`. Each upstream hook is marked
`Tangent(FORK-CHAT-001)`:

Server:

- `apps/server/src/serverRuntimeStartup.ts`: the `generic-chat.ensure` startup phase after
  recovery.
- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`: wraps `userText`, the one value
  that feeds both the provider turn and context-handoff delivery.
- `apps/server/src/orchestration-v2/runtimeLayer.ts`: the checkpoint service gets the guarded
  checkpoint store.
- `apps/server/src/project/ProjectService.ts`: `delete` refuses the reserved ID.

Shared client:

- `packages/client-runtime/src/state/projectGrouping.ts`: `deriveLogicalProjectKey` maps the
  reserved ID to one logical key, so web and mobile group every server's `Chats` together.
- `packages/shared/package.json`: the `./genericChat` export.

Web:

- `apps/web/src/components/Sidebar.tsx`: renders `SidebarChatsEntry` under the header. The
  destination is the sidebar's project scope set to the `Chats` group.
- `apps/web/src/components/ChatView.tsx`: `genericChat` from `thread.projectId` hides scripts, the
  Git working directory, Git status, open-in-editor, and the files tab, and mounts the right-panel
  guard. The terminal is untouched.
- `apps/web/src/components/BranchToolbar.tsx`: the thread panel's workspace and branch section
  renders nothing for chats.
- `apps/web/src/hooks/useActiveProjectTarget.ts`: no file picker or content search target in a
  chat.
- `apps/web/src/hooks/useHandleNewThread.ts`: new chats default to `approval-required`; the
  default project for a plain new thread skips `Chats`.
- `apps/web/src/components/onboarding/FirstRunGate.tsx`: ignores the managed project.

Mobile:

- `apps/mobile/src/state/use-selected-thread-worktree.ts`: chats have no thread working directory,
  so file, Git, and review consumers see none.
- `apps/mobile/src/Stack.tsx`: files, file, review, review comment, and Git routes are wrapped in
  the route guard. The terminal route is not.
- `apps/mobile/src/features/threads/ThreadGitControls.tsx` and `ThreadRouteScreen.tsx`: a
  `genericChat` prop keeps only the terminal in the header, without project scripts.
- `apps/mobile/src/features/keyboard/HardwareKeyboardCommandProvider.tsx`: no files or review
  command in a chat.
- `apps/mobile/src/features/home/HomeHeader.tsx`: the iOS Chats menu (new chat, show chats).
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` and `NewTaskDraftScreen.tsx`: new
  chats use the local workspace and `approval-required`, with no workspace or branch controls.

Android and iPad split view reach chats through the new-task project list and the project filter,
where `Chats` appears as a project.

## Resolving conflicts

- Take upstream's version of every hooked file and re-apply the single call or branch. Each hook
  should branch only on the reserved project ID.
- If upstream changes how project tools (files, Git, diffs, terminal) are exposed, hide the new
  project-only affordances for chats too, and keep the terminal.
- If upstream changes where the provider turn text is assembled, move the context wrap to the new
  spot. It must still apply to every turn, including resumed sessions and attachment-only turns.
- The checkpoint guard wraps `CheckpointStore.isGitRepository`, which every v2 capture and
  baseline path consults. If upstream adds a capture path that skips that check, guard it too. The
  guard finds the workspace through the reserved ID, never by matching the scratch path.
- `Chats` is an ordinary project to upstream's lists, pickers, and filters. Keep it that way
  rather than special-casing it in each list.

## Never

- Never change `t3code-generic-chat` or create per-device IDs; that strands existing chats.
- Never detect chats by the `Chats` title or the scratch path.
- Never describe the scratch directory or the context as a sandbox. Providers can still reach other
  paths; tool behavior is governed by the provider and the runtime mode.
- Never add a chat-specific tool policy on top of the provider's own.
- Never change normal project behavior; shared code branches only on the reserved ID.

## Remove when

Upstream supports threads without a project (or an equivalent general chat) with no file or Git
affordances, and existing chats can move to it without losing history.

## Verify

- `node scripts/check-fork.ts` prints the focused tests: the server test covers ensuring once,
  repair, the scratch directory, the delete refusal, the context wrap, and no checkpoint even
  when Git detection says yes; the client tests cover the predicates, grouping, and the right-panel
  guard.
- User guidance lives in [`docs/user/chats.md`](../user/chats.md).
- One web and one mobile pass: start a chat, use the terminal, and confirm files, Git, diffs,
  branches, and worktrees are absent.
