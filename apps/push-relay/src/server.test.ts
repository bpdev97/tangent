import * as NodeHttp from "node:http";
import type {
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  ApnsDeliveryClient,
  ApnsResult,
  LiveActivityInput,
  NotificationInput,
} from "./apns.ts";
import type { RelayConfig } from "./config.ts";
import { startServer, type PushRelayServer } from "./server.ts";
import { RelayStore } from "./store.ts";

const preferences: RelayAgentAwarenessPreferences = {
  liveActivitiesEnabled: true,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

const config: RelayConfig = {
  host: "127.0.0.1",
  port: 0,
  databasePath: ":memory:",
  authToken: "test-auth-token-with-at-least-32-characters",
  apns: {
    teamId: "TESTTEAM01",
    keyId: "TESTKEY001",
    bundleId: "com.example.t3code",
    environment: "production",
    privateKey: "unused by the injected test client",
  },
};

const success: ApnsResult = {
  ok: true,
  status: 200,
  reason: null,
  apnsId: "test-apns-id",
  invalidToken: false,
};

const transientFailure: ApnsResult = {
  ok: false,
  status: 503,
  reason: "ServiceUnavailable",
  apnsId: "test-failed-apns-id",
  invalidToken: false,
};

class RecordingApnsClient implements ApnsDeliveryClient {
  readonly notifications: NotificationInput[] = [];
  readonly liveActivities: LiveActivityInput[] = [];
  readonly notificationResults: ApnsResult[] = [];
  readonly liveActivityResults: ApnsResult[] = [];

  ready(): Promise<void> {
    return Promise.resolve();
  }

  sendNotification(input: NotificationInput): Promise<ApnsResult> {
    this.notifications.push(input);
    return Promise.resolve(this.notificationResults.shift() ?? success);
  }

  sendLiveActivity(input: LiveActivityInput): Promise<ApnsResult> {
    this.liveActivities.push(input);
    return Promise.resolve(this.liveActivityResults.shift() ?? success);
  }
}

function activityState(phase: RelayAgentActivityState["phase"]): RelayAgentActivityState {
  return {
    environmentId: "environment-1" as RelayAgentActivityState["environmentId"],
    threadId: "thread-1" as RelayAgentActivityState["threadId"],
    projectTitle: "Push relay",
    threadTitle: "Implement notifications",
    phase,
    headline: "Agent activity",
    modelTitle: "Codex",
    updatedAt: new Date().toISOString(),
    deepLink: "/environments/environment-1/threads/thread-1",
  };
}

async function request(
  server: PushRelayServer,
  path: string,
  options: { readonly method?: "GET" | "POST"; readonly body?: unknown } = {},
): Promise<{ readonly status: number; readonly body: unknown }> {
  const url = new URL(path, server.url);
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  return await new Promise((resolve, reject) => {
    const outgoing = NodeHttp.request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${config.authToken}`,
          ...(body === null
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(body) }),
        },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.once("error", reject);
        incoming.once("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: incoming.statusCode ?? 0,
            body: text ? (JSON.parse(text) as unknown) : null,
          });
        });
      },
    );
    outgoing.once("error", reject);
    if (body !== null) outgoing.write(body);
    outgoing.end();
  });
}

async function registerDevice(
  server: PushRelayServer,
  overrides: Partial<RelayAgentAwarenessPreferences> = {},
): Promise<void> {
  const result = await request(server, "/v1/devices", {
    method: "POST",
    body: {
      deviceId: "device-1",
      label: "Test iPhone",
      platform: "ios",
      iosMajorVersion: 18,
      pushToken: "notification-token",
      bundleId: config.apns.bundleId,
      apsEnvironment: config.apns.environment,
      preferences: { ...preferences, ...overrides },
    },
  });
  expect(result).toEqual({ status: 200, body: { ok: true } });
}

async function publish(
  server: PushRelayServer,
  phase: RelayAgentActivityState["phase"],
): Promise<void> {
  await publishState(server, activityState(phase));
}

async function publishState(
  server: PushRelayServer,
  state: RelayAgentActivityState,
): Promise<void> {
  const result = await request(server, "/v1/agent-activities", {
    method: "POST",
    body: {
      environmentId: state.environmentId,
      threadId: state.threadId,
      state,
    },
  });
  expect(result).toEqual({ status: 200, body: { ok: true } });
}

describe("personal push relay HTTP integration", () => {
  let server: PushRelayServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
    vi.restoreAllMocks();
  });

  it("delivers one notification when a thread enters an enabled phase", async () => {
    const apns = new RecordingApnsClient();
    server = await startServer(config, { apns });
    await registerDevice(server, { liveActivitiesEnabled: false });

    await publish(server, "running");
    await publish(server, "waiting_for_approval");
    await publish(server, "waiting_for_approval");

    expect(apns.notifications).toHaveLength(1);
    expect(apns.notifications[0]).toMatchObject({
      token: "notification-token",
      bundleId: config.apns.bundleId,
      environment: config.apns.environment,
      state: {
        phase: "waiting_for_approval",
        environmentId: "environment-1",
        threadId: "thread-1",
      },
    });
    expect(apns.liveActivities).toHaveLength(0);
  });

  it("computes one aggregate snapshot per publication regardless of device count", async () => {
    const aggregate = vi.spyOn(RelayStore.prototype, "aggregate");
    const apns = new RecordingApnsClient();
    server = await startServer(config, { apns });
    await registerDevice(server, { liveActivitiesEnabled: false });
    aggregate.mockClear();

    await publish(server, "running");

    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it("rejects publications when the ordered delivery queue is full", async () => {
    let releaseNotification!: (result: ApnsResult) => void;
    const apns = new RecordingApnsClient();
    apns.sendNotification = (input: NotificationInput) => {
      apns.notifications.push(input);
      return new Promise((resolve) => {
        releaseNotification = resolve;
      });
    };
    server = await startServer(config, { apns, maxPendingPublications: 1 });
    await registerDevice(server, { liveActivitiesEnabled: false });
    await publish(server, "running");

    const first = request(server, "/v1/agent-activities", {
      method: "POST",
      body: {
        environmentId: "environment-1",
        threadId: "thread-1",
        state: activityState("waiting_for_approval"),
      },
    });
    await vi.waitFor(() => expect(apns.notifications).toHaveLength(1));
    const rejected = await request(server, "/v1/agent-activities", {
      method: "POST",
      body: {
        environmentId: "environment-1",
        threadId: "thread-1",
        state: activityState("waiting_for_approval"),
      },
    });

    expect(rejected).toEqual({ status: 429, body: { error: "publication_queue_full" } });
    releaseNotification(success);
    expect(await first).toEqual({ status: 200, body: { ok: true } });
  });

  it("retries an identical notification after transient APNs failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const apns = new RecordingApnsClient();
    apns.notificationResults.push(transientFailure, success);
    server = await startServer(config, { apns });
    await registerDevice(server, { liveActivitiesEnabled: false });
    await publish(server, "running");

    const waiting = activityState("waiting_for_approval");
    await publishState(server, waiting);
    await publishState(server, waiting);

    expect(apns.notifications).toHaveLength(2);
    expect(apns.notifications.map((delivery) => delivery.state)).toEqual([waiting, waiting]);
    expect(apns.liveActivities).toHaveLength(0);
  });

  it("retries only a failed Live Activity channel after its notification succeeds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const apns = new RecordingApnsClient();
    server = await startServer(config, { apns });
    await registerDevice(server);
    await publish(server, "running");
    await request(server, "/v1/live-activities", {
      method: "POST",
      body: { deviceId: "device-1", activityPushToken: "live-activity-token" },
    });
    apns.liveActivityResults.push(transientFailure, success);

    const waiting = activityState("waiting_for_approval");
    await publishState(server, waiting);
    await publishState(server, waiting);

    expect(apns.notifications).toHaveLength(1);
    expect(apns.liveActivities).toHaveLength(3);
    expect(apns.liveActivities.slice(1).map((delivery) => delivery.aggregate)).toEqual([
      apns.liveActivities[1]?.aggregate,
      apns.liveActivities[1]?.aggregate,
    ]);
    expect(apns.liveActivities.slice(1).map((delivery) => delivery.alert)).toEqual([null, null]);
  });

  it("uses a successful Live Activity alert to acknowledge a failed notification", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const apns = new RecordingApnsClient();
    server = await startServer(config, { apns });
    await registerDevice(server);
    await publish(server, "running");
    await request(server, "/v1/live-activities", {
      method: "POST",
      body: { deviceId: "device-1", activityPushToken: "live-activity-token" },
    });
    apns.notificationResults.push(transientFailure);

    const waiting = activityState("waiting_for_approval");
    await publishState(server, waiting);
    await publishState(server, waiting);

    expect(apns.notifications).toHaveLength(1);
    expect(apns.liveActivities).toHaveLength(2);
    expect(apns.liveActivities.at(-1)?.alert).toEqual({
      title: "Implement notifications",
      body: "Approval needed: Push relay",
    });
  });

  it("notifies separately and keeps a completed Live Activity reusable until its grace period", async () => {
    const apns = new RecordingApnsClient();
    server = await startServer(config, { apns, liveActivityEndDelayMs: 250 });
    await registerDevice(server);
    await publish(server, "running");

    const registration = await request(server, "/v1/live-activities", {
      method: "POST",
      body: { deviceId: "device-1", activityPushToken: "live-activity-token" },
    });
    expect(registration).toEqual({ status: 200, body: { ok: true } });
    await publish(server, "waiting_for_approval");
    await publish(server, "completed");

    expect(apns.liveActivities).toHaveLength(3);
    expect(apns.liveActivities.map((delivery) => delivery.aggregate?.activeCount)).toEqual([
      1, 1, 0,
    ]);
    expect(apns.liveActivities.map((delivery) => delivery.event)).toEqual([
      "update",
      "update",
      "update",
    ]);
    expect(apns.liveActivities.map((delivery) => delivery.alert)).toEqual([null, null, null]);
    expect(apns.notifications.map((delivery) => delivery.state.phase)).toEqual([
      "waiting_for_approval",
      "completed",
    ]);

    await publish(server, "running");
    expect(apns.liveActivities.at(-1)).toMatchObject({
      event: "update",
      aggregate: { activeCount: 1 },
    });

    await publish(server, "completed");
    expect(apns.liveActivities.at(-1)).toMatchObject({
      event: "update",
      aggregate: { activeCount: 0 },
    });
    await vi.waitFor(() => expect(apns.liveActivities).toHaveLength(6), { timeout: 2_000 });
    expect(apns.liveActivities.at(-1)).toMatchObject({
      event: "end",
      aggregate: { activeCount: 0 },
    });
    expect(apns.notifications.map((delivery) => delivery.state.phase)).toEqual([
      "waiting_for_approval",
      "completed",
      "completed",
    ]);
  });
});
