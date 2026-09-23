import type { ProviderInstanceId } from "@t3tools/contracts";
import {
  RESERVED_SHARED_MCP_SERVER_NAME,
  SHARED_MCP_SERVER_HEADER_REDACTED,
  SharedMcpServer,
  type SharedMcpServers,
} from "@t3tools/contracts/sharedMcpServers";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

// Tangent(FORK-MCP-001): draft handling for the MCP servers editor.

export interface SharedMcpHeaderDraft {
  /** Stable row key while headers are added, removed, and renamed. */
  readonly id: number;
  readonly name: string;
  /** Empty with `saved` means "keep the value the server already holds". */
  readonly value: string;
  readonly saved: boolean;
}

export interface SharedMcpServerDraft {
  readonly name: string;
  readonly url: string;
  readonly headers: ReadonlyArray<SharedMcpHeaderDraft>;
  readonly enabled: boolean;
  readonly disabledProviderInstances: ReadonlyArray<ProviderInstanceId>;
}

export const EMPTY_SHARED_MCP_SERVER_DRAFT: SharedMcpServerDraft = {
  name: "",
  url: "",
  headers: [],
  enabled: true,
  disabledProviderInstances: [],
};

let nextHeaderId = 0;

export function emptySharedMcpHeader(): SharedMcpHeaderDraft {
  return { id: nextHeaderId++, name: "", value: "", saved: false };
}

export function sharedMcpServerDraft(server: SharedMcpServer): SharedMcpServerDraft {
  return {
    ...server,
    headers: server.headers.map((header) => {
      const saved = header.value === SHARED_MCP_SERVER_HEADER_REDACTED;
      return { id: nextHeaderId++, name: header.name, value: saved ? "" : header.value, saved };
    }),
  };
}

/**
 * Saved values are stored under the header's name, so renaming a saved header
 * drops the saved value and asks for a new one instead of silently losing it.
 */
export function renameSharedMcpHeader(
  header: SharedMcpHeaderDraft,
  name: string,
): SharedMcpHeaderDraft {
  return header.saved ? { ...header, name, value: "", saved: false } : { ...header, name };
}

const decodeSharedMcpServer = Schema.decodeUnknownExit(SharedMcpServer);

/** The server to save, or why the draft cannot be saved. Blank header rows are ignored. */
export function sharedMcpServerFromDraft(
  draft: SharedMcpServerDraft,
  otherServers: SharedMcpServers,
): { readonly server: SharedMcpServer } | { readonly error: string } {
  const name = draft.name.trim();
  if (name === RESERVED_SHARED_MCP_SERVER_NAME) {
    return { error: `"${name}" is reserved for T3 Code's own server.` };
  }
  if (otherServers.some((server) => server.name.toLowerCase() === name.toLowerCase())) {
    return { error: `A server named "${name}" already exists.` };
  }
  const headers = draft.headers
    .filter((header) => header.name.trim() !== "" || header.value !== "")
    .map((header) => ({
      name: header.name.trim(),
      value: header.saved && header.value === "" ? SHARED_MCP_SERVER_HEADER_REDACTED : header.value,
    }));
  const exit = decodeSharedMcpServer({ ...draft, name, url: draft.url.trim(), headers });
  if (Exit.isSuccess(exit)) return { server: exit.value };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    return { error: "Use letters, numbers, dashes, and underscores for the name." };
  }
  if (!/^https?:\/\/\S+$/i.test(draft.url.trim())) {
    return { error: "Enter an http:// or https:// URL." };
  }
  return { error: "Check the name, URL, and header names." };
}
