/**
 * Small, pure helpers shared by the Hermes gateway runtime, adapter, snapshot,
 * and updater. Everything here maps between T3 values and the Hermes TUI
 * gateway wire format; nothing here touches a process or socket.
 *
 * @module provider/hermes/HermesGatewaySupport
 */
import {
  type ProviderApprovalDecision,
  ProviderDriverKind,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const HERMES_DRIVER_KIND = ProviderDriverKind.make("hermes");

/**
 * `DESKTOP_BACKEND_CONTRACT` of the baseline release (Hermes Agent 0.21.4,
 * `v2026.9.21`). Contract 7 delivers approvals and questions as server→client
 * JSON-RPC requests; older gateways emit notifications this adapter ignores,
 * so they are reported as incompatible instead of failing mid-turn.
 */
export const HERMES_MIN_GATEWAY_CONTRACT = 7;

/** Model slug meaning "keep the profile's configured model"; never sent to Hermes. */
export const HERMES_DEFAULT_MODEL_SLUG = "default";

export class HermesGatewayError extends Schema.TaggedError<HermesGatewayError>()(
  "HermesGatewayError",
  {
    detail: Schema.String,
    method: Schema.optional(Schema.String),
    code: Schema.optional(Schema.Finite),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export function buildHermesGatewayArgs(profile: string): ReadonlyArray<string> {
  return ["--profile", profile, "serve", "--isolated", "--host", "127.0.0.1", "--port", "0"];
}

export interface HermesModelSelection {
  /** `<provider>:<model>` when the provider is known, else the bare model. */
  readonly id: string;
  readonly model: string;
  readonly provider?: string;
}

/** `undefined` means "keep the profile default". */
export function parseHermesModelSelection(
  model: string | null | undefined,
): HermesModelSelection | undefined {
  const id = model?.trim();
  if (!id || id === HERMES_DEFAULT_MODEL_SLUG) return undefined;
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) return { id, model: id };
  return { id, provider: id.slice(0, separator), model: id.slice(separator + 1) };
}

/** `config.set model` value; an explicit provider keeps Hermes from guessing. */
export function hermesModelSwitchValue(selection: HermesModelSelection): string {
  return selection.provider
    ? `${selection.model} --provider ${selection.provider}`
    : selection.model;
}

export function hermesQualifiedModel(
  model: string | null | undefined,
  provider: string | null | undefined,
): string | undefined {
  const cleanModel = model?.trim();
  if (!cleanModel) return undefined;
  const cleanProvider = provider?.trim();
  return cleanProvider ? `${cleanProvider}:${cleanModel}` : cleanModel;
}

/** Session approvals stay session-scoped; T3 never grants Hermes's permanent `always`. */
export function hermesApprovalChoice(
  decision: ProviderApprovalDecision,
): "once" | "session" | "deny" {
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

/**
 * Only full access answers approvals automatically. The gateway has no
 * session-local "accept edits" scope, so auto-accept-edits surfaces approvals
 * rather than widening authority.
 */
export function shouldAutoApproveHermes(runtimeMode: RuntimeMode): boolean {
  return runtimeMode === "full-access";
}

const SHELL_METACHARACTERS = /[;&|<>()$`'"\\,*?[\]{}~!#\n\r]/u;

/**
 * Turn the gateway-reported `update_command` into an argv, or `null` when it
 * is guidance rather than a plain command (Nix prints a sentence). A leading
 * `hermes` runs through the instance's configured binary.
 */
export function parseHermesUpdateCommand(
  command: string | null | undefined,
  binaryPath: string,
): { readonly executable: string; readonly args: ReadonlyArray<string> } | null {
  const trimmed = command?.trim();
  if (!trimmed || SHELL_METACHARACTERS.test(trimmed)) return null;
  const [executable, ...args] = trimmed.split(/\s+/u);
  if (!executable) return null;
  return { executable: executable === "hermes" ? binaryPath || "hermes" : executable, args };
}

/** GitHub release names read `Hermes Agent v0.21.4 (v2026.9.21)`. */
export function parseHermesReleaseVersion(name: string | null | undefined): string | null {
  return /\bv?(\d+\.\d+\.\d+)\b/u.exec(name ?? "")?.[1] ?? null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function nonNegativeInteger(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : Math.max(0, Math.trunc(parsed));
}
