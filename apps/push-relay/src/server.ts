import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeTimersPromises from "node:timers/promises";
import {
  PersonalPushActivityPublishRequest,
  RelayDeviceRegistrationRequest,
  RelayLiveActivityRegistrationRequest,
} from "@t3tools/contracts/relay";
import * as Schema from "effect/Schema";

import { ApnsClient, type ApnsDeliveryClient, liveActivityAlert } from "./apns.ts";
import type { RelayConfig } from "./config.ts";
import { RelayStore, type DeliveryTarget } from "./store.ts";

const MAX_BODY_BYTES = 64 * 1_024;
const MAX_PENDING_PUBLICATIONS = 256;
const LIVE_ACTIVITY_END_DELAY_MS = 5 * 60 * 1_000;
const decodeDevice = Schema.decodeUnknownSync(RelayDeviceRegistrationRequest);
const decodeLiveActivity = Schema.decodeUnknownSync(RelayLiveActivityRegistrationRequest);
const decodePublish = Schema.decodeUnknownSync(PersonalPushActivityPublishRequest);

class InvalidRequestError extends Error {}

function json(response: NodeHttp.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: NodeHttp.IncomingMessage): Promise<unknown> {
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > MAX_BODY_BYTES) throw new Error("request body is too large");
      chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    throw new InvalidRequestError("request body is invalid", { cause });
  }
}

async function decodeBody<A>(
  request: NodeHttp.IncomingMessage,
  decode: (value: unknown) => A,
): Promise<A> {
  try {
    return decode(await readJson(request));
  } catch (cause) {
    if (cause instanceof InvalidRequestError) throw cause;
    throw new InvalidRequestError("request body does not match the endpoint schema", { cause });
  }
}

function tokenDigest(token: string): Buffer {
  return NodeCrypto.createHash("sha256").update(token).digest();
}

function authorized(request: NodeHttp.IncomingMessage, expectedDigest: Buffer): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  return NodeCrypto.timingSafeEqual(tokenDigest(authorization.slice(7)), expectedDigest);
}

async function mapConcurrent<T>(
  values: ReadonlyArray<T>,
  limit: number,
  operation: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const value = values[cursor++];
        if (value !== undefined) await operation(value);
      }
    }),
  );
}

export interface PushRelayServer {
  readonly url: string;
  readonly close: () => Promise<void>;
}

export interface PushRelayServerDependencies {
  readonly apns?: ApnsDeliveryClient;
  readonly liveActivityEndDelayMs?: number;
  readonly maxPendingPublications?: number;
}

export async function startServer(
  config: RelayConfig,
  dependencies: PushRelayServerDependencies = {},
): Promise<PushRelayServer> {
  const store = new RelayStore(config.databasePath);
  const apns = dependencies.apns ?? new ApnsClient(config.apns);
  await apns.ready();
  const expectedTokenDigest = tokenDigest(config.authToken);
  const recentLiveActivityRegistrations = new Map<
    string,
    { readonly token: string; readonly registeredAt: number }
  >();
  const activityEndTimers = new Map<string, AbortController>();
  const activityEndDelayMs = dependencies.liveActivityEndDelayMs ?? LIVE_ACTIVITY_END_DELAY_MS;
  const maxPendingPublications = dependencies.maxPendingPublications ?? MAX_PENDING_PUBLICATIONS;
  let publishQueue = Promise.resolve();
  let pendingPublications = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closing = false;

  const cancelActivityEnd = (deviceId: string): void => {
    const controller = activityEndTimers.get(deviceId);
    if (!controller) return;
    controller.abort();
    activityEndTimers.delete(deviceId);
  };

  const endLiveActivity = async (deviceId: string, token: string): Promise<void> => {
    const target = store.target(deviceId);
    const aggregate = store.aggregate();
    if (
      !target?.activityPushToken ||
      target.activityPushToken !== token ||
      !target.preferences.liveActivitiesEnabled ||
      (aggregate?.activeCount ?? 0) > 0
    ) {
      return;
    }
    const result = await apns.sendLiveActivity({
      token,
      bundleId: target.bundleId,
      environment: target.apsEnvironment,
      aggregate,
      alert: null,
      event: "end",
    });
    if (result.ok || result.invalidToken) {
      store.clearActivityToken(deviceId);
    }
    if (!result.ok) {
      console.warn("APNs Live Activity end failed", {
        deviceId,
        tokenSuffix: token.slice(-8),
        status: result.status,
        reason: result.reason,
      });
    }
  };

  const scheduleActivityEnd = (deviceId: string, token: string): void => {
    cancelActivityEnd(deviceId);
    const controller = new AbortController();
    activityEndTimers.set(deviceId, controller);
    void NodeTimersPromises.setTimeout(activityEndDelayMs, undefined, {
      signal: controller.signal,
      ref: false,
    })
      .then(() => {
        if (activityEndTimers.get(deviceId) !== controller) return;
        activityEndTimers.delete(deviceId);
        const operation = publishQueue.then(() => endLiveActivity(deviceId, token));
        publishQueue = operation.catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "AbortError") {
          console.error("Live Activity end scheduling failed", { deviceId, error });
        }
      });
  };

  const deliver = async (
    target: DeliveryTarget,
    state: ReturnType<typeof decodePublish>["state"],
    aggregate: ReturnType<RelayStore["aggregate"]>,
    updateNotificationWatermark: boolean,
  ): Promise<boolean> => {
    const alert = liveActivityAlert({
      state,
      previous: state ? store.notificationPhase(target, state) : null,
      preferences: target.preferences,
    });

    let retryNotification = false;
    let retryLiveActivity = false;
    let notificationDelivered = alert === null;
    if (alert && target.pushToken && state) {
      const result = await apns.sendNotification({
        token: target.pushToken,
        bundleId: target.bundleId,
        environment: target.apsEnvironment,
        state,
      });
      if (result.ok) {
        notificationDelivered = true;
        store.recordNotificationPhase(target.deviceId, state);
      }
      retryNotification = !result.ok && (result.status === 429 || result.status >= 500);
      if (result.invalidToken) store.clearPushToken(target.deviceId);
      if (!result.ok) {
        console.warn("APNs notification delivery failed", {
          deviceId: target.deviceId,
          tokenSuffix: target.pushToken.slice(-8),
          status: result.status,
          reason: result.reason,
        });
      }
    }
    if (alert === null && updateNotificationWatermark && state) {
      store.recordNotificationPhase(target.deviceId, state);
    }

    const liveActivityChanged =
      JSON.stringify(target.lastLiveActivityAggregate) !== JSON.stringify(aggregate);
    if (
      target.activityPushToken &&
      target.preferences.liveActivitiesEnabled &&
      (liveActivityChanged || (!notificationDelivered && alert !== null))
    ) {
      cancelActivityEnd(target.deviceId);
      const event = aggregate === null ? "end" : "update";
      const includesNotification = !notificationDelivered && alert !== null;
      const result = await apns.sendLiveActivity({
        token: target.activityPushToken,
        bundleId: target.bundleId,
        environment: target.apsEnvironment,
        aggregate,
        alert: includesNotification ? alert : null,
        event,
      });
      if (result.invalidToken || (result.ok && event === "end")) {
        store.clearActivityToken(target.deviceId);
      } else if (result.ok) {
        store.recordLiveActivityAggregate(target.deviceId, aggregate);
        if (aggregate?.activeCount === 0) {
          scheduleActivityEnd(target.deviceId, target.activityPushToken);
        }
      }
      if (result.ok && includesNotification) {
        if (state) store.recordNotificationPhase(target.deviceId, state);
        retryNotification = false;
      }
      retryLiveActivity = !result.ok && (result.status === 429 || result.status >= 500);
      if (!result.ok) {
        console.warn("APNs Live Activity delivery failed", {
          deviceId: target.deviceId,
          tokenSuffix: target.activityPushToken.slice(-8),
          status: result.status,
          reason: result.reason,
        });
      }
    }
    return retryNotification || retryLiveActivity;
  };

  const drainDeliveries = async (): Promise<void> => {
    const aggregate = store.aggregate();
    await mapConcurrent(store.pendingDeliveries(), 4, async (delivery) => {
      const target = store.target(delivery.deviceId);
      try {
        if (target && (await deliver(target, delivery.state, aggregate, true))) {
          store.retryDelivery(delivery);
        } else {
          store.completeDelivery(delivery);
        }
      } catch (error) {
        console.warn("APNs delivery deferred", { deviceId: delivery.deviceId, error });
        store.retryDelivery(delivery);
      }
    });
  };

  const scheduleRetries = (): void => {
    clearTimeout(retryTimer);
    if (closing) return;
    const next = store.nextDeliveryAt();
    if (next === null) return;
    // @effect-diagnostics-next-line globalTimers:off - Node HTTP service owns this timer.
    retryTimer = setTimeout(
      () => {
        publishQueue = publishQueue
          .then(drainDeliveries)
          .catch((error) => {
            console.error("Push delivery retry failed", { error });
          })
          .finally(scheduleRetries);
      },
      Math.max(0, next - Date.now()),
    );
    retryTimer.unref();
  };

  const server = NodeHttp.createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 },
    async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (request.method === "GET" && url.pathname === "/healthz") {
          json(response, 200, { ok: true, service: "t3-personal-push-relay" });
          return;
        }
        if (!authorized(request, expectedTokenDigest)) {
          response.setHeader("www-authenticate", "Bearer");
          json(response, 401, { error: "unauthorized" });
          return;
        }

        if (request.method === "POST" && url.pathname === "/v1/devices") {
          const registration = await decodeBody(request, decodeDevice);
          if (
            (registration.bundleId && registration.bundleId !== config.apns.bundleId) ||
            (registration.apsEnvironment && registration.apsEnvironment !== config.apns.environment)
          ) {
            json(response, 422, { error: "apns_configuration_mismatch" });
            return;
          }
          store.registerDevice(registration);
          json(response, 200, { ok: true });
          return;
        }
        if (request.method === "POST" && url.pathname === "/v1/live-activities") {
          const registration = await decodeBody(request, decodeLiveActivity);
          const registrationTime = Date.now();
          for (const [deviceId, recent] of recentLiveActivityRegistrations) {
            if (registrationTime - recent.registeredAt >= 5_000) {
              recentLiveActivityRegistrations.delete(deviceId);
            }
          }
          const recent = recentLiveActivityRegistrations.get(registration.deviceId);
          if (
            recent?.token === registration.activityPushToken &&
            registrationTime - recent.registeredAt < 5_000
          ) {
            json(response, 200, { ok: true });
            return;
          }
          if (!store.registerLiveActivity(registration)) {
            json(response, 404, { error: "device_not_registered" });
            return;
          }
          recentLiveActivityRegistrations.set(registration.deviceId, {
            token: registration.activityPushToken,
            registeredAt: registrationTime,
          });
          const target = store.target(registration.deviceId);
          if (target?.activityPushToken && target.preferences.liveActivitiesEnabled) {
            await deliver(target, null, store.aggregate(), false);
          }
          json(response, 200, { ok: true });
          return;
        }
        if (request.method === "GET" && url.pathname === "/v1/agent-activity") {
          json(response, 200, { aggregate: store.aggregate() });
          return;
        }
        if (request.method === "POST" && url.pathname === "/v1/agent-activities") {
          const publication = await decodeBody(request, decodePublish);
          if (
            publication.state &&
            (publication.state.environmentId !== publication.environmentId ||
              publication.state.threadId !== publication.threadId)
          ) {
            throw new InvalidRequestError("activity identity does not match its envelope");
          }
          if (pendingPublications >= maxPendingPublications) {
            json(response, 429, { error: "publication_queue_full" });
            return;
          }
          pendingPublications += 1;
          const publicationOperation = publishQueue
            .then(async () => {
              store.publishForDelivery(publication);
              await drainDeliveries();
            })
            .finally(() => {
              pendingPublications -= 1;
              scheduleRetries();
            });
          publishQueue = publicationOperation.catch(() => undefined);
          await publicationOperation;
          json(response, 200, { ok: true });
          return;
        }
        json(response, 404, { error: "not_found" });
      } catch (error) {
        console.error("push relay request failed", {
          method: request.method,
          path: request.url?.split("?", 1)[0],
          error: error instanceof Error ? error.message : String(error),
        });
        json(response, error instanceof InvalidRequestError ? 400 : 500, {
          error: error instanceof InvalidRequestError ? "invalid_request" : "internal_error",
        });
      }
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  if ((store.aggregate()?.activeCount ?? 0) === 0) {
    for (const target of store.targets()) {
      if (target.activityPushToken && target.preferences.liveActivitiesEnabled) {
        scheduleActivityEnd(target.deviceId, target.activityPushToken);
      }
    }
  }
  const address = server.address() as NodeNet.AddressInfo;
  scheduleRetries();
  return {
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      closing = true;
      clearTimeout(retryTimer);
      for (const controller of activityEndTimers.values()) controller.abort();
      activityEndTimers.clear();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await publishQueue;
      await apns.close?.();
      store.close();
    },
  };
}
