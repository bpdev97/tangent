# Tangent fork inventory

Tangent is a personal distribution of [T3 Code](https://github.com/pingdotgg/t3code), maintained at
[`bpdev97/tangent`](https://github.com/bpdev97/tangent). It is installed alongside the official app
and ships independently on macOS and iOS.

This file is the authoritative list of behavior Tangent intentionally carries beyond upstream.
Before rebasing from upstream or changing one of these features, read its maintenance record and
review the ownership map below. A path differing from upstream is not automatically a fork feature:
generated assets, packaging identity, and additive registrations often account for shared-file
diffs.

## Branch and release policy

- `main` is the installed and released branch. It must remain buildable and is never force-pushed.
- `upstream/main` tracks `pingdotgg/t3code`.
- `origin/main` is Tangent's published branch.
- Tangent releases use `personal-vX.Y.Z` tags.
- macOS and the matching server archive are built by `personal-macos-release.yml`.
- iOS native builds and compatible OTA updates use the EAS `personal` channel through
  `personal-ios-release.yml`.

The upstream release workflows remain in the tree for mergeability and must stay disabled in this
repository's Actions settings. Tangent workflows begin with `personal-`.

## Distribution identity

All canonical public identity belongs in [`downstream/config.ts`](downstream/config.ts): product
names, repository, update tag and artifact names, bundle IDs, URL schemes, Expo ownership, Apple
team, service name, and state directories. Credentials belong only in GitHub Actions, Expo, App
Store Connect, or deployed secret files.

Tangent uses `~/.bpdev-code` and Electron's `bpdev-code` directory. It must never fall back to the
official app's state or update source. Each macOS release includes
`tangent-server-X.Y.Z.tgz` and its SHA-256 sidecar; local update, SSH launch, service installation,
and pinned runtime resolution all use that verified GitHub Release artifact rather than the
upstream npm package.

## Active fork features

The dated [2026-08-01 audit](docs/fork/audit-2026-08-01.md) records the complete downstream commit
ledger and keep/restore review. The [2026-08-08 sync audit](docs/fork/audit-2026-08-08.md) records
the latest upstream merge, compatibility decisions, and verification.

| ID                 | Kept behavior                                                                   | Status               | Maintenance record                                            | Focused verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FORK-DIST-001`    | Tangent identity, macOS/iOS release, server self-update, and service boundaries | Active               | [Personal distribution](docs/personal-distribution.md)        | `vp test scripts/personal-distribution-identity.test.ts scripts/build-desktop-artifact.test.ts apps/server/src/cloud/serverRelease.test.ts apps/server/src/cloud/pinnedRuntime.test.ts apps/server/src/cloud/selfUpdate.test.ts apps/server/src/cli/service.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts packages/ssh/src/command.test.ts`                                                                                                                                               |
| `FORK-CHAT-001`    | Managed generic chats without a user project                                    | Active               | [Generic chat](docs/fork/generic-chat.md)                     | `vp test packages/shared/src/genericChat.test.ts packages/client-runtime/src/state/projectGrouping.genericChat.test.ts apps/server/src/genericChat.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.genericChat.test.ts apps/web/src/lib/chatThreadActions.test.ts`                                                                                                                                                                                                              |
| `FORK-HERMES-001`  | Hermes TUI-gateway provider and automation management                           | Active, early access | [Hermes](docs/fork/hermes.md)                                 | `vp test apps/server/src/provider/hermes apps/server/src/persistence/Migrations/039_TangentMigrationCompatibility.test.ts packages/client-runtime/src/operations/hermesAutomations.test.ts apps/web/src/components/settings/SettingsPanels.logic.test.ts`                                                                                                                                                                                                                                           |
| `FORK-PUSH-001`    | Personal APNs notifications and Live Activities                                 | Active               | [Personal push relay](docs/fork/personal-push-relay.md)       | `vp test apps/push-relay/src apps/server/src/personalPush apps/server/src/relay/AgentAwarenessRelay.test.ts apps/mobile/src/features/agent-awareness/remoteRegistration.test.ts`                                                                                                                                                                                                                                                                                                                    |
| `FORK-IMAGE-001`   | Shared HEIC/HEIF-to-JPEG upload normalization                                   | Active               | [Image normalization](docs/fork/image-normalization.md)       | `vp test apps/server/src/imageNormalization.test.ts apps/server/src/orchestration/Normalizer.test.ts`                                                                                                                                                                                                                                                                                                                                                                                               |
| `FORK-CODEX-001`   | Codex MCP tool-call approval elicitations                                       | Active, temporary    | [Codex MCP approvals](docs/fork/codex-mcp-tool-approvals.md)  | `vp test apps/server/src/provider/CodexMcpApproval.test.ts apps/server/src/provider/Layers/CodexAdapter.test.ts apps/server/src/provider/Layers/CodexSessionRuntime.test.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts apps/web/src/session-logic.test.ts apps/mobile/src/lib/threadActivity.test.ts`                                                                                                                                                                    |
| `FORK-PALETTE-001` | Control-N/Control-P command-palette navigation                                  | Active, temporary    | [Ownership map](#fork-palette-001)                            | `vp test apps/web/src/components/CommandPalette.logic.test.ts` plus a web keyboard smoke test                                                                                                                                                                                                                                                                                                                                                                                                       |
| `FORK-LINEAR-001`  | Linear ticket and Review destinations from new-sidebar GitHub PR badges         | Active               | [Linear PR destinations](docs/fork/linear-pr-destinations.md) | `vp test packages/shared/src/linear.test.ts packages/contracts/src/settings.test.ts apps/server/src/linear/LinearIntegration.test.ts apps/server/src/serverSettings.test.ts apps/desktop/src/preview/BrowserSession.test.ts apps/web/src/browser/openFileInPreview.test.ts apps/web/src/components/linear/linearPreviewPresentation.test.ts apps/web/src/components/linear/LinearPreviewToolbar.test.tsx apps/web/src/rightPanelStore.test.ts apps/web/src/components/preview/PreviewView.test.tsx` |

## Restored to upstream on 2026-08-01

These changes were deliberately removed. Do not reintroduce them during conflict resolution unless
they are separately reviewed and registered again.

| Former delta                                                                                                                             | Restored behavior                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude lifecycle patch (`b9726d12c`, `5e79c1f72`)                                                                                        | Claude adapter and turn lifecycle now match upstream.                                                                                                                              |
| Cursor ACP compatibility patch (`fbbd07304`)                                                                                             | Cursor and shared ACP runtime/protocol code now match upstream.                                                                                                                    |
| Rich tool rendering, custom payload projection, and tool-history scrolling (`e32b3937e` through `17ceb6a0d`, `062a208a4`, `8065e635f`)   | Tool projection, transport, folding, and web/mobile presentation now match upstream.                                                                                               |
| Provider-neutral `agent.*` lifecycle (`7cd6494ce`)                                                                                       | Custom contracts and client rows were removed. Hermes `subagent.*` notifications use upstream `task.started`, `task.progress`, and `task.completed` events keyed by `subagent_id`. |
| Mobile caching, loading, scrolling, foreground wakeup, and rendering patches (`bf2b71fb1`, `49ce8bf1b`, general portions of `cef261314`) | Those paths now match upstream. The notification endpoint reconciliation portion of `cef261314` remains under `FORK-PUSH-001`.                                                     |
| Completed-turn retention and snapshot/activity limits (`4d3557ff4`, remaining `FORK-ACTIVITY-001`)                                       | Projection and retention behavior now match upstream.                                                                                                                              |
| iOS smart-dash override (`869ab2727`)                                                                                                    | The native composer now matches upstream; Tangent no longer owns mobile text behavior.                                                                                             |
| User-message response grouping (`139da6bb5`)                                                                                             | Web and mobile use upstream provider-turn folding.                                                                                                                                 |
| Mobile thread-list default (`81d721e43`)                                                                                                 | Already absorbed by upstream and has no remaining Tangent ownership.                                                                                                               |

The historical Claude, Cursor, activity-retention, mobile-reliability, tool-presentation, and
provider-neutral-agent maintenance files were removed with their code so they cannot be mistaken
for active requirements.

## Ownership and sync rules

### FORK-DIST-001

Fork-owned paths:

- `downstream/config.ts`
- `.github/workflows/personal-*.yml`
- `apps/mobile/src/features/updates/app-updates.ts` and its focused test
- `docs/personal-distribution.md`
- `scripts/personal-distribution-identity.test.ts`

Shared upstream touchpoints:

- branding assets and identity consumers under `apps/web`, `apps/desktop`, `apps/mobile`, and
  `assets/`;
- `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, and widget asset configuration;
- desktop package, environment, launcher, window, and packaging scripts;
- server release, pinned-runtime, self-update, service, CLI, and SSH-launch paths;
- install, update, and operations documentation.

Invariants:

- Preserve the repository, `personal-v` tag prefix, `tangent-server` artifact prefix,
  `tangent.service`, source-identity sentinel, personal Expo channel, bundle IDs, URL schemes, and
  separate state roots.
- The updater streams into a unique temporary file, verifies SHA-256 before rename, and retains the
  current plus one prior archive. Never restore whole-response archive buffering.
- Automatic mobile update checks treat network and dev-client errors as recoverable operation
  failures. They stay quiet on launch; a user-initiated check reports the error in the settings UI.
- A matching upstream package version is not an equivalent update source.
- Release workflows must not publish unless checks pass and the requested version is absent.

### FORK-CHAT-001

Fork-owned paths:

- `packages/shared/src/genericChat.ts`
- `apps/server/src/genericChat.ts` and focused generic-chat tests
- `apps/mobile/src/features/threads/use-start-generic-chat.ts`
- `apps/mobile/src/features/threads/ProjectThreadRouteGuard.tsx`
- `docs/fork/generic-chat.md`

Shared upstream touchpoints include project grouping, server startup, provider session creation,
new-thread actions, and the web/mobile project-capability seams.

Invariants:

- `t3code-generic-chat` is the stable capability marker. Never infer the feature from a title or
  path, and never create per-device IDs.
- Startup creates or repairs the managed project without replacing its model preference or
  deleting threads.
- Every turn receives the generic-chat provider context, uses `approval-required`, and is pinned to
  the app-owned scratch cwd even when stale thread metadata contains a worktree.
- Web and mobile hide files, Git, worktrees, terminals, diffs, scripts, and related deep links.
- The prompt and cwd are best-effort behavior, not a provider-independent filesystem jail. Do not
  document them as containment.
- Conversation folding, activities, and tool calls stay upstream-owned.

### FORK-HERMES-001

Fork-owned paths:

- `apps/server/src/provider/hermes/`
- Hermes automation routes, state, and UI under `apps/web` and `apps/mobile`
- `packages/contracts/src/hermesAutomation.ts`
- Hermes automation operations/state under `packages/client-runtime`
- `docs/fork/hermes.md` and `docs/user/hermes.md`

Shared touchpoints are additive provider registrations in contracts, settings, RPC, server
drivers, orchestration ingestion, provider pickers/icons, navigation, and settings surfaces.

Invariants:

- Manual chats use the authenticated, supervised loopback TUI gateway, not ACP.
- One provider instance owns one explicit profile and one gateway backend.
- Durable cursors remain `{ schemaVersion: 2, transport: "tui-gateway", sessionId }`; legacy ACP
  cursors are intentionally not loaded.
- `prompt.submit` is supervised without blocking `sendTurn`, preserving steering and interruption.
- Gateway event order is preserved per session and all client-visible state uses canonical runtime
  events.
- Open-ended prompts remain valid with an empty options list.
- `subagent.*` events require a stable `subagent_id` and project through upstream task events; there
  is no Tangent `agent.*` contract.
- Thread lock entries are reference-counted and removed when no operation is using them.
- Provider setup stays terminal-owned; the app reports the remediation command but does not run it.
- Automation delivery and the gateway desktop cron ticker remain disabled.

Current compatibility baseline: Hermes Agent 0.19.0, TUI gateway contract 2. Revalidate the
programmatic guide, gateway types/transport/server handlers, focused fixtures, and a real binary
before raising the baseline. Remove this feature only when upstream can continue or migrate the
versioned sessions and provides equivalent profile-aware gateway behavior.

### FORK-PUSH-001

Fork-owned paths:

- `apps/push-relay/`
- `apps/server/src/personalPush/`
- `.github/workflows/personal-push-relay-image.yml`
- `docs/fork/personal-push-relay.md`

Shared touchpoints include relay/settings contracts, server configuration and HTTP/WS wiring, the
canonical awareness relay, web settings, mobile startup, and remote registration.

Invariants:

- The relay URL is server-owned; its bearer token remains in `ServerSecretStore` and is redacted
  from settings snapshots and logs.
- Notification and Live Activity watermarks are independent and advance only after APNs accepts
  that channel. Invalid tokens are cleared; transient failures remain retryable.
- Activity rows carry phase-specific expirations and are physically pruned from SQLite.
- One aggregate is computed per ordered publication, delivery fan-out is bounded, and the ordered
  queue rejects excess work instead of growing without limit.
- APNs provider tokens and HTTP/2 sessions are reused and closed on shutdown.
- Mobile reconciles the durable environment catalog and keeps the last usable bearer endpoint while
  a prepared socket is replaced. Connection churn must not trigger duplicate APNs registration.
- Keep personal publishing as a second sink beside upstream awareness behavior.

### FORK-IMAGE-001

Fork-owned paths:

- `apps/server/src/imageNormalization.ts`
- `apps/server/src/imageNormalization.test.ts`
- `apps/server/src/testFixtures/heic.ts`
- `docs/fork/image-normalization.md`

Shared touchpoints are the server package/lockfile and orchestration upload normalizer.

Invariants:

- Normalize once at shared upload ingestion, before attachment metadata/path creation, so all
  providers and persisted assets see the same JPEG.
- Recognize HEIC-family MIME types and bounded ISO-BMFF major/compatible HEIC brands. A correctly
  signed `application/octet-stream` upload is allowed; unrelated non-image payloads are rejected.
- Do not treat AVIF's `avif` brand as HEIC merely because it uses an ISO-BMFF container.
- Decode in a resource-limited worker, enforce pixel/time/output bounds, and preserve byte-for-byte
  pass-through for supported non-HEIC images.

### FORK-CODEX-001

Fork-owned paths:

- `apps/server/src/provider/CodexMcpApproval.ts` and its tests
- `docs/fork/codex-mcp-tool-approvals.md`

Shared touchpoints include Codex session/adapter mapping, request contracts, orchestration activity
projection, and web/mobile approval derivation/actions.

Invariants:

- Handle `mcpServer/elicitation/request` only when it is an empty form explicitly tagged
  `_meta.codex_approval_kind: "mcp_tool_call"`. Cancel rich forms, URLs, and unknown elicitations;
  Tangent does not implement arbitrary MCP elicitation UI.
- Preserve `accept`, `decline`, and `cancel` semantics. Advertise session approval only when Codex
  includes `session` in `_meta.persist`.
- Label the request as an MCP tool call, not as a guaranteed computer-use call.
- Remove this extension when the upstream Codex adapter handles the same tagged request and
  persistence contract end to end.

### FORK-PALETTE-001

Shared touchpoints:

- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/CommandPalette.logic.ts`
- `apps/web/src/components/CommandPalette.logic.test.ts`

Keep unmodified Control-N and Control-P mapped to the palette's existing next/previous navigation,
including wraparound, highlighted-item state, and scrolling. Do not install global handlers outside
the open palette. Remove this delta when upstream provides equivalent control-key navigation.

### FORK-LINEAR-001

Fork-owned paths:

- `packages/contracts/src/linear.ts`
- `packages/shared/src/linear.ts`
- `apps/server/src/linear/`
- `apps/web/src/components/linear/`
- `apps/web/src/components/settings/LinearIntegrationSettings.tsx`
- `docs/fork/linear-pr-destinations.md`

Shared upstream touchpoints are additive settings/RPC registrations, server secret materialization
and WebSocket wiring, the Source Control settings page, the PR badge in the default sidebar, and
additive presentation metadata on the existing right-panel browser surface.

Invariants:

- Scope stays on the default web/desktop sidebar. Do not modify `LegacySidebar` or mobile for this
  feature without registering an explicit expansion.
- A missing Linear configuration preserves the upstream direct-GitHub badge behavior.
- Linear ticket lookup is server-owned, lazy on badge/menu activation, and keyed by the canonical
  GitHub PR URL. Never poll Linear from Git/VCS status refreshes, render, or hover.
- The Linear API key remains in `ServerSecretStore`, is redacted from settings snapshots, and must
  not appear in logs, persisted settings, or cache keys.
- Linear Review eligibility is an explicit normalized `owner/repository` allowlist. Never infer it
  from opaque attachment metadata or offer a Review URL for an unlisted repository.
- Successful destinations cache for one hour, successful no-link results for five minutes, and
  transient failures back off from 20 seconds to 15 minutes. In-flight requests deduplicate, the
  last success survives transient errors, Refresh bypasses the cache, and all cache state remains
  in memory.
- Linear destinations use the existing desktop right-panel browser; runtimes without that browser
  open them externally. GitHub remains external.
- Linear browser surfaces reuse the desktop preview partition scoped by environment, so Linear
  cookies persist across thread tabs and app restarts. Their dedicated toolbar hides the generic
  address bar and keeps Review and resolved ticket navigation visible.

Remove or reduce this feature when upstream owns equivalent server-secure Linear resolution and
default-sidebar destination behavior. Prefer adapting upstream seams over preserving duplicate
fork UI or transport machinery.

## Merged upstream baseline

The most recently merged upstream comparison baseline is `89ee692bf`, merged into Tangent as
`fe73e1687` on 2026-08-08. Update this line and the dated sync audit whenever Tangent merges a newer
upstream baseline.

## Required verification

Every completed fork change runs:

```sh
vp check
vp run typecheck
```

Run `vp run lint:mobile` when mobile TypeScript, configuration, or native code changes. Run the
focused commands from the registry for touched features. User-visible web/mobile work also receives
one integrated client pass. Before a release, verify personal identity, build/release inputs, clean
git scope, and workflow availability; never put credentials in commits, logs, issues, or chat.
