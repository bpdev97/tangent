import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, ThreadId, TrimmedString } from "./baseSchemas.ts";
import { RelayAgentActivityState } from "./relay.ts";

// Tangent(FORK-PUSH-001): contracts for the self-hosted personal push relay.

/**
 * Stable `/v1` publication shared by the Tangent server and `apps/push-relay`.
 * It carries only agent-awareness state; the relay is not an APNs forwarder.
 */
export const PersonalPushActivityPublishRequest = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  state: Schema.NullOr(RelayAgentActivityState),
});
export type PersonalPushActivityPublishRequest = typeof PersonalPushActivityPublishRequest.Type;

/**
 * Shown in place of a saved relay password. The real password lives in the
 * server secret store; settings files and clients only ever see this marker.
 */
export const PERSONAL_PUSH_RELAY_PASSWORD_REDACTED = "••••••";

export const PersonalPushRelaySettings = Schema.Struct({
  url: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  password: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type PersonalPushRelaySettings = typeof PersonalPushRelaySettings.Type;

export const PersonalPushRelaySettingsPatch = Schema.Struct({
  url: Schema.optionalKey(TrimmedString),
  password: Schema.optionalKey(TrimmedString),
});
export type PersonalPushRelaySettingsPatch = typeof PersonalPushRelaySettingsPatch.Type;

export const PersonalPushRelayTestResult = Schema.Struct({
  ok: Schema.Boolean,
  relayUrl: Schema.NullOr(Schema.String),
  failure: Schema.optional(
    Schema.Literals(["not_configured", "unauthorized", "unreachable", "invalid_response"]),
  ),
  status: Schema.optional(Schema.Number),
});
export type PersonalPushRelayTestResult = typeof PersonalPushRelayTestResult.Type;
