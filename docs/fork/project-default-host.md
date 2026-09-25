# FORK-HOST-001: a default host per project

## Why

A project on several servers is one logical project, and upstream picks which server a new thread
starts on: the primary environment on web and desktop, whichever server's project comes first on
mobile, or load balancing when it is on. None of these remembers that a given project, such as
`Chats`, should start somewhere else. Tangent lets each client name that server per project.

## Behavior

- Each client stores its own choices: web and desktop in client settings (`projectDefaultHosts`),
  mobile in device preferences. The key is the logical project key, so changing the grouping rules
  can orphan a choice; it then does nothing.
- The choice only applies to projects on two or more servers, and only to where new threads
  start. Existing threads, the project list, and the draft's own host picker are unchanged.
- A new thread starts on the member on the default host when that host is connected. When it is
  offline or no longer has the project, the upstream choice applies without a warning; the draft's
  host picker already shows which host is in use.
- Callers that name a branch or worktree keep their environment, because those exist only where
  the caller found them.
- On web and desktop, a default host outranks load balancing. Picking Auto in the draft's host
  picker still load-balances that draft.
- The choice is set on the web project settings page (**Default host**) and in mobile
  **Settings → Projects & threads → Overview**. Both offer Automatic, which clears it.

## Upstream hooks

Fork logic lives in `packages/shared/src/projectDefaultHost.ts` (resolution, map updates, stored
value sanitizing), `apps/web/src/lib/projectDefaultHost.ts`,
`apps/web/src/components/settings/ProjectDefaultHostSetting.tsx`,
`apps/mobile/src/features/projects/projectDefaultHost.ts`, and
`apps/mobile/src/features/settings/ProjectDefaultHostSection.tsx`. Each upstream hook is marked
`Tangent(FORK-HOST-001)`:

- `packages/contracts/src/settings.ts`: `projectDefaultHosts` in `ClientSettingsSchema` and
  `ClientSettingsPatch`.
- `packages/shared/package.json`: the `./projectDefaultHost` export.
- `apps/web/src/hooks/useHandleNewThread.ts`: the handler remaps the requested project to the
  default host's member before anything else reads it. Every web entry point (sidebar, command
  palette, keybindings, `chats.new`) goes through it.
- `apps/web/src/hooks/useHandleNewThread.test.ts`: mocks the remap away.
- `apps/web/src/components/ChatView.tsx`: `automaticEnvironment` stands aside while the default
  host is active, unless the draft picked Auto.
- `apps/web/src/components/settings/ProjectSettingsPanel.tsx`: renders the row on the whole-group
  page.
- `apps/mobile/src/persistence/mobile-preferences.ts`: the preference field and its sanitizer.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx`: the project picker's selection target.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` and
  `apps/mobile/src/features/layout/AdaptiveWorkspaceLayout.tsx`: a project's new-thread action.
- `apps/mobile/src/features/home/useStartNewChat.ts` (FORK-CHAT-001): the compose button's Chats
  draft.
- `apps/mobile/src/features/settings/SettingsProjectOverviewRouteScreen.tsx`: renders the section.

## Resolving conflicts

- If upstream moves where a new thread's environment is chosen, move the remap there. On web it
  must run before the draft is keyed or reused; on mobile, before the draft route gets its params.
- If upstream changes load balancing's gate, keep the rule that an active default host wins unless
  the draft explicitly picked Auto.
- If upstream adds a new-thread entry point that bypasses these paths, route it through the same
  resolver.

## Never

- Never store the choice on a server or sync it; it belongs to one client.
- Never override a caller that named a branch or worktree.
- Never move or retarget existing threads.

## Remove when

Upstream lets a client choose, per project, which server new threads start on.

## Verify

```sh
vp test run packages/shared/src/projectDefaultHost.test.ts apps/web/src/hooks/useHandleNewThread.test.ts
```

Plus one pass per client with a project on two servers: set a default host, start a thread from
the sidebar or Home, and confirm the draft's host picker shows it; take that host offline and
confirm the draft falls back.
