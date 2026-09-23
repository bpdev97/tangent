# FORK-HERMES-001: Hermes provider

## Why

Hermes Agent is not an upstream provider, and it is the maintainer's main agent. Tangent integrates
it through Hermes's TUI gateway, not ACP. Hermes recommends the gateway for hosts that need the full
interactive agent: durable sessions, streaming messages and reasoning, tools, approvals,
clarifications, attachments, model selection, steering, rollback, subagents, and utility calls,
all over one JSON-RPC protocol. ACP exposes much less of that. v2's generic ACP registry adapter is
therefore not a substitute.

Hermes runs on a headless host alongside the Tangent server, so Tangent also has to keep Hermes
up to date from a remote client.

Primary references (read these at the release tag you are checking):

- [Programmatic integration guide](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)
- [Gateway protocol types](https://github.com/NousResearch/hermes-agent/blob/main/ui-tui/src/gatewayTypes.ts)
- [Gateway server handlers](https://github.com/NousResearch/hermes-agent/blob/main/tui_gateway/server.py),
  including `DESKTOP_BACKEND_CONTRACT`
- [WebSocket transport](https://github.com/NousResearch/hermes-agent/blob/main/tui_gateway/ws.py)
- [Gateway TypeScript client](https://github.com/NousResearch/hermes-agent/blob/main/apps/shared/src/json-rpc-gateway.ts)

Hermes's "Gateway Internals" page documents its separate messaging gateway, not the TUI gateway.
Do not use it as a protocol reference.

## Behavior

Process model:

- One provider instance maps to one explicit Hermes profile and owns one supervised backend:
  `hermes --profile <profile> serve --isolated --host 127.0.0.1 --port 0`.
- Tangent passes a random `HERMES_DASHBOARD_SESSION_TOKEN`, reads the port from
  `HERMES_BACKEND_READY port=<port>`, and connects only over loopback with that token.
- `HERMES_DESKTOP=1` stays unset. It would start Hermes's desktop cron ticker and change who owns
  scheduled work.
- Each active thread has its own WebSocket connection and live Hermes session. Hermes owns the
  transcript in its profile database. Tangent stores v2 events and the durable Hermes session key as
  the provider thread's native ID, never the short live gateway ID.
- Model discovery (`model.options`), slash commands (`commands.catalog`), readiness
  (`setup.status`), and small text-generation jobs (`llm.oneshot`) share the instance's gateway
  process and do not add turns to any transcript.

Mapping to v2 (`apps/server/src/orchestration-v2/ProviderAdapter.ts`):

- `session.create` and `session.resume` open and resume provider threads.
- `prompt.submit` starts a turn and is supervised without blocking the adapter. Text sent while a
  turn is running uses `session.steer`.
- `message.*` and `reasoning.delta` become message and turn-item updates. `message.interim`
  seals a commentary segment without ending the turn. A terminal response marked
  `response_previewed` is de-duplicated against those segments. `reasoning.available` only
  repeats the reply text, and `thinking.delta` is Hermes's spinner line
  (`(◔_◔) processing...`), so neither is shown.
- `tool.*` becomes execution nodes. A tool start is published immediately so running tools are
  visible. Arguments are normalized into the shared shapes (commands, changed paths, search
  queries, URLs, image prompts, MCP identities, delegated tasks). Raw arguments are kept only for
  MCP calls. Hermes reports a stopped command as an ordinary result (exit 130), so a tool that
  finishes after a stop request is marked interrupted.
- `subagent.*` becomes v2 subagents, keyed by the required `subagent_id`. Each gets a child
  thread (the goal, each tool it reports, then its summary), because clients open a subagent only
  through its child thread. Hermes delegates asynchronously, so `subagent.complete` usually
  arrives after the spawning turn has ended. A known subagent's frames are therefore applied
  whenever they arrive, stamped with the spawning run, and never buffered into a background
  turn; that run keeps reading events until its subagents settle. `subagent.thinking` is not
  shown, because it is the child's spinner line and clipped reply.
- Stopping any Hermes turn stops every running subagent (Hermes stops the whole tree). Each
  reports an interrupted completion, and Hermes then starts a turn of its own to report it, so a
  stop can be followed by a short "background work finished" run. That is Hermes behavior; the
  gateway has no option to skip it.
- Contract 7 delivers approvals and questions as server→client JSON-RPC requests (`srq-…` frames),
  answered with a response frame carrying the same id. Tangent advertises
  `client.capabilities {server_requests: true}` on every session connection and refuses request
  kinds it has no surface for (desktop reads, vault prompts, tours) so Hermes fails fast.
- `approval` becomes a runtime request. Accept, accept-for-session, and decline map to `once`,
  `session`, and `deny`. A subagent's approval can arrive after its turn has ended, and it
  carries no subagent identity, so a request with no active turn belongs to the turn that
  spawned the newest running subagent.
- `clarify`, `sudo`, and `secret` become user-input runtime requests. They keep Hermes request and
  question IDs. Batched questions are answered one at a time with `clarify.lock`, and multi-select
  answers use Hermes's JSON-array format. A question with no options is a valid open-ended prompt.
  `request.cancel` withdraws the matching request.
- `session.usage` updates the context-window usage. Completion, `session.interrupt`, and failures
  end the turn. Any open approval or question the turn owns is resolved when it ends, so a
  "waiting on you" state never outlives the Hermes callback it represents.
- `session.undo` implements rollback. Capabilities declare only what the gateway supports; anything
  else falls back to v2's portable handoff.
- Hermes's `MEDIA: <path>` output becomes an ordinary Markdown file link while text streams. Only a
  possible partial directive is buffered, and a leading `~/` expands on the Hermes host. Web,
  desktop, and mobile then open it through the shared host-file path.
- Submitted slash commands use `slash.exec`, falling back to `command.dispatch`. A dispatch that
  returns a prompt is sent with `prompt.submit`; direct command output becomes assistant output.
  Manual compaction uses Hermes's `/compress`.
- `config.set` switches the model. Model IDs are qualified as `<provider>:<model>` so Hermes never
  has to guess the provider.
- Runtime modes: `full-access` answers each approval with `once`. `approval-required` and
  `auto-accept-edits` both surface approvals, because the gateway has no session-local equivalent of
  "accept edits" and treating it as full access would widen authority.
- Hermes starts turns on its own when background work finishes (a background process with
  completion notify, an async delegation, a loop, heartbeat, goal, or kanban notification). A
  `message.start` with no T3 run opens a buffered background turn and offers one
  `adapter_buffered` provider continuation (`ProviderContinuationRequests`), the same mechanism
  Claude uses for background-task wakes. The orchestrator queues a provider-created run whose
  notification row reads "Hermes background work finished", with the preceding `status.update`
  text as detail. That run never calls `prompt.submit`: it replays the buffer and follows live
  frames until `message.complete`. A run that finds no buffer (the session restarted) settles at
  once. Buffers are bounded: past the cap, streaming deltas are shed and each segment takes Hermes's
  final text; turn boundaries, tool and subagent results, and questions are always kept.
- While a background turn runs, a new T3 run's prompt is sent with `queued: true`, so Hermes runs it
  next instead of redirecting its own turn; slash commands wait for `message.complete`. Stopping
  that waiting run sends `session.interrupt`, which stops the background turn and clears Hermes's
  queue, then settles the run. Steering it is refused until its own turn starts. A question the
  background turn raises while nothing waits surfaces in its continuation run. A self-started turn
  that begins while a T3 run is active is part of that run.
- An unexpected socket close fails the active turn and reports a recoverable session exit.
- Ordering: every gateway frame and supervised-RPC result enters one inbox per session and is
  handled under one permit, which adapter calls that change turn state also take. The v2 session
  manager already opens one runtime per provider session, so there are no per-thread locks.

Updates:

- The provider snapshot reports the installed version and gateway contract from the gateway
  (`version`, `update_behind`, `update_command`). The latest version comes from GitHub releases.
  Hermes only reports these in `session.info`, so when no session has described the gateway yet
  the snapshot opens a hidden probe session (never submitted, so nothing is persisted) and closes
  it once `session.info` arrives. `hermes --version` is the fallback version.
- The update action runs through upstream's provider maintenance framework
  (`apps/server/src/provider/providerMaintenance.ts`) and runs the gateway-reported
  `update_command` under the lock key `hermes-native`, because install methods differ (a source
  install reports `hermes update`, Docker a `docker pull`, Nix only guidance, which gets no one-click
  action). Before running it, it refuses while any Hermes turn is running and stops the gateway
  processes of every Hermes instance, because the update replaces the install they all run from.
  Afterwards it re-reads the version and contract. Gateways restart on their next request.
- Updates are one click from the version details on any client. Tangent never updates Hermes
  unprompted.
- A gateway below the minimum contract is reported as incompatible, with the update action, instead
  of failing mid-turn.

Compatibility baseline: Hermes Agent 0.21.4 (`v2026.9.21`), gateway contract 7, which is also the
minimum. Because Tangent can update Hermes itself, it does not keep workarounds for older gateways.
The values live in `downstream/fork.json` under `hermes`.

## Upstream hooks

Registration follows Pi's (`PiDriver`, `PiAdapterV2`). Each hook carries a
`Tangent(FORK-HERMES-001)` comment:

- `apps/server/src/orchestration-v2/builtInProviderAdapterDrivers.ts`: registers
  `HermesAdapterV2Driver`.
- `apps/server/src/provider/builtInDrivers.ts`: registers `HermesDriver` and its environment.
- `apps/server/src/provider/providerMaintenance.ts` and `providerMaintenanceRunner.ts`: an optional
  `guard` on the update action that wraps the command. Hermes uses it to drain and stop gateways.
- `packages/contracts/src/settings.ts`: `HermesSettings` (binary path and profile). There is no
  legacy `providers.hermes` entry, so every Hermes instance is explicit.
- `packages/contracts/src/model.ts`: the `hermes` default model (`default`) and display name.
- `apps/web/src/components/settings/providerDriverMeta.ts`: the Hermes settings form, with no
  default instance.
- `apps/web/src/components/chat/ProviderInstanceIcon.tsx`: the Hermes icon and color.
- `apps/web/src/components/settings/ProviderModelsSection.tsx`: the custom-model placeholder.
- `apps/mobile/src/components/ProviderIcon.tsx` and `apps/mobile/src/lib/modelOptions.ts`: the icon
  and provider label.

Fork-owned files: `apps/server/src/provider/hermes/` (gateway client, supervised runtime and fleet,
support, media links, tool projection, background-turn buffer, utility calls, provider snapshot,
driver, text generation, updater), `apps/web/src/components/HermesIcon.tsx`,
`apps/server/src/orchestration-v2/Adapters/HermesAdapterV2.ts` with its testkit and fixtures,
`apps/server/src/orchestration-v2/HermesOrchestratorV2.live.test.ts`, and `docs/user/hermes.md`.

## Resolving conflicts

- Registration files: take upstream's version and add the Hermes entry back next to Pi's.
- If upstream changes the v2 adapter interface, change the Hermes adapter to match, using Pi's and
  Codex's adapters as the reference for the new shape. Do not add compatibility shims to upstream
  code.
- If upstream adds a provider feature (a new capability, runtime request type, or event), decide
  whether Hermes supports it. When the gateway has no equivalent, declare it unsupported.
- If upstream changes the maintenance framework, keep Hermes's drain-before-update rule and move
  the rest to the new shape.
- If upstream changes `ProviderContinuationRequests` or how continuation runs are marked
  (`createdBy: "agent"`, `creationSource: "provider"`), follow `ClaudeAdapterV2`'s wake handling
  and keep Hermes's background turns on the same path. Do not add a Hermes-specific orchestrator
  hook.

## Never

- Never share a gateway process, profile, model cache, token, or session state between provider
  instances.
- Never bind the backend beyond loopback, reuse a fixed token, or drop `--isolated`.
- Never turn a session approval into Hermes's permanent `always` scope.
- Never add a second Hermes transcript store. Hermes owns the transcript.
- Never convert image formats in the adapter. HEIC handling belongs to `FORK-IMAGE-001` at upload
  ingestion.
- Never put the dashboard token, raw stderr, secrets, or unredacted provider data in user-facing
  errors or logs.
- Never run Hermes setup (`hermes --profile <profile> model`) from Tangent. Report the command;
  setup stays in the terminal.
- Never run the update command while a Hermes turn is active, or without stopping the
  gateways first.
- Never enable Hermes's desktop cron ticker, and do not bring back automation management.

## Remove when

Upstream ships a Hermes provider that uses the TUI gateway (or an equivalent full protocol) with
profile-aware instances, resume, approvals, clarifications, subagents, and rollback. Compare it
against the Behavior section, then delete this adapter and move to upstream's.

## Verify

- Adapter tests with recorded fixtures from the baseline release cover: a normal turn, tools, a
  subagent, an approval, a multi-question clarification, steering, interrupt, rollback, `MEDIA:`
  links, resume after a server restart, and background turns (one continuation offer, live and
  replayed attachment, a queued user message, interrupts, and the buffer cap).
- Updater tests with a fake `hermes` binary cover: refusing during an active turn, stopping and
  re-probing gateways, and reporting an incompatible contract.
- An opt-in live test runs against the real binary on the Hermes host, including one async
  delegation that must settle into a child thread and the wake turn that reports it. The live
  layer adds the continuation worker, which only the production layer includes; without it
  wake turns never start.
- Approval prompts need a profile with `approvals.mode: manual`; the default `smart` mode lets
  Hermes's guardian model approve ordinary commands itself, so they never reach T3. Use a
  throwaway profile (`hermes profile create <name> --clone`), which inherits the root login
  instead of copying it. Never copy `auth.json`: Codex refresh tokens rotate.

To move the baseline to a new Hermes release:

1. Compare the reference sources above between the two release tags, including
   `DESKTOP_BACKEND_CONTRACT`.
2. Update mappings and fixtures only for changes that affect them.
3. Run the focused tests and the live test.
4. Update `hermes` in `downstream/fork.json`. Raising the minimum contract blocks automatic release.
