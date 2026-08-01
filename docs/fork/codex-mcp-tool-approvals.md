# Codex MCP tool approval prompts

## Why this exists

Codex MCP tool-call approvals, including computer-use tools, arrive through
`mcpServer/elicitation/request`, not the command and file-change approval methods T3 already
handled. Because the method is part of the generated Codex protocol but had no registered handler,
the app-server client returned `method not found`, which Codex surfaced as a rejected MCP tool call
without showing a prompt.

## Behavior

The server recognizes form elicitations when all of these conditions hold:

- `_meta.codex_approval_kind` is `mcp_tool_call`.
- `requestedSchema` is an empty object schema.
- The request uses form mode.

Those requests use the existing pending-approval lifecycle with the `mcp-tool-call` kind. Accept,
decline, and cancel map to the matching Codex elicitation actions. Session acceptance adds
`_meta.persist: "session"` only when the request advertises session persistence. Unsupported MCP
forms and URL elicitations receive an immediate cancel response. UI labels deliberately say “MCP
tool call” rather than assuming every request is computer use.

## Upstream sync checks

1. Search upstream for a handler for `mcpServer/elicitation/request` before resolving conflicts.
2. Compare the Codex app-server metadata keys and elicitation response schema.
3. Keep session persistence conditional on the request metadata.
4. Run the focused tests listed in `FORK.md`, then `vp check` and `vp run typecheck`.

Delete this patch when upstream provides the same end-to-end server, projection, web, and mobile
behavior.
