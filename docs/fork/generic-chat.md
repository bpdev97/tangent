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
  replaces the project's model preference.
- The project's working directory is app-owned scratch space at
  `<baseDir>/workspaces/generic-chat`. It is not user content and is never shown as a workspace.
- Every turn sent to a provider is wrapped with short, factual context: no user project or
  repository is attached, and the working directory is app-owned scratch space. The context does
  not direct tool use or replace the provider's own instructions and approval behavior. The stored
  user message is unchanged, and attachment-only turns still get the context.
- New chat threads use `approval-required`.
- Checkpoints do not run for chats: v2 skips checkpoints in working directories that are not Git
  repositories.
- Web and mobile show `Chats` as a destination with a new-chat action. Chat threads hide files,
  diffs, Git, worktrees, branches, and project scripts, and those routes are guarded against deep
  links and keyboard shortcuts. The terminal remains available.
- Existing-thread capability comes from `thread.projectId`, because the project catalog can arrive a
  render later and must not briefly enable project tools.
- Conversation presentation is upstream's; chats have no separate message grouping.

## Upstream hooks

Planned:

- Server startup: one call that ensures the managed project through `ProjectService`.
- `apps/server/src/orchestration-v2/ProviderTurnStartService.ts`: where the provider turn text is
  built, wrap it with the chat context for chat threads.
- Web and mobile sidebar and thread views: the `Chats` entry, new-chat action, and hidden project
  tools, through the shared predicates in `packages/shared/src/genericChat.ts`.

## Resolving conflicts

- Take upstream's version of every hooked file and re-apply the single call or branch. Each hook
  should branch only on the reserved project ID.
- If upstream changes how project tools (files, Git, diffs, terminal) are exposed, hide the new
  project-only affordances for chats too, and keep the terminal.
- If upstream changes where the provider turn text is assembled, move the context wrap to the new
  spot. It must still apply to every turn, including resumed sessions and attachment-only turns.
- If a development worktree nests the scratch directory inside a Git repository, add a checkpoint
  guard on the reserved ID rather than relying on the Git check.

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

- Server tests: startup ensures the project once and repairs it; the context wraps provider text
  only; the working directory is the scratch directory; no checkpoint is captured.
- Client tests on the shared predicates and route guards.
- One web and one mobile pass: start a chat, use the terminal, and confirm files, Git, diffs,
  branches, and worktrees are absent.
