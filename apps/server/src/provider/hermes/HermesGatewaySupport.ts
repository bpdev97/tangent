import {
  type ProviderApprovalDecision,
  ProviderDriverKind,
  type RuntimeMode,
} from "@t3tools/contracts";

export const HERMES_DRIVER_KIND = ProviderDriverKind.make("hermes");
export const HERMES_GATEWAY_RESUME_SCHEMA_VERSION = 2;
export const HERMES_GATEWAY_MIN_DESKTOP_CONTRACT = 2;

export interface HermesGatewayConversationCursor {
  readonly schemaVersion: typeof HERMES_GATEWAY_RESUME_SCHEMA_VERSION;
  readonly transport: "tui-gateway";
  readonly sessionId: string;
}

export interface HermesGatewaySettings {
  readonly binaryPath?: string;
  readonly profile: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseHermesGatewayConversationCursor(
  raw: unknown,
): HermesGatewayConversationCursor | undefined {
  if (!isRecord(raw)) return undefined;
  if (
    raw.schemaVersion !== HERMES_GATEWAY_RESUME_SCHEMA_VERSION ||
    raw.transport !== "tui-gateway" ||
    typeof raw.sessionId !== "string" ||
    raw.sessionId.trim().length === 0
  ) {
    return undefined;
  }
  return {
    schemaVersion: HERMES_GATEWAY_RESUME_SCHEMA_VERSION,
    transport: "tui-gateway",
    sessionId: raw.sessionId.trim(),
  };
}

export function buildHermesGatewayArgs(settings: HermesGatewaySettings): ReadonlyArray<string> {
  return [
    "--profile",
    settings.profile,
    "serve",
    "--isolated",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ];
}

export function resolveHermesModelId(model: string | null | undefined): string | undefined {
  return model?.trim() || undefined;
}

export function parseHermesModelSelection(model: string | null | undefined):
  | {
      readonly id: string;
      readonly model: string;
      readonly provider?: string;
    }
  | undefined {
  const id = resolveHermesModelId(model);
  if (!id) return undefined;
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) return { id, model: id };
  return {
    id,
    provider: id.slice(0, separator),
    model: id.slice(separator + 1),
  };
}

export function hermesApprovalChoice(decision: ProviderApprovalDecision): string {
  switch (decision) {
    case "accept":
      return "once";
    case "acceptForSession":
    case "acceptAlways":
      return "session";
    case "decline":
    case "cancel":
      return "deny";
  }
}

export function shouldAutoApproveHermes(runtimeMode: RuntimeMode): boolean {
  return runtimeMode === "full-access";
}
