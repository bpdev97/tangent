// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as Effect from "effect/Effect";

import { runAcpMcpStdioBridge } from "../mcp/AcpMcpStdioBridge.ts";

// Tangent(FORK-MCP-001): `t3 shared-mcp-bridge` is the stdio server ACP
// agents spawn for each shared MCP server. It reuses upstream's stdio-to-HTTP
// bridge and swaps T3's bearer credential for the server's own headers.
// bin.ts dispatches it before the full CLI graph loads; keep imports lean.

export const SHARED_MCP_BRIDGE_COMMAND = "shared-mcp-bridge";
export const SHARED_MCP_BRIDGE_ENDPOINT_ENV = "T3_SHARED_MCP_ENDPOINT";
export const SHARED_MCP_BRIDGE_HEADERS_ENV = "T3_SHARED_MCP_HEADERS";

type FetchImplementation = (url: string, init?: RequestInit) => Promise<Response>;

/** Drops the bridge's own Authorization header and applies the configured ones. */
export function withSharedMcpHeaders(
  headers: Readonly<Record<string, string>>,
  fetchImplementation: FetchImplementation = fetch,
): FetchImplementation {
  return (url, init) => {
    const merged = new Headers(init?.headers);
    merged.delete("authorization");
    for (const [name, value] of Object.entries(headers)) merged.set(name, value);
    return fetchImplementation(url, { ...init, headers: merged });
  };
}

function parseHeaders(raw: string | undefined): Record<string, string> | null {
  if (raw === undefined || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    return entries.every(([, value]) => typeof value === "string")
      ? (Object.fromEntries(entries) as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

export async function runSharedMcpBridgeFastPath(): Promise<void> {
  const endpoint = process.env[SHARED_MCP_BRIDGE_ENDPOINT_ENV];
  const headers = parseHeaders(process.env[SHARED_MCP_BRIDGE_HEADERS_ENV]);
  if (endpoint === undefined || headers === null) {
    process.stderr.write(
      `${SHARED_MCP_BRIDGE_COMMAND} requires ${SHARED_MCP_BRIDGE_ENDPOINT_ENV} and a JSON object in ${SHARED_MCP_BRIDGE_HEADERS_ENV}.\n`,
    );
    process.exitCode = 2;
    return;
  }
  await Effect.runPromise(
    runAcpMcpStdioBridge({
      endpoint,
      authorization: "",
      input: process.stdin,
      output: process.stdout,
      fetchImplementation: withSharedMcpHeaders(headers),
    }),
  );
}
