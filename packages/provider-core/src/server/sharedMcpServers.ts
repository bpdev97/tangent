/**
 * Tangent(FORK-MCP-001): the user's shared MCP servers for each thread, in the
 * shapes each provider attaches. The server resolves them when a provider
 * session opens; adapters read them synchronously next to where they attach
 * t3-code. Hermes and Pi do not read them.
 *
 * @module provider-core/server/sharedMcpServers
 */
import type { ThreadId } from "@t3tools/contracts";
import {
  SHARED_MCP_BRIDGE_COMMAND,
  SHARED_MCP_BRIDGE_ENDPOINT_ENV,
  SHARED_MCP_BRIDGE_HEADERS_ENV,
} from "@t3tools/contracts/sharedMcpServers";
import { type SelfInvocation, selfInvocationArgs } from "@t3tools/shared/nodeRuntime";

export interface ResolvedSharedMcpServer {
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

const serversByThread = new Map<ThreadId, ReadonlyArray<ResolvedSharedMcpServer>>();

/** Replaces the servers a thread's next provider session attaches. */
export function setSharedMcpServers(
  threadId: ThreadId,
  servers: ReadonlyArray<ResolvedSharedMcpServer>,
): void {
  if (servers.length === 0) serversByThread.delete(threadId);
  else serversByThread.set(threadId, servers);
}

export function readSharedMcpServers(
  threadId: ThreadId | null | undefined,
): ReadonlyArray<ResolvedSharedMcpServer> {
  return threadId == null ? [] : (serversByThread.get(threadId) ?? []);
}

const hasHeaders = (server: ResolvedSharedMcpServer) => Object.keys(server.headers).length > 0;

/** Claude Agent SDK and Cursor SDK share the `{ type: "http", url, headers }` shape. */
export function sharedHttpMcpServers(threadId: ThreadId | null | undefined) {
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
export function codexSharedMcpServers(threadId: ThreadId | null | undefined) {
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
export function acpSharedMcpServers(threadId: ThreadId | null | undefined, self: SelfInvocation) {
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
