# Tangent fork index

Tangent is a personal distribution of [T3 Code](https://github.com/pingdotgg/t3code), maintained at
[`bpdev97/tangent`](https://github.com/bpdev97/tangent). It installs beside the official app, ships
its own macOS, iOS, and server releases, and carries a small set of features upstream does not have. It does not ship Android or Windows and
Linux desktop builds; fork features leave upstream's code for those surfaces unchanged.

This file is the index. Each feature's record in [`docs/fork/`](docs/fork/) is the authority for
why the feature exists, what must stay true, where it hooks into upstream, how to resolve conflicts,
and when to delete it. [`downstream/fork.json`](downstream/fork.json) records the upstream base and
the feature list, and `node scripts/check-fork.ts` checks that every commit belongs to a feature.

## How the fork is built

Tangent is a stack of commits on top of upstream, with one commit per feature. The upstream base is
`t3code/codex-turn-mapping`, the orchestration-v2 integration branch (upstream PR #2829). Tangent
switches to upstream `main` when that PR merges. Upstream rebases the integration branch often, so
Tangent is rebased onto it rather than merging it. `downstream/fork.json` records the exact upstream
commit the stack sits on.

- Every commit carries a `Fork-Feature: FORK-…` trailer. Follow-up changes are `fixup!` commits
  folded into their feature commit on the next sync.
- Fork code lives in new files. Upstream files get only small hooks marked `Tangent(FORK-ID)`, and
  each record lists its hooks. `check-fork` reports how many upstream files each feature touches; a
  sync that grows that number is not published automatically.
- Syncing and releasing use the [`tangent-sync` skill](.agents/skills/tangent-sync/SKILL.md).

## Branch and release policy

- `main` is the released stack. Only the sync process rewrites it, always with
  `--force-with-lease`. Anyone else changes `main` through pull requests.
- `archive/v1-main` preserves the pre-v2 Tangent history.
- Releases use immutable `personal-vX.Y.Z` tags, so every installed build stays reproducible after
  `main` is rebased.
- macOS, server archives, and `SHA256SUMS` are built by `personal-macos-release.yml`. iOS native
  builds and OTA updates use the EAS `personal` channel through `personal-ios-release.yml`.
- Upstream's release workflows remain in the tree for mergeability and must stay disabled in this
  repository's Actions settings. Tangent workflows begin with `personal-`.

## Features

| ID                 | Why it exists                                                                                                                                 | Record                                                  | Status |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| `FORK-MAINT-001`   | Keeps the fork cheap and safe to sync: feature records, checks, the sync skill, agent guidance                                                | [maintenance](docs/fork/maintenance.md)                 | Active |
| `FORK-DIST-001`    | Installs, updates, and stores state separately from the official app, and ships its own releases                                              | [distribution](docs/fork/distribution.md)               | Active |
| `FORK-HERMES-001`  | Hermes Agent is not an upstream provider; Tangent integrates it natively through its TUI gateway, including in-app updates for headless hosts | [Hermes](docs/fork/hermes.md)                           | Active |
| `FORK-CHAT-001`    | Upstream threads always belong to a project; Tangent adds chats with no project attached                                                      | [generic chat](docs/fork/generic-chat.md)               | Active |
| `FORK-PUSH-001`    | The personal build has no Clerk or managed relay; a self-hosted relay delivers iOS notifications and Live Activities                          | [push relay](docs/fork/push-relay.md)                   | Active |
| `FORK-IMAGE-001`   | Photos from iPhones must work with every provider: HEIC conversion, mobile shrinking, and camera capture                                      | [image normalization](docs/fork/image-normalization.md) | Active |
| `FORK-MERMAID-001` | Agents often answer with Mermaid diagrams; web and desktop render them safely                                                                 | [Mermaid](docs/fork/mermaid.md)                         | Active |
| `FORK-PALETTE-001` | Control-N and Control-P move through the command palette, matching macOS and Emacs habits                                                     | [command palette](docs/fork/palette.md)                 | Active |
| `FORK-MCP-001`     | Agents on every provider reach the same HTTP MCP servers, such as executor, configured once per environment                                   | [MCP servers](docs/fork/mcp-servers.md)                 | Active |

"Planned" means the record exists but the feature has not been ported to the v2 base yet.

## Removed, do not reintroduce

Do not bring these back while resolving conflicts. Reintroducing one needs a new record and a
stated reason.

| Former behavior                                                                                                                                                                                                    | Why it was removed                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Hermes automation management (cron list, editor, web and mobile routes)                                                                                                                                            | No longer wanted. Hermes manages its own schedules.                         |
| iOS home chat composer, macOS Quick Chat, the Raycast Quick Chat hook, preferred chat host                                                                                                                         | Dropped with the v2 rebuild; may be redesigned later.                       |
| iOS App Shortcuts (`FORK-SHORTCUTS-001`)                                                                                                                                                                           | Dropped with the v2 rebuild.                                                |
| Settled preview suspension (`FORK-PREVIEW-001`)                                                                                                                                                                    | Dropped with the v2 rebuild.                                                |
| Linear integration (`FORK-LINEAR-001`)                                                                                                                                                                             | Deprecated on 2026-09-11. Stored credentials are left untouched and unused. |
| Codex MCP approval patch, Claude and Cursor lifecycle patches, rich tool rendering, provider-neutral `agent.*` events, mobile rendering patches, activity retention limits, response grouping, smart-dash override | Upstream owns these behaviors.                                              |

## Required verification

Every fork change runs:

```sh
node scripts/check-fork.ts
vp check
vp run typecheck
```

Also run the focused tests `check-fork` prints for the features you touched, and
`vp run lint:mobile` when mobile TypeScript, configuration, or native code changes. User-visible
changes get one integrated client pass against isolated state. Never put credentials in commits,
logs, issues, or chat.
