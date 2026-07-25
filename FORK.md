# About this fork

This is Tangent, my personal build of [T3 Code](https://github.com/pingdotgg/t3code). I keep it in
[`bpdev97/tangent`](https://github.com/bpdev97/tangent) so I can install it alongside the
official app and ship my own iOS and macOS updates.

## Branches

- `main` is the version I install and release. It should always be buildable and is never
  force-pushed.
- `upstream/main` tracks the original repository.
- I make changes on `codex/*` branches and merge them through PRs.
- The weekly upstream sync uses `sync/upstream-main` and opens a PR instead of merging on its own.

## Fork-specific configuration

App names, bundle IDs, URL schemes, and other public identifiers live in
`downstream/config.ts`. Credentials stay in Expo, App Store Connect, or GitHub Actions.

Most features should go in the same package they would use upstream. The `downstream` directory is
only for the small amount of configuration that makes this a separate installable app.

These are the main files to check when an upstream merge conflicts with the fork setup:

| File                                         | What it controls                         |
| -------------------------------------------- | ---------------------------------------- |
| `downstream/config.ts`                       | Canonical personal distribution identity |
| `apps/mobile/app.config.ts`                  | Expo project and iOS app identity        |
| `apps/mobile/eas.json`                       | Personal iOS build and update channel    |
| `scripts/build-desktop-artifact.ts`          | macOS packaging identity                 |
| `apps/desktop/scripts/electron-launcher.mjs` | macOS development bundle identity        |
| `apps/desktop/src/app/DesktopEnvironment.ts` | Desktop name and local storage locations |

The fork's workflows start with `personal-`. The upstream release workflows are left alone to keep
syncs simple, but they should be disabled in this repository's Actions settings:

- `CI`
- `Release`
- `Deploy Relay`
- `Mobile EAS Preview`
- `Mobile EAS Production`

## Releases

The iOS app is distributed through TestFlight. Native builds and OTA updates use the EAS
`personal` channel. Expo's fingerprint runtime policy keeps an OTA update from reaching a binary
with incompatible native code.

The macOS app is published through this repository's GitHub Releases. It uses `~/.bpdev-code` for
state and `bpdev-code` for Electron data, so it can run next to the official app without sharing
files. Each `personal-vX.Y.Z` release also carries `tangent-server-X.Y.Z.tgz` and its SHA-256 file;
remote launch, manual relaunch, self-update, and background-service setup must use that artifact
rather than the upstream npm package.

## Fork feature delta registry

Agents must read the referenced maintenance record before rebasing upstream or modifying a listed
feature.

| ID                | Feature                                           | Status               | Maintenance record                                                                 | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORK-CHAT-001`   | Directoryless generic chat                        | Active               | [`docs/fork/generic-chat.md`](docs/fork/generic-chat.md)                           | `vp test packages/shared/src/genericChat.test.ts packages/shared/src/threadResponseGrouping.test.ts packages/client-runtime/src/state/projectGrouping.genericChat.test.ts apps/server/src/genericChat.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.genericChat.test.ts apps/web/src/components/chat/MessagesTimeline.logic.test.ts apps/mobile/src/lib/repositoryGroups.test.ts apps/mobile/src/lib/threadActivity.test.ts`                                                |
| `FORK-CLAUDE-001` | Claude subagent lifecycle correctness             | Active, temporary    | [`docs/fork/claude-subagent-lifecycle.md`](docs/fork/claude-subagent-lifecycle.md) | `vp test apps/server/src/provider/Layers/ClaudeAdapter.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `FORK-HERMES-001` | Hermes Agent provider and automation management   | Active, early access | [`docs/fork/hermes.md`](docs/fork/hermes.md)                                       | `vp test apps/server/src/provider/hermes packages/contracts/src/settings.test.ts packages/client-runtime/src/operations/hermesAutomations.test.ts apps/web/src/components/settings/SettingsPanels.logic.test.ts`                                                                                                                                                                                                                                                                                  |
| `FORK-PUSH-001`   | Tailnet APNs notification and Live Activity relay | Active               | [`docs/fork/personal-push-relay.md`](docs/fork/personal-push-relay.md)             | `vp test apps/push-relay/src apps/server/src/personalPush apps/server/src/serverSettings.test.ts apps/server/src/relay/AgentAwarenessRelay.test.ts apps/mobile/src/features/agent-awareness/remoteRegistration.test.ts packages/contracts/src/settings.test.ts`                                                                                                                                                                                                                                   |
| `FORK-CODEX-001`  | Codex MCP tool approval prompts                   | Active, temporary    | [`docs/fork/codex-mcp-tool-approvals.md`](docs/fork/codex-mcp-tool-approvals.md)   | `vp test apps/server/src/provider/CodexMcpApproval.test.ts apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/web/src/session-logic.test.ts apps/mobile/src/lib/threadActivity.test.ts`                                                                                                                                                                                                                              |
| `FORK-CURSOR-001` | Cursor ACP protocol compatibility                 | Active, temporary    | [`docs/fork/cursor-acp-protocol.md`](docs/fork/cursor-acp-protocol.md)             | `vp test apps/server/src/provider/Layers/CursorAdapter.test.ts apps/server/src/provider/acp/AcpAdapterSupport.test.ts apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts apps/server/src/provider/acp/AcpRuntimeModel.test.ts apps/server/src/provider/acp/CursorAcpExtension.test.ts`                                                                                                                                                                                                     |
| `FORK-IOS-001`    | CLI-safe iOS composer input                       | Active               | [`FORK-IOS-001 ownership map`](#fork-ios-001-ownership-map)                        | `vp run lint:mobile`, iOS Simulator composer smoke test                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `FORK-TOOLS-001`  | Structured tool-call presentation                 | Active               | [`docs/fork/tool-call-presentation.md`](docs/fork/tool-call-presentation.md)       | `vp test packages/client-runtime/src/tool-calls/index.test.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/web/src/session-logic.test.ts apps/web/src/components/chat/MessagesTimeline.logic.test.ts apps/web/src/components/chat/MessagesTimeline.test.tsx apps/mobile/src/lib/threadActivity.test.ts apps/mobile/src/features/threads/threadFeedLayout.test.ts`                                                                                                   |
| `FORK-AGENT-001`  | Provider-neutral subagent lifecycle               | Active               | [`docs/fork/subagent-lifecycle.md`](docs/fork/subagent-lifecycle.md)               | `vp test packages/contracts/src/providerRuntime.test.ts apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/provider/Layers/CodexSessionRuntime.test.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts apps/server/src/provider/Layers/OpenCodeAdapter.test.ts apps/server/src/provider/Layers/CursorAdapter.test.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/web/src/session-logic.test.ts apps/mobile/src/lib/threadActivity.test.ts` |

### FORK-IOS-001 ownership map

Fork-owned paths:

- `FORK.md`

Shared upstream touchpoints:

- `apps/mobile/modules/t3-composer-editor/ios/T3ComposerEditorView.swift`

Keep `UITextView.smartDashesType` disabled in the native composer so iOS does not rewrite ASCII
`--` into an em dash and corrupt CLI flags such as `--global`. Preserve normal autocorrection and
spell-check behavior. Remove this delta when upstream provides equivalent literal-input handling
for the iOS composer.

### FORK-CLAUDE-001 ownership map

Fork-owned paths:

- `docs/fork/claude-subagent-lifecycle.md`

Shared upstream touchpoints containing the Claude subagent lifecycle fix:

- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`

Preserve isolation of nested Claude conversation messages from the parent turn's content-block
index namespace. Once a Claude task lifecycle starts, prefer the SDK's authoritative
`session_state_changed: idle` signal. If that event is lost, recover only after every observed task
is terminal; fail explicitly rather than hanging forever if a task remains active past the hard
timeout. Keep `task_updated` as internal bookkeeping rather than a runtime warning. Remove this
patch when upstream provides equivalent nested-message isolation and bounded task-aware completion.

### FORK-CODEX-001 ownership map

Fork-owned paths:

- `apps/server/src/provider/CodexMcpApproval.ts`
- `docs/fork/codex-mcp-tool-approvals.md`

Shared upstream touchpoints containing the MCP approval path:

- `packages/contracts/src/orchestration.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/effect-codex-app-server/src/errors.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`
- `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/mobile/src/lib/threadActivity.ts`
- `apps/mobile/src/features/threads/PendingApprovalCard.tsx`

Remove this feature when upstream T3 handles Codex `mcpServer/elicitation/request` messages tagged
with `codex_approval_kind: "mcp_tool_call"`, including session-persistence metadata and web/mobile
approval rendering. Preserve the immediate cancel response for unsupported structured or URL
elicitations unless upstream adds a complete input flow for them.

### FORK-CURSOR-001 ownership map

Fork-owned paths:

- `docs/fork/cursor-acp-protocol.md`

Shared upstream touchpoints containing Cursor protocol compatibility behavior:

- `README.md`
- `apps/server/scripts/acp-mock-agent.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/provider/Layers/CursorAdapter.test.ts`
- `apps/server/src/provider/acp/AcpAdapterSupport.ts`
- `apps/server/src/provider/acp/AcpAdapterSupport.test.ts`
- `apps/server/src/provider/acp/AcpCoreRuntimeEvents.ts`
- `apps/server/src/provider/acp/AcpJsonRpcConnection.test.ts`
- `apps/server/src/provider/acp/AcpRuntimeModel.ts`
- `apps/server/src/provider/acp/AcpRuntimeModel.test.ts`
- `apps/server/src/provider/acp/AcpSessionRuntime.ts`
- `apps/server/src/provider/acp/CursorAcpExtension.ts`
- `apps/server/src/provider/acp/CursorAcpExtension.test.ts`

Keep Cursor-specific extension decoding at the adapter boundary while preserving generic ACP
behavior for other providers. Remove this feature only when upstream handles the same Cursor CLI
authentication command, mode/model configuration, interactive extension requests, task/todo/plan
events, and session lifecycle without weakening the shared ACP protocol implementation.

### FORK-TOOLS-001 ownership map

Fork-owned paths:

- `packages/shared/src/toolActivity.ts`
- `packages/client-runtime/src/tool-calls/`
- `docs/fork/tool-call-presentation.md`

Shared upstream touchpoints containing the additive projection and platform renderers:

- `packages/client-runtime/package.json`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/session-logic.test.ts`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/web/src/components/chat/ToolCallDetails.tsx`
- `apps/web/src/components/chat/MessagesTimeline.logic.ts`
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts`
- `apps/mobile/src/lib/threadActivity.ts`
- `apps/mobile/src/lib/threadActivity.test.ts`
- `apps/mobile/src/features/threads/thread-work-log.tsx`

Keep provider payload decoding and lifecycle merging in `@t3tools/client-runtime/tool-calls`; web and
mobile should remain thin renderers over the same presentation model. Preserve stable item IDs and
use the shared payload budget before orchestration persistence, retaining explicit truncation
metadata and useful leading/trailing diagnostics. Client traversal and rendering must remain bounded
even for legacy unbounded rows. Remove this patch when upstream provides equivalent cross-provider
lifecycle correlation and structured, responsive detail views on both clients.

### FORK-AGENT-001 ownership map

Fork-owned paths:

- `docs/fork/subagent-lifecycle.md`

Shared upstream touchpoints containing provider-neutral subagent handling:

- `packages/contracts/src/baseSchemas.ts`
- `packages/contracts/src/providerRuntime.ts`
- `packages/client-runtime/src/tool-calls/index.ts`
- `apps/server/src/provider/Layers/CodexSessionRuntime.ts`
- `apps/server/src/provider/Layers/CodexAdapter.ts`
- `apps/server/src/provider/Layers/ClaudeAdapter.ts`
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/web/src/session-logic.ts`
- `apps/web/src/components/chat/MessagesTimeline.tsx`
- `apps/mobile/src/lib/threadActivity.ts`
- focused tests for the modules above

Keep agent lifecycle distinct from the collaboration tool call that created or interacted with an
agent. Child provider transcripts must never enter the parent assistant stream unless they carry a
stable agent identity and are rendered in an isolated transcript. Web and mobile must consume the
same projected lifecycle and structured detail model. Hermes remains outside this compatibility
layer until its direct runtime integration lands. Remove this patch when upstream has equivalent
provider-neutral lifecycle, hierarchy, isolation, and cross-platform presentation.

### FORK-PUSH-001 ownership map

Fork-owned paths:

- `.dockerignore`
- `.github/workflows/personal-push-relay-image.yml`
- `apps/push-relay/`
- `apps/server/src/personalPush/`
- `docs/fork/personal-push-relay.md`

Shared upstream touchpoints containing additive personal-relay behavior:

- `.gitignore`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/server.ts`
- `packages/client-runtime/src/state/server.ts`
- `packages/contracts/src/relay.ts`
- `apps/server/src/config.ts`
- `apps/server/src/cli/config.ts`
- `apps/server/src/http.ts`
- `apps/server/src/server.ts`
- `apps/server/src/serverSettings.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/relay/AgentAwarenessRelay.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/mobile/src/App.tsx`
- `apps/mobile/src/features/agent-awareness/remoteRegistration.ts`

The personal relay runs alongside the hosted relay path. Its URL and password are server-owned
settings; the password must remain in `ServerSecretStore` and be redacted from settings snapshots.
Keep notification and Live Activity delivery watermarks independent and advance each only after APNs
accepts that channel so transient failures remain retryable without duplicating successful sends.
During upstream syncs, preserve the
canonical awareness projection and its confirmation/deduplication worker, then reapply personal
publishing as a second sink. Review mobile registration changes for new token APIs or authentication
methods before adapting the connection bridge. The APNs key and relay bearer token must never enter
git, logs, issues, or PR text.

### FORK-CHAT-001 ownership map

Fork-owned paths:

- `packages/shared/src/genericChat.ts`
- `packages/shared/src/threadResponseGrouping.ts`
- `packages/client-runtime/src/state/projectGrouping.genericChat.test.ts`
- `apps/server/src/genericChat.ts`
- focused `genericChat.test.ts` files
- `apps/mobile/src/features/threads/use-start-generic-chat.ts`
- `apps/mobile/src/features/threads/ProjectThreadRouteGuard.tsx`
- `docs/fork/generic-chat.md`

Shared upstream touchpoints containing additive generic-chat behavior:

- `packages/shared/package.json`
- `packages/client-runtime/src/state/projectGrouping.ts`
- `apps/server/src/serverRuntimeStartup.ts`
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
- `apps/web/src/hooks/useHandleNewThread.ts`
- `apps/web/src/components/NoActiveThreadState.tsx`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/RightPanelTabs.tsx`
- mobile home, thread-list, new-task, workspace, Git, file, and terminal surfaces under
  `apps/mobile/src/`

The protocol still requires projects and provider cwd values. The managed scratch workspace preserves
those invariants; the reserved project ID selects provider context, runtime restrictions, logical
grouping, and client capability guards.

### Generic chat upstream sync playbook

1. Compare upstream changes to project startup, provider session creation, runtime-mode restarts,
   project grouping, and new-thread flows on web and mobile.
2. Preserve the reserved ID and idempotent startup repair behavior.
3. Reapply UI guards through shared capability seams; do not fork whole upstream components.
4. Verify that provider context is still added to every initial, resumed, and attachment-only turn.
5. Run the focused tests plus `vp check`, `vp run typecheck`, and `vp run lint:mobile`.

Remove `FORK-CHAT-001` only when upstream provides equivalent non-project chat semantics, including
safe migration or continuation of threads stored under the reserved project. A cosmetic New Chat
button without the provider and capability boundaries is not equivalent.

### FORK-HERMES-001 ownership map

Fork-owned paths:

- `apps/server/src/provider/hermes/`
- `apps/web/src/components/HermesIcon.tsx`
- `apps/web/src/components/automations/`
- `apps/web/src/routes/automations.tsx`
- `apps/web/src/state/hermesAutomations.ts`
- `apps/mobile/src/features/automations/`
- `apps/mobile/src/state/hermesAutomations.ts`
- `packages/contracts/src/hermesAutomation.ts`
- `packages/client-runtime/src/operations/hermesAutomations.ts`
- `packages/client-runtime/src/state/hermesAutomations.ts`
- `docs/fork/hermes.md`
- `docs/providers/hermes.md`

Shared upstream touchpoints containing small additive entries:

- `AGENTS.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/rpc.ts`
- `packages/contracts/src/settings.ts`
- `packages/contracts/src/model.ts`
- `packages/client-runtime/package.json`
- `packages/client-runtime/src/operations/index.ts`
- `apps/server/src/provider/builtInDrivers.ts`
- `packages/contracts/src/providerRuntime.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/ws.ts`
- `apps/web/src/routeTree.gen.ts`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/session-logic.ts`
- `apps/web/src/components/settings/providerDriverMeta.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/SettingsPanels.logic.ts`
- `apps/web/src/components/chat/providerIconUtils.ts`
- `apps/mobile/src/Stack.tsx`
- `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`
- `apps/mobile/src/features/settings/components/settings-sheet-targets.ts`
- `apps/mobile/src/components/ProviderIcon.tsx`
- `docs/README.md`

The provider is deliberately absent from the legacy `ServerSettings.providers` object. It is
registered only through `providerInstances`, so removing this fork from a build leaves its settings
as a preserved unavailable-driver envelope rather than corrupting configuration.

### Hermes upstream sync playbook

1. Record the old and new `upstream/main` SHAs.
2. Intersect the upstream diff with the shared touchpoints above.
3. Preserve fork-owned paths unless an upstream provider interface changed.
4. Resolve shared-file conflicts by reapplying only the additive Hermes entry or the reasoning-stream
   compatibility case; do not replace the upstream file wholesale.
5. Review changes to provider instances, Hermes gateway contracts, canonical runtime events, settings forms,
   and mobile notification ingestion even when Git reports no textual conflict.
6. Run the Hermes-focused tests, `vp check`, `vp run typecheck`, and `vp run lint:mobile`.
7. Add a row to the sync ledger describing conflicts and behavioral changes.

### Hermes compatibility baseline

Runtime compatibility is capability-probed; newer Hermes versions are not rejected merely because
their version differs. The detailed source-review and real-binary smoke coverage lives in
`docs/fork/hermes.md`. A source review or partial transport smoke must not be presented as a
successful end-to-end chat.

| Date       | Old upstream | New upstream | Hermes baseline                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------ | ------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-12 | —            | `f61fa949`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | Deterministic ACP tests passed; a Mac mini smoke reached model selection and verified detailed error output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-07-13 | `f61fa949`   | `c1ec1915`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | No Hermes touchpoints changed; mobile conflicts preserved generic-chat guards and personal app identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-07-14 | `c1ec1915`   | `735240f3`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | No Hermes touchpoints changed; the additive shared favicon export preserved generic-chat package exports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-07-15 | `735240f3`   | `ecb35f75`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | Upstream added mobile legal routes and Android beta assets; the config conflict preserved personal identity while adopting the new asset layout.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-16 | `ecb35f75`   | `fdca1547`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | No Hermes provider interfaces changed; mobile conflicts combined share-target flows with generic-chat guards and personal app identity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-07-17 | `8b546986`   | `24f9c2a0`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | Upstream centralized brand assets and added restart-safe ACP assistant IDs; conflicts retained personal identity and combined the runtime UUID with Hermes message boundaries. Codex developer-instruction changes were merged with the fork's approval reviewer. No fork feature had an upstream-equivalent end-to-end implementation.                                                                                                                                                                                                                                                                        |
| 2026-07-17 | `24f9c2a0`   | `5ca32661`   | Hermes Agent 0.18.2 (`4281151`) source / ACP SDK 0.9.0 | No Hermes touchpoints changed. Upstream's higher-contrast question descriptions were adopted unchanged; its macOS development launcher identity work was adapted to the canonical personal distribution identity.                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-07-18 | —            | —            | Hermes Agent 0.18.2 / TUI gateway contract 2           | Replaced ACP chat and utility integration with the supervised authenticated loopback TUI gateway. Reviewed Hermes main `614dc194` (contract 3); a real 0.18.2 probe verified ready, setup, model discovery, durable session creation, and close. Legacy ACP sessions are intentionally not migrated.                                                                                                                                                                                                                                                                                                           |
| 2026-07-19 | `1735e27d`   | `53e3c98a`   | Hermes Agent 0.18.2 / TUI gateway contract 2           | No Hermes runtime interfaces changed. The shared Sidebar conflict kept Tangent branding and Hermes navigation while adopting upstream's nightly/dev header art. The isolated testing workflow was adapted to the personal `.bpdev-code` state root.                                                                                                                                                                                                                                                                                                                                                            |
| 2026-07-20 | `53e3c98a`   | `5d34f9ff`   | Hermes Agent 0.18.2 / TUI gateway contract 2           | Upstream's T3 Connect, OpenCode resume/title recovery, task-title projection, complete approval details, desktop preview hardening, and mobile glass/header work were adopted. Conflicts preserved generic chat, bounded tool payloads, provider-neutral descendant agents, MCP approvals, Hermes, and personal distribution identity. The redundant compact mobile brand title was retired in favor of the upstream Threads title; the managed chat project gained a server-side deletion guard, and Tangent Connect uses a distinct `tangent.service` unit. No registered fork feature was fully superseded. |
| 2026-07-24 | `5d34f9ff`   | `ece05087`   | Hermes Agent 0.18.2 / TUI gateway contract 2           | Adopted upstream's first-class `Auto` runtime mode and retired `FORK-CODEX-002` plus its independent reviewer setting. Adopted upstream server self-update and systemd lifecycle management with Tangent distribution boundaries: verified `bpdev97/tangent` GitHub Release archives, source-identity sentinels, `tangent.service`, matching manual/SSH launch URLs, and no upstream npm fallback. Conflicts preserved generic chat, Hermes, push relay, structured tool calls, provider-neutral agents, project grouping, and personal desktop/mobile identity.                                               |

Remove `FORK-HERMES-001` only when upstream T3 ships equivalent profile-aware Hermes TUI gateway support and
current versioned gateway cursors can be migrated or continued without losing sessions. Compare behavior
and tests before replacing the fork implementation; matching provider branding alone is not
sufficient.

## Before merging

Run:

```sh
vp check
vp run typecheck
```

Also run `vp run lint:mobile` after changing mobile native code or configuration.

Never put credentials in commits, issues, PRs, or chat. The complete setup and first-release notes
are in `docs/personal-distribution.md`.
