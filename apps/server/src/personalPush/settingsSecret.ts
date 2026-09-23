import {
  PERSONAL_PUSH_RELAY_PASSWORD_REDACTED,
  type PersonalPushRelaySettings,
} from "@t3tools/contracts/personalPush";
import type { ServerSettings } from "@t3tools/contracts/settings";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ServerSecretStore from "../auth/ServerSecretStore.ts";

// Tangent(FORK-PUSH-001): the relay password lives in ServerSecretStore. The
// settings file and every client snapshot carry only the redaction marker.

const PERSONAL_PUSH_RELAY_PASSWORD_SECRET = "personal-push-relay-password";
const ENVIRONMENT_VARIABLE = "personalPushRelay.password";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type PasswordSecretChange =
  | {
      readonly kind: "write";
      readonly secretName: string;
      readonly value: Uint8Array;
      readonly environmentVariable: string;
    }
  | {
      readonly kind: "remove";
      readonly secretName: string;
      readonly operation: "remove-secret";
      readonly environmentVariable: string;
    };

/** Replaces a saved password with the marker so clients only learn that one exists. */
export function redactPersonalPushRelayForClient(settings: ServerSettings): ServerSettings {
  const relay = settings.personalPushRelay;
  return {
    ...settings,
    personalPushRelay: {
      ...relay,
      password: relay.password.length > 0 ? PERSONAL_PUSH_RELAY_PASSWORD_REDACTED : "",
    },
  };
}

/**
 * Plans the secret-store change for settings about to be persisted. A new
 * password is written and replaced by the marker; an empty one is removed.
 */
export function persistPersonalPushRelayPassword(relay: PersonalPushRelaySettings): {
  readonly relay: PersonalPushRelaySettings;
  readonly changes: ReadonlyArray<PasswordSecretChange>;
} {
  if (relay.password === PERSONAL_PUSH_RELAY_PASSWORD_REDACTED) {
    return { relay, changes: [] };
  }
  if (relay.password.length === 0) {
    return {
      relay,
      changes: [
        {
          kind: "remove",
          secretName: PERSONAL_PUSH_RELAY_PASSWORD_SECRET,
          operation: "remove-secret",
          environmentVariable: ENVIRONMENT_VARIABLE,
        },
      ],
    };
  }
  return {
    relay: { ...relay, password: PERSONAL_PUSH_RELAY_PASSWORD_REDACTED },
    changes: [
      {
        kind: "write",
        secretName: PERSONAL_PUSH_RELAY_PASSWORD_SECRET,
        value: textEncoder.encode(relay.password),
        environmentVariable: ENVIRONMENT_VARIABLE,
      },
    ],
  };
}

/** Reads the real password back for server-side use. */
export const materializePersonalPushRelayPassword = (
  relay: PersonalPushRelaySettings,
  secretStore: ServerSecretStore.ServerSecretStore["Service"],
): Effect.Effect<PersonalPushRelaySettings, ServerSecretStore.SecretStoreError> =>
  relay.password !== PERSONAL_PUSH_RELAY_PASSWORD_REDACTED
    ? Effect.succeed(relay)
    : secretStore.get(PERSONAL_PUSH_RELAY_PASSWORD_SECRET).pipe(
        Effect.map((secret) => ({
          ...relay,
          password: Option.isSome(secret) ? textDecoder.decode(secret.value).trim() : "",
        })),
      );
