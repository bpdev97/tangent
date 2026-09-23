import type { EnvironmentId } from "@t3tools/contracts";
import {
  RelayAgentActivitySnapshotResponse,
  type RelayDeviceRegistrationRequest,
  type RelayLiveActivityRegistrationRequest,
} from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { SavedRemoteConnection } from "../../lib/connection";

// Tangent(FORK-PUSH-001): the personal build has no managed relay. Each
// directly paired Tangent server forwards typed registrations to its
// self-hosted push relay, so the phone never holds the relay password.

const DEVICES_PATH = "/api/personal-push/v1/devices";
const LIVE_ACTIVITIES_PATH = "/api/personal-push/v1/live-activities";
const SNAPSHOT_PATH = "/api/personal-push/v1/agent-activity";
const decodeSnapshot = Schema.decodeUnknownEffect(RelayAgentActivitySnapshotResponse);

/** A direct bearer connection to a Tangent server that can reach its personal relay. */
export function isPersonalPushConnection(connection: SavedRemoteConnection): boolean {
  return (
    connection.relayManaged !== true &&
    connection.authenticationMethod !== "dpop" &&
    typeof connection.bearerToken === "string" &&
    connection.bearerToken.length > 0
  );
}

/**
 * Reconciles the saved environment catalog with the registered push
 * endpoints. A prepared connection briefly loses its bearer token while its
 * socket is replaced, so the last usable endpoint is kept until the
 * environment is removed or its credentials or authentication mode change.
 */
export function reconcilePersonalPushConnections(
  current: ReadonlyMap<EnvironmentId, SavedRemoteConnection>,
  connections: ReadonlyArray<SavedRemoteConnection>,
): {
  readonly next: Map<EnvironmentId, SavedRemoteConnection>;
  readonly addedOrChanged: boolean;
  readonly removed: boolean;
} {
  const next = new Map<EnvironmentId, SavedRemoteConnection>();
  let addedOrChanged = false;
  for (const connection of connections) {
    const previous = current.get(connection.environmentId);
    if (isPersonalPushConnection(connection)) {
      next.set(connection.environmentId, connection);
      addedOrChanged ||=
        previous === undefined ||
        previous.httpBaseUrl !== connection.httpBaseUrl ||
        previous.bearerToken !== connection.bearerToken;
      continue;
    }
    const transientlyUnprepared =
      previous !== undefined &&
      isPersonalPushConnection(previous) &&
      connection.relayManaged !== true &&
      connection.authenticationMethod !== "dpop" &&
      connection.bearerToken === null;
    if (transientlyUnprepared) next.set(connection.environmentId, previous);
  }
  const removed = [...current.keys()].some((environmentId) => !next.has(environmentId));
  return { next, addedOrChanged, removed };
}

function request(
  connection: SavedRemoteConnection,
  path: string,
  body?: unknown,
): Effect.Effect<unknown, unknown> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${connection.httpBaseUrl.replace(/\/+$/g, "")}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${connection.bearerToken ?? ""}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`personal push request failed with ${response.status}`);
      return await response.json();
    },
    catch: (cause) => cause,
  });
}

function postToServers(
  connections: ReadonlyArray<SavedRemoteConnection>,
  path: string,
  body: unknown,
  onError: (connection: SavedRemoteConnection, error: unknown) => void,
): Effect.Effect<boolean> {
  if (connections.length === 0) return Effect.succeed(false);
  return Effect.forEach(
    connections,
    (connection) =>
      request(connection, path, body).pipe(
        Effect.as(true),
        Effect.catch((error) => Effect.sync(() => (onError(connection, error), false))),
      ),
    { concurrency: 3 },
  ).pipe(Effect.map((results) => results.some(Boolean)));
}

/** True when at least one server accepted the device registration. */
export const registerPersonalPushDevice = (
  connections: ReadonlyArray<SavedRemoteConnection>,
  body: RelayDeviceRegistrationRequest,
  onError: (connection: SavedRemoteConnection, error: unknown) => void,
) => postToServers(connections, DEVICES_PATH, body, onError);

/** True when at least one server accepted the Live Activity token. */
export const registerPersonalPushLiveActivity = (
  connections: ReadonlyArray<SavedRemoteConnection>,
  body: RelayLiveActivityRegistrationRequest,
  onError: (connection: SavedRemoteConnection, error: unknown) => void,
) => postToServers(connections, LIVE_ACTIVITIES_PATH, body, onError);

/** The first snapshot any personal server returns, or null. */
export const readPersonalPushSnapshot = Effect.fnUntraced(function* (
  connections: ReadonlyArray<SavedRemoteConnection>,
) {
  for (const connection of connections) {
    const result = yield* request(connection, SNAPSHOT_PATH).pipe(
      Effect.flatMap(decodeSnapshot),
      Effect.option,
    );
    if (Option.isSome(result)) return result.value;
  }
  return null;
});
