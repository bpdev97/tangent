import type { ServerSettings } from "@t3tools/contracts/settings";
import {
  SHARED_MCP_SERVER_HEADER_REDACTED,
  type SharedMcpServer,
  type SharedMcpServers,
} from "@t3tools/contracts/sharedMcpServers";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ServerSecretStore from "../auth/ServerSecretStore.ts";

// Tangent(FORK-MCP-001): MCP server header values live in ServerSecretStore.
// The settings file and every client snapshot carry only the redaction marker.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Header names are case-insensitive, so `Authorization` and `authorization` share one secret. */
function headerSecretName(serverName: string, headerName: string): string {
  const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
  return `shared-mcp-header-${encode(serverName.toLowerCase())}-${encode(headerName.toLowerCase())}`;
}

type HeaderSecretChange =
  | {
      readonly kind: "write";
      readonly secretName: string;
      readonly value: Uint8Array;
      readonly environmentVariable: string;
    }
  | {
      readonly kind: "remove";
      readonly secretName: string;
      readonly operation: "remove-secret" | "remove-stale-secret";
      readonly environmentVariable: string;
    };

const changeLabel = (serverName: string, headerName: string) =>
  `mcpServers.${serverName}.headers.${headerName}`;

/** Replaces saved header values with the marker so clients only learn that one exists. */
export function redactSharedMcpServersForClient(settings: ServerSettings): ServerSettings {
  return {
    ...settings,
    mcpServers: settings.mcpServers.map((server) => ({
      ...server,
      headers: server.headers.map((header) => ({
        ...header,
        value: header.value.length > 0 ? SHARED_MCP_SERVER_HEADER_REDACTED : "",
      })),
    })),
  };
}

/**
 * Plans the secret-store changes for servers about to be persisted. New values
 * are written and replaced by the marker, emptied values and headers or
 * servers that disappeared are removed, and the marker keeps what is saved.
 */
export function persistSharedMcpServerHeaders(
  current: SharedMcpServers,
  next: SharedMcpServers,
): {
  readonly servers: SharedMcpServers;
  readonly changes: ReadonlyArray<HeaderSecretChange>;
} {
  const changes: HeaderSecretChange[] = [];
  const plannedSecrets = new Set<string>();
  const currentHeaderValue = (serverName: string, headerName: string) =>
    current
      .find((server) => server.name.toLowerCase() === serverName.toLowerCase())
      ?.headers.find((header) => header.name.toLowerCase() === headerName.toLowerCase())?.value;

  const servers = next.map((server): SharedMcpServer => ({
    ...server,
    headers: server.headers.map((header) => {
      const secretName = headerSecretName(server.name, header.name);
      const environmentVariable = changeLabel(server.name, header.name);
      plannedSecrets.add(secretName);
      if (header.value.length === 0) {
        changes.push({
          kind: "remove",
          secretName,
          operation: "remove-secret",
          environmentVariable,
        });
        return header;
      }
      // A value typed straight into settings.json is still inline in the
      // cache; the marker a client echoes back must not discard it.
      const inline =
        header.value === SHARED_MCP_SERVER_HEADER_REDACTED
          ? currentHeaderValue(server.name, header.name)
          : header.value;
      if (inline !== undefined && inline !== SHARED_MCP_SERVER_HEADER_REDACTED && inline !== "") {
        changes.push({
          kind: "write",
          secretName,
          value: textEncoder.encode(inline),
          environmentVariable,
        });
      }
      return { ...header, value: SHARED_MCP_SERVER_HEADER_REDACTED };
    }),
  }));

  for (const server of current) {
    for (const header of server.headers) {
      const secretName = headerSecretName(server.name, header.name);
      if (header.value.length === 0 || plannedSecrets.has(secretName)) continue;
      changes.push({
        kind: "remove",
        secretName,
        operation: "remove-stale-secret",
        environmentVariable: changeLabel(server.name, header.name),
      });
    }
  }
  return { servers, changes };
}

/** Reads saved header values back for server-side use. A missing secret reads as empty. */
export const materializeSharedMcpServerHeaders = (
  servers: SharedMcpServers,
  secretStore: ServerSecretStore.ServerSecretStore["Service"],
): Effect.Effect<SharedMcpServers, ServerSecretStore.SecretStoreError> =>
  Effect.forEach(servers, (server) =>
    Effect.map(
      Effect.forEach(server.headers, (header) =>
        header.value !== SHARED_MCP_SERVER_HEADER_REDACTED
          ? Effect.succeed(header)
          : secretStore.get(headerSecretName(server.name, header.name)).pipe(
              Effect.map((secret) => ({
                ...header,
                value: Option.isSome(secret) ? textDecoder.decode(secret.value) : "",
              })),
            ),
      ),
      (headers): SharedMcpServer => ({ ...server, headers }),
    ),
  );
