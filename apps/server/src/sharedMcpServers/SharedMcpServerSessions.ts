import type { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import {
  SHARED_MCP_SERVER_HEADER_REDACTED,
  type SharedMcpServers,
} from "@t3tools/contracts/sharedMcpServers";
import {
  type ResolvedSharedMcpServer,
  setSharedMcpServers,
} from "@t3tools/provider-core/server/sharedMcpServers";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { ServerSettingsService } from "../serverSettings.ts";

// Tangent(FORK-MCP-001): resolves the user's shared MCP servers per thread
// when its provider session opens. Adapters read them from
// `@t3tools/provider-core/server/sharedMcpServers`.

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
    onNone: () => Effect.sync(() => setSharedMcpServers(threadId, [])),
    onSome: (service) =>
      service.getSettings.pipe(
        Effect.map((settings) => resolveSharedMcpServers(settings.mcpServers, providerInstanceId)),
        Effect.catchCause((cause) =>
          Effect.logWarning("failed to resolve shared MCP servers", { threadId, cause }).pipe(
            Effect.as([]),
          ),
        ),
        Effect.map((servers) => setSharedMcpServers(threadId, servers)),
      ),
  });
