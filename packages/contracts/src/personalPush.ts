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
  /** Updates the Live Activity without alerting; the server sets it while the user is at the desktop. */
  silent: Schema.optionalKey(Schema.Boolean),
});
export type PersonalPushActivityPublishRequest = typeof PersonalPushActivityPublishRequest.Type;

/**
 * Shown in place of a saved relay password. The real password lives in the
 * server secret store; settings files and clients only ever see this marker.
 */
export const PERSONAL_PUSH_RELAY_PASSWORD_REDACTED = "••••••";

/** Choices offered for the quiet window; 0 turns it off. */
export const PERSONAL_PUSH_QUIET_MINUTES_OPTIONS = [0, 1, 2, 5, 15] as const;
const DEFAULT_PERSONAL_PUSH_QUIET_MINUTES = 2;

/**
 * Minutes after the last desktop or web interaction during which finished and
 * failed threads do not alert the phone. Whole minutes: the server only learns
 * of an interaction to within about a minute.
 */
const PersonalPushQuietMinutes = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60 }));

export const PersonalPushRelaySettings = Schema.Struct({
  url: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  password: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  quietAfterDesktopActivityMinutes: PersonalPushQuietMinutes.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PERSONAL_PUSH_QUIET_MINUTES)),
  ),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type PersonalPushRelaySettings = typeof PersonalPushRelaySettings.Type;

export const PersonalPushRelaySettingsPatch = Schema.Struct({
  url: Schema.optionalKey(TrimmedString),
  password: Schema.optionalKey(TrimmedString),
  quietAfterDesktopActivityMinutes: Schema.optionalKey(PersonalPushQuietMinutes),
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
