# FORK-TOOLS-001: structured tool-call presentation

This patch replaces the single-line/raw-JSON tool log with one cross-platform presentation model.
It is fork-owned and intentionally additive: provider adapters keep emitting canonical lifecycle
events, orchestration retains enough information to correlate them, and each client renders the same
structured sections with platform-native components.

## Architecture

The data flow is:

1. Provider adapters normalize Codex, ACP, and Claude events into canonical runtime item events.
2. Runtime ingestion preserves `itemId`, lifecycle status, title, detail, and a bounded JSON-safe
   copy of provider data on started, updated, and completed activities. When data is reduced, the
   activity includes `dataTruncation` metadata. `tool.progress` is projected as an in-progress
   activity using the provider item or tool-use ID.
3. `@t3tools/client-runtime/tool-calls` decodes the provider payload into a
   `ToolCallPresentation`. It owns category detection, lifecycle status, command metadata, search
   queries, outputs, file changes and diffs, MCP arguments/results, links, and copy text.
4. Web and mobile attach that presentation while deriving their existing work logs. Lifecycle rows
   with the same stable call ID merge even when another activity occurs between them.
5. The web timeline renders labeled terminal, JSON, file, diff, and link sections inline. Mobile
   renders the same sections in a touch-friendly disclosure with a 44-point row target.

Provider-shape handling must stay in the shared projector. Do not add Codex-, ACP-, Cursor-, or
Claude-specific decoding to either UI.

## Performance and failure behavior

- Provider data is bounded before the append-only orchestration event is written: depth, collection
  fan-out, node count, individual strings, aggregate characters, and serialized bytes all have
  limits. Long strings retain both ends, and `dataTruncation` records the reasons plus omitted
  counts so partial diagnostics are never mistaken for lossless output.
- Individual rendered text sections are bounded to 32,000 characters by retaining their beginning
  and end. This prevents a large command result from locking either client while keeping useful
  failure context.
- Client-side fallback JSON serialization applies its own bounded copy before `JSON.stringify`, so
  legacy or locally constructed activities cannot bypass the ingestion limit. Recursive collectors
  use node budgets; a presentation collects at most 20 search queries, 50 files, 12 links, 20 ACP
  content blocks, and 20 terminal IDs.
- Projection snapshots and targeted thread detail queries return the latest 500 activities per
  thread, matching the in-memory projector. The projection table remains rebuildable history for
  shell-summary derivations, while reconnect payloads cannot grow without bound.
- Mobile retains each derived feed by immutable thread-snapshot identity. Reopening an unchanged
  thread reuses the projection, while a replacement snapshot invalidates it automatically and the
  weak cache does not extend the snapshot's lifetime.
- Mobile derives and weakly caches only collapsed-row summaries for immutable activity objects.
  Structured sections, bounded JSON, diffs, and copy text are projected on first expansion or copy
  and then weakly cached for subsequent use.
- Three recent work-log rows remain visible before the existing disclosure folds older work.
- Unknown tool shapes fall back to a bounded JSON details section instead of disappearing.
- Explicit lifecycle status and exit code win over text heuristics. Legacy activities still use the
  existing error-text fallback.

Command-output deltas remain runtime events rather than persisted work-log entries. Adding truly
live output should use an ephemeral/coalesced stream and must not append one database activity per
delta. Approval cards also remain the authoritative action surface; this patch only improves the
related tool presentation.

## Upstream sync checklist

1. Preserve the extra lifecycle payload fields and pre-persistence bounding when resolving
   ingestion conflicts.
2. Keep `packages/client-runtime/src/tool-calls/` provider-neutral and free of React or React Native
   dependencies.
3. Reapply platform rendering as small components rather than copying the projector into either app.
4. Confirm in-progress calls remain visible and completed calls replace their earlier lifecycle rows.
5. Check large command output, file diffs, MCP arguments/results, unknown-provider fallback, and the
   explicit payload-truncation notice on a narrow mobile viewport and desktop.

## Verification

```sh
vp test packages/shared/src/toolActivity.test.ts \
  packages/client-runtime/src/tool-calls/index.test.ts \
  apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts \
  apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.test.ts \
  apps/web/src/session-logic.test.ts \
  apps/web/src/components/chat/MessagesTimeline.logic.test.ts \
  apps/web/src/components/chat/MessagesTimeline.test.tsx \
  apps/mobile/src/lib/threadActivity.test.ts \
  apps/mobile/src/features/threads/threadFeedLayout.test.ts
vp check
vp run typecheck
vp run lint:mobile
```
