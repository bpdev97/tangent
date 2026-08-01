import type { ProviderApprovalDecision } from "@t3tools/contracts";
import type * as EffectCodexSchema from "effect-codex-app-server/schema";
import * as Predicate from "effect/Predicate";

export interface CodexMcpToolApproval {
  readonly supportsSessionPersistence: boolean;
}

function supportsPersistMode(meta: Readonly<Record<PropertyKey, unknown>>, mode: string): boolean {
  const persist = meta.persist;
  return persist === mode || (Array.isArray(persist) && persist.some((value) => value === mode));
}

export function parseCodexMcpToolApproval(
  payload: EffectCodexSchema.McpServerElicitationRequestParams,
): CodexMcpToolApproval | null {
  const meta = payload._meta;
  if (
    payload.mode !== "form" ||
    Object.keys(payload.requestedSchema.properties).length !== 0 ||
    !Predicate.isObject(meta) ||
    meta.codex_approval_kind !== "mcp_tool_call"
  ) {
    return null;
  }

  return {
    supportsSessionPersistence: supportsPersistMode(meta, "session"),
  };
}

export function toCodexMcpToolApprovalResponse(
  decision: ProviderApprovalDecision,
  approval: CodexMcpToolApproval,
): EffectCodexSchema.McpServerElicitationRequestResponse {
  switch (decision) {
    case "accept":
      return { action: "accept" };
    case "acceptForSession":
      return approval.supportsSessionPersistence
        ? { action: "accept", _meta: { persist: "session" } }
        : { action: "accept" };
    case "decline":
      return { action: "decline" };
    case "cancel":
      return { action: "cancel" };
  }
}
