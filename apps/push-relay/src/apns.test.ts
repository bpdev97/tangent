import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
} from "@t3tools/contracts/relay";
import { describe, expect, it } from "vite-plus/test";

import { makeLiveActivityRequest, makeNotificationRequest } from "./apns.ts";
import type { RelayConfig } from "./config.ts";

const apnsConfig: RelayConfig["apns"] = {
  teamId: "TESTTEAM01",
  keyId: "TESTKEY001",
  bundleId: "com.example.t3code",
  environment: "production",
  privateKey: "unused",
};

const state: RelayAgentActivityState = {
  environmentId: "environment-1" as RelayAgentActivityState["environmentId"],
  threadId: "thread-1" as RelayAgentActivityState["threadId"],
  projectTitle: "Push relay",
  threadTitle: "Implement notifications",
  phase: "waiting_for_approval",
  headline: "Agent activity",
  modelTitle: "Codex",
  updatedAt: "2026-07-14T12:00:00.000Z",
  deepLink: "/environments/environment-1/threads/thread-1",
};

const aggregate: RelayAgentActivityAggregateState = {
  title: "T3 Code",
  subtitle: "1 agent needs attention",
  activeCount: 1,
  updatedAt: state.updatedAt,
  activities: [{ ...state, status: "Approval needed" }],
};

describe("APNs request construction", () => {
  it("constructs a standard alert with stable thread collapsing", () => {
    const request = makeNotificationRequest(apnsConfig, {
      token: "notification-token",
      state,
    });

    expect(request).toEqual({
      token: "notification-token",
      topic: apnsConfig.bundleId,
      pushType: "alert",
      priority: "10",
      environment: "production",
      collapseId: expect.stringMatching(/^[a-f0-9]{64}$/),
      payload: {
        aps: {
          alert: {
            title: "Implement notifications",
            body: "Approval needed: Push relay",
          },
          sound: "default",
        },
        environmentId: "environment-1",
        threadId: "thread-1",
        deepLink: "/environments/environment-1/threads/thread-1",
      },
    });
  });

  it("constructs background Live Activity updates in the widget contract", () => {
    const now = Date.parse("2026-07-14T12:01:00.000Z");
    const request = makeLiveActivityRequest(
      apnsConfig,
      { token: "activity-token", aggregate, alert: null, event: "update" },
      now,
    );

    expect(request).toMatchObject({
      token: "activity-token",
      topic: "com.example.t3code.push-type.liveactivity",
      pushType: "liveactivity",
      priority: "5",
      environment: "production",
      payload: {
        aps: {
          timestamp: Math.floor(now / 1_000),
          event: "update",
          "content-state": {
            name: "AgentActivity",
            props: JSON.stringify(aggregate),
          },
          "stale-date": Math.floor(now / 1_000) + 10 * 60,
        },
      },
    });
  });

  it("constructs alerting updates and terminal events at high priority", () => {
    const now = Date.parse("2026-07-14T12:01:00.000Z");
    const alert = { title: "Implement notifications", body: "Approval needed: Push relay" };
    const update = makeLiveActivityRequest(
      apnsConfig,
      { token: "activity-token", aggregate, alert, event: "update" },
      now,
    );
    const terminalAggregate = { ...aggregate, activeCount: 0 };
    const terminalUpdate = makeLiveActivityRequest(
      apnsConfig,
      { token: "activity-token", aggregate: terminalAggregate, alert: null, event: "update" },
      now,
    );
    const end = makeLiveActivityRequest(
      apnsConfig,
      { token: "activity-token", aggregate: terminalAggregate, alert: null, event: "end" },
      now,
    );

    expect(update.priority).toBe("10");
    expect(update.payload).toMatchObject({
      aps: { event: "update", alert: { ...alert, sound: "default" } },
    });
    expect(terminalUpdate.priority).toBe("5");
    expect(terminalUpdate.payload).toMatchObject({ aps: { event: "update" } });
    expect(end.priority).toBe("10");
    expect(end.payload).toMatchObject({
      aps: {
        event: "end",
        "dismissal-date": Math.floor(now / 1_000),
        "content-state": {
          name: "AgentActivity",
          props: JSON.stringify(terminalAggregate),
        },
      },
    });
  });
});
