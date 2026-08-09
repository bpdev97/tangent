# Generic chat fork maintenance record

## Decision

General conversations use a managed project rather than weakening T3's project, thread, and
provider-session invariants. Every server ensures one project with the reserved ID
`t3code-generic-chat` and the display title `Chats` at startup. Its workspace is an app-owned
scratch directory at `<baseDir>/workspaces/generic-chat`; it is an implementation detail, not user
content.

The reserved project ID is the capability marker. Do not detect generic chats by title or path:
both can be repaired or vary between environments, while the ID is stable and intentionally groups
the same logical `Chats` entry across servers.

## Provider behavior

Before every generic-chat turn, the server adds host context telling the provider that no user
project or working directory is attached and that it must not inspect files, run shell or Git
commands, or use project tools. The stored user message remains unchanged. Attachment-only turns
still receive the host context.

Generic sessions are always started in `approval-required` mode regardless of thread metadata.
For Codex this maps to a read-only sandbox. Providers still require a real process cwd, so the
server pins generic sessions to the managed root even if stale or malformed thread metadata
contains a worktree path. The root is a compatibility cwd, not a filesystem containment boundary:
the host context is a behavioral instruction, and a provider may still be able to read paths
outside it. This feature does not pretend that the provider protocol supports a null cwd or provide
an operating-system sandbox shared by every provider.

New managed chat project records are seeded with the built-in `codex` instance and `DEFAULT_MODEL`
for schema compatibility. Web and mobile treat that value as a preference, validate it against the
environment's enabled providers, and fall back to an available provider before dispatch. A client
that bypasses those selection helpers must perform the same validation rather than blindly sending
the stored seed.

## Client behavior

Web, desktop, and iOS expose Chats as a first-class destination. New chats target the device's
preferred chat environment. Once the user chooses a host, selection is strict: an unavailable host
keeps the draft in place and never falls back to another environment. Existing chats stay on the
environment where they were created, and the logical project remains grouped across environments
under `Chats`.

On desktop and web, Chats sits above project scoping and shows the selected host inline. The normal
active/settled thread model remains shared with the rest of the sidebar. On iOS, the home screen has
a persistent new-chat field at the bottom; tapping it presents the existing full new-task composer
already scoped to the managed chat project. Search, New Thread, filters, and Settings live in the
top navigation area. Android retains the upstream mobile layout.

The macOS build registers the dedicated, fixed action URL `bpdev-code-action://quick-chat`. It is
not a general navigation scheme. The renderer resumes the most recently viewed, unarchived generic
chat that has not been explicitly settled when its visit is inside the configurable window;
otherwise it opens a fresh draft on the preferred host. Settling a chat makes it immediately
ineligible for resume.
Actions received during desktop cold start are deduplicated and delivered after the backend and
renderer are ready. Ordinary Dock activation remains unchanged.

Generic-chat threads do not expose project-only affordances:

- files, diffs, Git, worktrees, branches, project scripts, and terminals are unavailable;
- new-chat drafts use the local workspace mode with no branch, worktree, or origin selection;
- runtime selection is fixed by the server even if stale client metadata says otherwise.

Conversation presentation uses the same upstream provider-turn folding as project threads. Generic
chat does not maintain a separate response-grouping model.

The mobile working-directory selector is the central capability boundary for existing threads. It
derives generic-chat status from the selected thread's reserved project ID, without waiting for the
project catalog to hydrate. A generic chat returns `null` there, which keeps file, Git, review, and
terminal consumers aligned. Project-only routes share a thread capability guard so files, Git,
review, terminal, and their nested routes cannot be opened through deep links or keyboard commands.

## Compatibility invariants

- Keep `GENERIC_CHAT_PROJECT_ID` stable; changing it or creating per-device IDs strands old chats.
- Provisioning must remain idempotent and repair the managed title/path without deleting threads.
- Do not infer generic-chat behavior from `Chats` or a `generic-chat` path.
- Provider context must be applied on every turn, including resumed sessions and attachment-only
  turns.
- Compare an active provider session against the effective forced runtime mode, not mutable thread
  metadata, when deciding whether to restart it.
- Resolve a generic provider session cwd from the managed project only; never honor its thread
  branch or worktree metadata. Do not describe that cwd as a security boundary.
- Treat the no-files rule as best-effort until every provider has an enforceable filesystem-denial
  mode. UI capability guards prevent accidental entry points but do not constrain provider tools.
- Never expose the managed scratch directory as a user workspace in web or mobile UI.
- Derive existing-thread capability from `thread.projectId`; project catalog objects may arrive a
  render later and must not temporarily enable project tools.
- Keep generic-chat presentation aligned with upstream provider-turn folding.
- Keep the preferred-host resolver strict after explicit selection; never reintroduce implicit
  fallback for a temporarily unavailable host.
- Keep Quick Chat's external action fixed and allowlisted. Do not turn the action scheme into an
  arbitrary in-app URL router.
- Keep the iOS home field as a launcher for the existing new-task composer. Model selection,
  attachments, draft retention, thread creation, and the offline outbox must remain shared.
- Keep normal project behavior unchanged; shared helpers must branch only on the reserved ID.

## Revalidation procedure

Run the focused tests:

```sh
vp test packages/shared/src/genericChat.test.ts \
  packages/contracts/src/settings.test.ts \
  packages/client-runtime/src/state/projectGrouping.genericChat.test.ts \
  apps/server/src/genericChat.test.ts \
  apps/server/src/orchestration/Layers/ProviderCommandReactor.genericChat.test.ts \
  apps/web/src/lib/chatThreadActions.test.ts \
  apps/web/src/lib/quickChat.test.ts \
  apps/desktop/src/app/DesktopQuickChat.test.ts \
  apps/desktop/src/app/DesktopLifecycle.test.ts \
  apps/desktop/src/window/DesktopWindow.test.ts
```

Then run `vp check`, `vp run typecheck`, and `vp run lint:mobile`. Smoke-test New Chat on web and
mobile, select and disconnect a preferred host, exercise Quick Chat inside and outside its resume
window, resume an existing chat, and confirm that files, Git, terminal, branch, worktree, and
project-script controls remain absent.
