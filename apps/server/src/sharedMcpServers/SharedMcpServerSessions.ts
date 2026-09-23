import type { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  SHARED_MCP_SERVER_HEADER_REDACTED,
  type SharedMcpServers,
} from "@t3tools/contracts/sharedMcpServers";
import { type SelfInvocation, selfInvocationArgs } from "@t3tools/shared/nodeRuntime";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as Option from "effect/Option";

import type { ServerSettingsService } from "../serverSettings.ts";
import {
  SHARED_MCP_BRIDGE_COMMAND,
  SHARED_MCP_BRIDGE_ENDPOINT_ENV,
  SHARED_MCP_BRIDGE_HEADERS_ENV,
} from "./sharedMcpBridge.ts";

// Tangent(FORK-MCP-001): the user's shared MCP servers, resolved per thread
// when its provider session opens. Adapters read them synchronously next to
// where they attach t3-code; Hermes and Pi do not read them.

export interface ResolvedSharedMcpServer {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const serversByThread = new Map<ThreadId, ReadonlyArray<ResolvedSharedMcpServer>>();

/** The servers one provider instance should attach, with headers ready to send. */
export function resolveSharedMcpServers(
  servers: SharedMcpServers,
  providerInstanceId: ProviderInstanceId,
): ReadonlyArray<ResolvedSharedMcpServer> {
  return servers
    .filter(
      (server) => server.enabled && !server.disabledProviderInstances.includes(providerInstanceId),
    )
    .map((server) => ({
      name: server.name,
      url: server.url,
      headers: Object.fromEntries(
        server.headers
          // An empty or still-redacted value means the secret is missing;
          // sending the marker would only fail authentication confusingly.
          .filter(
            (header) =>
              header.value.length > 0 && header.value !== SHARED_MCP_SERVER_HEADER_REDACTED,
          )
          .map((header) => [header.name, header.value]),
      ),
    }));
}

/**
 * Snapshots the servers for a session about to open. Settings are read on
 * every open, so edits apply to new sessions; a live session keeps its set.
 */
export const prepareSharedMcpServers = (
  settingsService: Option.Option<Pick<ServerSettingsService["Service"], "getSettings">>,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
): Effect.Effect<void> =>
  Option.match(settingsService, {
    onNone: () => Effect.sync(() => serversByThread.delete(threadId)),
    onSome: (service) =>
      service.getSettings.pipe(
        Effect.map((settings) => resolveSharedMcpServers(settings.mcpServers, providerInstanceId)),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to resolve shared MCP servers", { threadId, cause }).pipe(
            Effect.as([]),
          ),
        ),
        Effect.map((servers) => {
          if (servers.length === 0) serversByThread.delete(threadId);
          else serversByThread.set(threadId, servers);
        }),
      ),
  });

export function readSharedMcpServers(
  threadId: ThreadId | null,
): ReadonlyArray<ResolvedSharedMcpServer> {
  return threadId === null ? [] : (serversByThread.get(threadId) ?? []);
}

const hasHeaders = (server: ResolvedSharedMcpServer) => Object.keys(server.headers).length > 0;

/** Claude Agent SDK and Cursor SDK share the `{ type: "http", url, headers }` shape. */
export function sharedHttpMcpServers(threadId: ThreadId | null) {
  return Object.fromEntries(
    readSharedMcpServers(threadId).map((server) => [
      server.name,
      {
        type: "http" as const,
        url: server.url,
        ...(hasHeaders(server) ? { headers: { ...server.headers } } : {}),
      },
    ]),
  );
}

/** Codex `mcp_servers` config entries. */
export function codexSharedMcpServers(threadId: ThreadId | null) {
  return Object.fromEntries(
    readSharedMcpServers(threadId).map((server) => [
      server.name,
      {
        url: server.url,
        ...(hasHeaders(server) ? { http_headers: { ...server.headers } } : {}),
      },
    ]),
  );
}

/**
 * ACP stdio entries. Stdio is the only MCP transport every ACP agent must
 * support, so each server runs through `t3 shared-mcp-bridge`, the same way
 * t3-code reaches ACP agents. Headers travel in the environment, never argv.
 */
export function acpSharedMcpServers(
  threadId: ThreadId | null,
  self: SelfInvocation,
): ReadonlyArray<EffectAcpSchema.McpServer> {
  return readSharedMcpServers(threadId).map((server) => ({
    name: server.name,
    command: self.command,
    args: [...selfInvocationArgs(self, [SHARED_MCP_BRIDGE_COMMAND])],
    env: [
      { name: "ELECTRON_RUN_AS_NODE", value: "1" },
      { name: SHARED_MCP_BRIDGE_ENDPOINT_ENV, value: server.url },
      { name: SHARED_MCP_BRIDGE_HEADERS_ENV, value: JSON.stringify(server.headers) },
    ],
  }));
}
