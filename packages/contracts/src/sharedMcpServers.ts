import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

// Tangent(FORK-MCP-001): user-configured HTTP MCP servers that every provider
// session on an environment gets alongside the built-in t3-code server.

/**
 * Shown in place of a saved header value. The real value lives in the server
 * secret store; settings files and clients only ever see this marker, and a
 * client sending it back means "keep the saved value".
 */
export const SHARED_MCP_SERVER_HEADER_REDACTED = "••••••";

/** The name T3's own MCP server already uses in every session. */
export const RESERVED_SHARED_MCP_SERVER_NAME = "t3-code";

/** Drivers whose sessions cannot attach extra MCP servers yet. */
export const SHARED_MCP_SERVERS_UNSUPPORTED_DRIVERS: ReadonlySet<ProviderDriverKind> = new Set([
  ProviderDriverKind.make("hermes"),
  ProviderDriverKind.make("pi"),
]);

/** Becomes the server name the agent sees, so tools read as `mcp__<name>__<tool>`. */
export const SharedMcpServerName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  Schema.makeFilter(
    (name) =>
      name !== RESERVED_SHARED_MCP_SERVER_NAME ||
      `"${RESERVED_SHARED_MCP_SERVER_NAME}" is reserved for T3 Code's own server.`,
  ),
);
export type SharedMcpServerName = typeof SharedMcpServerName.Type;

export const SharedMcpServerHeader = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isPattern(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)),
  value: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type SharedMcpServerHeader = typeof SharedMcpServerHeader.Type;

export const SharedMcpServer = Schema.Struct({
  name: SharedMcpServerName,
  /** Streamable HTTP endpoint, resolved on the environment's machine. */
  url: TrimmedNonEmptyString.check(Schema.isPattern(/^https?:\/\/\S+$/i)),
  headers: Schema.Array(SharedMcpServerHeader).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Opt-out list, so provider instances added later get the server by default. */
  disabledProviderInstances: Schema.Array(ProviderInstanceId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
}).check(
  Schema.makeFilter(
    (server) =>
      new Set(server.headers.map((header) => header.name.toLowerCase())).size ===
        server.headers.length || "Header names must be unique.",
  ),
);
export type SharedMcpServer = typeof SharedMcpServer.Type;

export const SharedMcpServers = Schema.Array(SharedMcpServer).check(
  Schema.makeFilter(
    (servers) =>
      new Set(servers.map((server) => server.name.toLowerCase())).size === servers.length ||
      "MCP server names must be unique.",
  ),
);
export type SharedMcpServers = typeof SharedMcpServers.Type;
