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

Canonical distribution identity is composed in [`downstream/config.ts`](downstream/config.ts).
The mobile-only identity slice lives in
[`downstream/mobile-config.ts`](downstream/mobile-config.ts) so Expo fingerprinting does not absorb
desktop-only release configuration. Credentials belong only in GitHub Actions, Expo, App Store
Connect, or deployed secret files.

The Tangent name exists to distinguish the installed fork, its releases, and its runtime state from
upstream. In-app product vocabulary, wordmarks, icons, splash artwork, notifications, and features
retain the T3 Code identity unless a distribution boundary genuinely needs to be named.

Tangent uses `~/.bpdev-code` and Electron's `bpdev-code` directory. It must never fall back to the
official app's state or update source. Each macOS release includes
`tangent-server-X.Y.Z.tgz` and its SHA-256 sidecar; local update, SSH launch, service installation,
and pinned runtime resolution all use that verified GitHub Release artifact rather than the
upstream npm package.

## Active fork features

The dated [2026-08-01 audit](docs/fork/audit-2026-08-01.md) records the complete downstream commit
ledger and keep/restore review. The [2026-08-08 sync audit](docs/fork/audit-2026-08-08.md) records
the previous upstream merge. The [2026-08-10 sync audit](docs/fork/audit-2026-08-10.md) records the
next merge, the [2026-08-16 sync audit](docs/fork/audit-2026-08-16.md) records the following merge,
the [2026-08-21 sync audit](docs/fork/audit-2026-08-21.md) records the next merge, the
[2026-08-26 sync audit](docs/fork/audit-2026-08-26.md) records the previous merge, and the
[2026-08-27 sync audit](docs/fork/audit-2026-08-27.md) records the previous merge, and the
[2026-08-29 sync audit](docs/fork/audit-2026-08-29.md) records the latest upstream merge,
compatibility decisions, and verification.

| ID                 | Kept behavior                                                                                | Status               | Maintenance record                                                    | Focused verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FORK-DIST-001`    | Tangent distribution identity, macOS/iOS release, server self-update, and service boundaries | Active               | [Personal distribution](docs/personal-distribution.md)                | `vp test scripts/personal-distribution-identity.test.ts scripts/build-desktop-artifact.test.ts apps/server/src/cloud/bootService.test.ts apps/server/src/cloud/serverRelease.test.ts apps/server/src/cloud/pinnedRuntime.test.ts apps/server/src/cloud/selfUpdate.test.ts apps/server/src/cli/service.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts packages/ssh/src/command.test.ts`                                                                                                                                                                                                                                                                                            |
| `FORK-CHAT-001`    | Managed generic chats, preferred hosts, iOS composer, and macOS Quick Chat                   | Active               | [Generic chat](docs/fork/generic-chat.md)                             | `vp test packages/shared/src/genericChat.test.ts packages/contracts/src/settings.test.ts packages/client-runtime/src/state/projectGrouping.genericChat.test.ts apps/server/src/genericChat.test.ts apps/server/src/orchestration/Layers/ProviderCommandReactor.genericChat.test.ts apps/web/src/lib/chatThreadActions.test.ts apps/web/src/lib/quickChat.test.ts apps/desktop/src/app/DesktopQuickChat.test.ts apps/desktop/src/app/DesktopLifecycle.test.ts apps/desktop/src/window/DesktopWindow.test.ts`                                                                                                                                                                                |
| `FORK-HERMES-001`  | Hermes TUI-gateway provider and automation management                                        | Active, early access | [Hermes](docs/fork/hermes.md)                                         | `vp test apps/server/src/provider/hermes apps/server/src/persistence/Migrations/044_TangentMigrationCompatibility.test.ts packages/client-runtime/src/operations/hermesAutomations.test.ts apps/web/src/components/settings/SettingsPanels.logic.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `FORK-PUSH-001`    | Personal APNs notifications and Live Activities                                              | Active               | [Personal push relay](docs/fork/personal-push-relay.md)               | `vp test apps/push-relay/src apps/server/src/personalPush apps/server/src/relay/AgentAwarenessRelay.test.ts apps/server/src/environment/ServerEnvironment.test.ts apps/mobile/src/features/agent-awareness/remoteRegistration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `FORK-IMAGE-001`   | Shared HEIC/HEIF-to-JPEG upload normalization                                                | Active               | [Image normalization](docs/fork/image-normalization.md)               | `vp test packages/contracts/src/orchestration.test.ts apps/server/src/imageNormalization.test.ts apps/server/src/orchestration/Normalizer.test.ts apps/mobile/src/lib/composerImages.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `FORK-PALETTE-001` | Control-N/Control-P command-palette navigation                                               | Active, temporary    | [Ownership map](#fork-palette-001)                                    | `vp test apps/web/src/components/CommandPalette.logic.test.ts` plus a web keyboard smoke test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `FORK-LINEAR-001`  | Linear ticket and Review destinations from new-sidebar GitHub PR badges                      | Active               | [Linear PR destinations](docs/fork/linear-pr-destinations.md)         | `vp test packages/shared/src/linear.test.ts packages/contracts/src/settings.test.ts apps/server/src/linear/LinearIntegration.test.ts apps/server/src/serverSettings.test.ts apps/desktop/src/electron/ElectronShell.test.ts apps/desktop/src/preview/BrowserSession.test.ts apps/web/src/browser/openFileInPreview.test.ts apps/web/src/components/linear/linearPreviewPresentation.test.ts apps/web/src/components/linear/linearPrPrimaryDestinations.test.ts apps/web/src/components/linear/openLinearDestination.test.ts apps/web/src/components/linear/openLinearPreviewDestination.test.ts apps/web/src/rightPanelStore.test.ts apps/web/src/components/preview/PreviewView.test.tsx` |
| `FORK-MERMAID-001` | Secure, streaming-aware Mermaid diagrams in web and desktop Markdown                         | Active, temporary    | [Mermaid diagrams](docs/fork/mermaid.md)                              | `vp test apps/web/src/components/MermaidDiagram.test.tsx` plus a web light/dark smoke test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FORK-PREVIEW-001` | Suspend inactive browser webviews for explicitly settled threads                             | Active               | [Settled preview suspension](docs/fork/settled-preview-suspension.md) | `vp test apps/web/src/browser/browserSessionSuspension.test.ts apps/web/src/browser/desktopTabLifetime.test.ts apps/web/src/AppRoot.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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

## Restored to upstream on 2026-08-26

| Former delta                                     | Restored behavior                                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex MCP tool-call approvals (`FORK-CODEX-001`) | Upstream now owns Codex MCP elicitation and app-access approval choices, runtime ingestion, activity projection, and web/mobile approval presentation. Tangent's parser, request kind, UI branch, tests, and maintenance record were removed. |

## Ownership and sync rules

### FORK-DIST-001

Fork-owned paths:

- `downstream/config.ts`
- `downstream/mobile-config.ts`
- `.github/workflows/personal-*.yml`
- `apps/mobile/src/features/updates/app-updates.ts` and its focused test
- `docs/personal-distribution.md`
- `scripts/personal-distribution-identity.test.ts`

Shared upstream touchpoints:

- distribution identity consumers under `apps/web`, `apps/desktop`, and `apps/mobile`;
- `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, and widget asset configuration;
- desktop package, environment, launcher, window, and packaging scripts;
- server release, pinned-runtime, self-update, service, CLI, and SSH-launch paths;
- install, update, and operations documentation.

Invariants:

- Preserve the repository, `personal-v` tag prefix, `tangent-server` artifact prefix,
  `tangent.service`, `com.bpdev97.tangent.service` launchd label, source-identity sentinel,
  personal Expo channel, bundle IDs, URL schemes, and separate state roots.
- Keep T3 Code visual assets and in-app feature vocabulary aligned with upstream. Tangent belongs
  only at an install, release, update, service, state, or compatibility boundary.
- The updater streams into a unique temporary file, verifies SHA-256 before rename, and retains the
  current plus one prior archive. Never restore whole-response archive buffering.
- Automatic mobile update checks treat network and dev-client errors as recoverable operation
  failures. They stay quiet on launch; a user-initiated check reports the error in the settings UI.
- A matching upstream package version is not an equivalent update source.
- Release workflows must not publish unless checks pass and the requested version is absent.
- Mobile and Expo consumers import only `downstream/mobile-config.ts`; desktop-only identity changes
  must not alter the iOS runtime fingerprint.

### FORK-CHAT-001

Fork-owned paths:

- `packages/shared/src/genericChat.ts`
- `apps/server/src/genericChat.ts` and focused generic-chat tests
- `apps/mobile/src/features/threads/use-start-generic-chat.ts`
- `apps/mobile/src/features/home/HomeChatComposer.tsx`
- `apps/mobile/src/features/threads/ProjectThreadRouteGuard.tsx`
- `apps/desktop/src/app/DesktopQuickChat.ts`
- `scripts/raycast-tangent-quick-chat.sh`
- `docs/fork/generic-chat.md`

Shared upstream touchpoints include client settings, project grouping, server startup, provider
session creation, desktop lifecycle/window/packaging, web sidebar/settings, iOS home navigation and
composer layout, new-thread actions, and the web/mobile project-capability seams.

Invariants:

- `t3code-generic-chat` is the stable capability marker. Never infer the feature from a title or
  path, and never create per-device IDs.
- Startup creates or repairs the managed project without replacing its model preference or
  deleting threads.
- Every turn receives only factual no-project and scratch-cwd context, uses `approval-required`, and
  is pinned to the app-owned scratch cwd even when stale thread metadata contains a worktree. Do not
  add a separate generic-chat tool policy on top of the provider's native behavior.
- Web and mobile hide files, Git, worktrees, terminals, diffs, scripts, and related deep links.
- The context and cwd are not a provider-independent filesystem jail. Do not document them as
  containment.
- Conversation folding, activities, and tool calls stay upstream-owned.
- An explicitly selected chat host is strict. If it is unavailable, retain the draft and show the
  failure; never choose a different environment silently.
- `bpdev-code-action://quick-chat` is a fixed desktop action, not a renderer navigation surface.
- Android keeps the upstream home layout unless it is separately reviewed and registered here.

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

Current compatibility baseline: Hermes Agent 0.20.0, TUI gateway contract 5. Contract 2 remains
the minimum because the required methods are still compatible and the newer contracts are additive.
Revalidate the programmatic guide, gateway types/transport/server handlers, focused fixtures, and a
real binary before raising the baseline. Remove this feature only when upstream can continue or
migrate the versioned sessions and provides equivalent profile-aware gateway behavior.

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
  open them externally. GitHub destinations use upstream's in-app pull-request viewer when the
  current environment supports it, with the upstream external-link fallback everywhere else.
- The server-scoped open-location preference applies to Review and ticket destinations. Preserve
  the historical `ticketOpenBehavior` field when changing the UI or settings schema.
- The direct Linear badge action opens the primary ticket and Review as distinct side-panel tabs, with
  Review active. In Linear-app mode it opens only Review to avoid racing two external deep links.
- Individually selected Review and ticket destinations use a validated Linear desktop-app deep
  link when that preference is selected. Allow only the exact `linear.app` and `linear.review`
  hosts.
- Linear browser surfaces reuse the desktop preview partition scoped by environment, so Linear
  cookies persist across thread tabs and app restarts. Their dedicated presentation hides the
  generic address bar, nested destination controls, and human-control chrome.
- In side-panel mode, Review and each ticket own a distinct browser tab. Reopening a destination
  activates its existing live tab; it must not navigate the current Linear webview or create a
  duplicate while that tab survives.
- Preview webviews receive the sanitized Chrome-shaped user agent directly; distribution and
  Electron product tokens must not leak back in through per-web-contents defaults.

Remove or reduce this feature when upstream owns equivalent server-secure Linear resolution and
default-sidebar destination behavior. Prefer adapting upstream seams over preserving duplicate
fork UI or transport machinery.

### FORK-PREVIEW-001

Fork-owned paths:

- `apps/web/src/browser/browserSessionSuspension.ts` and its test
- `docs/fork/settled-preview-suspension.md`

Shared upstream touchpoints are the renderer-wide browser host and its router registration in
`apps/web/src/browser/ElectronBrowserHost.tsx` and `apps/web/src/AppRoot.tsx`.

Invariants:

- An explicitly settled thread keeps its webviews while it is the active route and suspends them
  only after navigation leaves it.
- Suspension releases Electron resources without closing server preview sessions or removing
  right-panel tab state, retained URLs, cookies, or HTTP cache.
- Returning to the thread or un-settling it remounts the retained sessions.
- Apply the policy to every desktop browser preview. Do not add destination-specific lifecycle
  branches.
- Unknown or client-derived lifecycle state stays mounted; only the server-backed settled override
  authorizes suspension.

### FORK-MERMAID-001

Fork-owned paths:

- `apps/web/src/components/MermaidDiagram.tsx` and its focused test
- `docs/fork/mermaid.md`
- `docs/user/mermaid-diagrams.md`

Shared upstream touchpoints:

- `apps/web/src/components/ChatMarkdown.tsx`
- `apps/web/src/index.css`
- the web package manifest and workspace lockfile

Invariants:

- Only completed fenced `mermaid` blocks render as diagrams. Streaming blocks stay ordinary source
  so incomplete syntax never causes repeated parsing or layout churn.
- Mermaid loads on demand in the client. The server, providers, wire contracts, settings, and
  mobile client have no feature-specific code.
- Rendering is serialized because Mermaid configuration is process-global. Use strict security,
  explicit text and edge limits, and light/dark built-in themes.
- A failed render keeps the original source visible and copyable. Generated SVG never enables
  links, HTML labels, or Mermaid interaction callbacks.
- The maximized view reuses the existing render result in the shared dialog primitive. Keep it
  client-only and dependency-free; do not add browser Fullscreen API, server, or mobile branches.
- Preserve ordinary code-fence rendering and Markdown clipboard behavior around this narrow seam.

Remove this delta when upstream ships equivalent secure, streaming-aware web rendering with source
fallback and theme support. Prefer adopting its component instead of maintaining two Mermaid
pipelines.

## Merged upstream baseline

The most recently merged upstream comparison baseline is `c0e09f323`, integrated on 2026-08-29.
Update this line and the dated sync audit whenever Tangent merges a newer upstream baseline.

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
