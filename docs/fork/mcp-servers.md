# FORK-MCP-001: Shared MCP servers

## Why

Tangent's owner runs tool servers, such as executor, that every agent should reach no matter which
provider a thread uses. Configuring each CLI separately drifts, and doesn't follow a thread onto a
remote environment. Tangent keeps one list of HTTP MCP servers per environment and attaches it
next to the built-in `t3-code` server wherever an adapter already attaches that server.

## Behavior

- `ServerSettings.mcpServers` is a list of streamable HTTP servers: name, URL, headers, an
  on/off switch, and an opt-out list of provider instances. It belongs to one environment, so each
  host has its own list, and the URL resolves on that host. It is not a shared settings key.
- Header values live in `ServerSecretStore`. The settings file and every client snapshot show only
  the redaction marker, and a client echoing the marker keeps the saved value. Secrets are keyed by
  server and header name, so the settings UI locks the server name after creation and clears a
  saved value when its header is renamed.
- The list is resolved once per session open, keyed by thread, in `SharedMcpServerSessions`.
  Changes apply to sessions that start afterwards; a live session keeps its set.
- Claude and Cursor get `{ type: "http" }` entries, Codex gets `mcp_servers` config, and OpenCode
  gets `mcp.add` calls (skipped for external OpenCode servers, as `t3-code` is; a server that fails
  to attach is logged and skipped). ACP agents get a stdio entry running
  `t3 shared-mcp-bridge`, which wraps upstream's stdio-to-HTTP bridge and swaps in the server's
  headers. Entries go in both ACP lists because MCP-over-ACP agents receive only `acpServers`.
- Hermes and Pi do not attach shared servers. The settings UI shows them as not supported.
- Shared servers never count as `t3-code`: orchestration instructions stay gated on `t3-code`
  itself. Tools from shared servers are not pre-approved, so approval prompts follow each
  provider's normal rules.

## Upstream hooks

Each hook is marked `Tangent(FORK-MCP-001)`.

- `packages/contracts/src/settings.ts`: the `mcpServers` field and patch key.
- `packages/contracts/package.json`: the `./sharedMcpServers` subpath export.
- `apps/server/src/serverSettings.ts`: redact, materialize, and persist calls beside the push
  relay's.
- `apps/server/src/orchestration-v2/ProviderSessionManager.ts`: `prepareSharedMcpServers` before
  each of the two `prepareMcpSession` calls.
- `apps/server/src/bin.ts`: the `shared-mcp-bridge` fast path.
- Adapters, beside each `t3-code` attachment: `ClaudeAdapterV2.ts` (`claudeMcpQueryOverrides` and
  the orchestration-prompt gate), `CodexAdapterV2.ts` (`codexThreadRuntimeParams`),
  `CursorAdapterV2.ts` (`cursorMcpServers` and `hasT3Mcp`), `AcpAdapterV2.ts` (`acpMcpContext`
  and `hasT3Mcp`), `OpenCodeAdapterV2.ts` (after the `t3-code` `mcp.add`).
- `apps/web/src/components/settings/ProviderSettingsPanel.tsx`: mounts the section after usage
  providers. `settingsSearch.ts`: the `mcp-servers` entry.
- `docs/README.md`: the link to the user guide.

Fork-owned: `packages/contracts/src/sharedMcpServers.ts`, `apps/server/src/sharedMcpServers/`,
`apps/web/src/components/settings/SharedMcpServersSettings.tsx`, `sharedMcpServers.logic.ts`, their
tests, and `docs/user/mcp-servers.md`.

## Resolving conflicts

- Adapters: take upstream's version, find where it now attaches `t3-code`, and re-add the shared
  servers beside it. If upstream derives "has t3-code" from a non-empty server list, gate it on
  `t3-code` specifically again.
- `ProviderSessionManager.ts`: re-add the call before every `prepareMcpSession` call, including new
  ones.
- `AcpMcpStdioBridge.ts`: the fork wraps `runAcpMcpStdioBridge` through its `fetchImplementation`
  option. If upstream removes that option or the function, port the wrapper rather than editing
  upstream's bridge.
- `serverSettings.ts`: keep upstream's secret flow and re-add the three calls beside the push relay's.

## Never

- Never put header values in the settings file, logs, client snapshots, or a spawned process's argv.
- Never add `mcpServers` to the shared settings keys; the list belongs to one host.
- Never pre-approve shared server tools or let them satisfy a `t3-code` check.
- Never add stdio or command-based servers; this feature is HTTP-only by design.

## Remove when

Upstream ships user-configured MCP servers that attach to every provider, with per-provider
opt-out and secret-backed headers. Migrate the list into upstream's setting and delete this one.

## Verify

```sh
vp test run apps/server/src/sharedMcpServers apps/web/src/components/settings/sharedMcpServers.logic.test.ts
```

Plus one pass with a real server: add it in Settings → Providers → MCP servers, start a thread on
Claude, Codex, and one ACP provider, and confirm each lists the server's tools; turn a provider off
and confirm its next session does not.
