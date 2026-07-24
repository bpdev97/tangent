# Hermes fork maintenance record

## Decision

Manual Hermes chats use Hermes Agent's official TUI gateway over authenticated loopback WebSocket.
ACP is no longer used by this provider, and this fork does not depend on Hermex or the third-party
`hermes-webui` service.

Hermes recommends the TUI gateway for custom desktop, web, and terminal hosts that need the full
interactive agent surface. It exposes durable sessions, streaming messages and reasoning, tools,
approvals, clarification, attachments, model selection, steering, rollback, subagents, and utility
generation through one JSON-RPC protocol.

Primary external references:

- [Programmatic integration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)
- [Gateway internals](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/gateway-internals.md)
- [Gateway TypeScript client](https://github.com/NousResearch/hermes-agent/blob/main/apps/shared/src/json-rpc-gateway.ts)
- [Gateway protocol types](https://github.com/NousResearch/hermes-agent/blob/main/ui-tui/src/gatewayTypes.ts)
- [Gateway server implementation](https://github.com/NousResearch/hermes-agent/blob/main/tui_gateway/server.py)
- [WebSocket transport](https://github.com/NousResearch/hermes-agent/blob/main/tui_gateway/ws.py)

## Architecture

One T3 provider instance maps to one explicit Hermes profile and owns one supervised backend:

```text
hermes --profile <profile> serve --isolated --host 127.0.0.1 --port 0
```

T3 supplies a random `HERMES_DASHBOARD_SESSION_TOKEN`, reads the selected port from
`HERMES_BACKEND_READY port=<port>`, and connects only through loopback with the token. Do not set
`HERMES_DESKTOP=1`: that enables Hermes's desktop cron ticker and would change the automation
ownership model.

Each active T3 thread has its own WebSocket connection and live Hermes session. Hermes owns the
transcript in its profile database; T3 stores canonical runtime events and a durable cursor:

```json
{
  "schemaVersion": 2,
  "transport": "tui-gateway",
  "sessionId": "20260718_..."
}
```

The cursor stores Hermes's durable session key, never the short live gateway ID. Legacy ACP cursors
are intentionally not migrated; opening one starts a new Hermes session. This loss was explicitly
accepted for the gateway migration.

The adapter and utility service share the provider instance's gateway process. Model discovery uses
`model.options`, slash-command discovery uses `commands.catalog`, readiness uses `setup.status`,
and small text-generation jobs use the stateless `llm.oneshot` method, so they do not add turns to a
chat transcript.

## Protocol mappings

- `session.create` / `session.resume` map T3 threads to Hermes-owned durable sessions.
- `prompt.submit` starts a turn but remains pending for the full Hermes agent loop. T3 supervises
  that RPC in the provider scope and returns from `sendTurn` immediately so steering and interrupt
  controls remain available; `session.steer` handles text sent during the active turn.
- `message.*`, `reasoning.*`, `tool.*`, `subagent.*`, and `background.complete` become canonical T3
  runtime events. Per-session queues preserve Hermes event order before ingestion.
- `image.attach` stages T3 image attachments before the next prompt.
- `config.set` switches a resumed or active session's model. Discovered model IDs are qualified as
  `<provider>:<model>` so provider routing is never guessed.
- `commands.catalog` supplies built-in, quick, and skill-derived slash commands. Submitted slash
  commands use `slash.exec` with `command.dispatch` fallback; dispatches that return a prompt are
  sent through `prompt.submit`, while direct command output becomes canonical assistant output.
- `session.interrupt`, `session.close`, and `session.undo` implement stop, lifecycle cleanup, and
  rollback.
- `approval.request` maps to T3 approvals. Accept, accept-for-session, and decline map to `once`,
  `session`, and `deny`; T3 never chooses Hermes's permanent `always` scope.
- `clarify.request`, `sudo.request`, and `secret.request` use T3's structured user-input path and
  retain Hermes request IDs for the corresponding response method.

`full-access` auto-accepts an individual gateway approval with `once`. `approval-required` and
`auto-accept-edits` surface approval requests. Gateway contract 2 has no session-local equivalent of
ACP's `accept_edits`; treating it as full access would widen authority, so T3 keeps the safer behavior.

## Compatibility invariants

- Provider instances must not share gateway process, profile, model cache, token, or cursor state.
- Bind the backend to loopback, use a random dashboard token, and keep `--isolated` enabled.
- Require Hermes desktop contract 2 or newer. Capability-probe responses and tolerate unknown future
  events instead of pinning one Hermes version.
- Preserve event order per session; JSON-RPC responses and terminal events may race.
- Hermes remains the transcript owner. Do not add another Hermes conversation database.
- Provider output must flow through canonical runtime events for persistence, reconnects, and push.
- Never turn a session approval into permanent approval.
- Do not include the dashboard token, raw stderr, secrets, or unredacted provider data in user-facing
  errors or native event logs.
- Setup remains terminal-owned. Report `hermes --profile <profile> model`; do not launch it from T3.

## Compatibility baseline

The gateway migration was reviewed on 2026-07-18 against Hermes main commit
`614dc194ea7d853d39f9e84582ec62156f41a475` (desktop contract 3) and the locally installed Hermes
Agent 0.18.2 (desktop contract 2). A real loopback probe verified authenticated `gateway.ready`,
`setup.status`, `model.options`, `session.create`, durable `stored_session_id`, and `session.close`.
Focused deterministic tests cover cursor rejection, model qualification, ordered message/reasoning/
tool mapping, approvals, clarification, full-access behavior, and legacy ACP-session loss.

## Automations

Automation management is deliberately unchanged. Availability and mutations still use
`hermes --profile <profile> cron ...`; listing still projects the profile's bounded
`cron/jobs.json`. The web and mobile clients do not write Hermes storage directly.

The chat gateway does not currently convert scheduled runs into T3 threads or deliver a post-run
reply into an existing thread. Do not enable Hermes's desktop cron ticker or add gateway polling as
part of chat maintenance. That feature needs a separate delivery design with explicit ownership,
deduplication, durable thread routing, and failure semantics.

## Revalidation procedure

1. Compare the official programmatic guide, gateway protocol types, WebSocket transport, and server
   handlers with the mappings above.
2. Run the focused Hermes tests and full repository checks.
3. With configured default and named profiles, verify model discovery, create/resume, streaming,
   reasoning, a tool call, approval decisions, clarification, steering, interrupt, rollback,
   attachment handling, model switching, and restart/resume.
4. Verify cron list/create/edit/pause/resume/run/remove separately; confirm chat startup does not run
   a cron ticker.
5. Record only checks that actually ran and distinguish source review, protocol smoke, and complete
   browser-verified chat coverage.
