import {
  RelayAgentActivityState,
  type RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { makeAggregate } from "./aggregate.ts";
import { shouldNotify } from "./apns.ts";
import { RelayStore } from "./store.ts";

const decodeState = Schema.decodeUnknownSync(RelayAgentActivityState);

function state(
  phase: "running" | "waiting_for_approval" | "completed" | "failed",
  updatedAt = "2026-07-14T12:00:00.000Z",
) {
  return decodeState({
    environmentId: "environment-1",
    threadId: "thread-1",
    projectTitle: "Relay project",
    threadTitle: "Implement notifications",
    phase,
    headline: "Agent activity",
    modelTitle: "Codex",
    updatedAt,
    deepLink: "/environments/environment-1/threads/thread-1",
  });
}

const preferences: RelayAgentAwarenessPreferences = {
  liveActivitiesEnabled: true,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

describe("personal push relay aggregation", () => {
  it("keeps active work ahead of recent terminal rows", () => {
    const aggregate = makeAggregate(
      [
        state("completed", "2026-07-14T12:01:00.000Z"),
        decodeState({
          ...state("running"),
          threadId: "thread-2",
          updatedAt: "2026-07-14T12:02:00.000Z",
        }),
      ],
      Date.parse("2026-07-14T12:03:00.000Z"),
    );

    expect(aggregate?.title).toBe("T3 Code");
    expect(aggregate?.activeCount).toBe(1);
    expect(aggregate?.activities.map((row) => row.phase)).toEqual(["running", "completed"]);
  });

  it("expires stale running work", () => {
    expect(makeAggregate([state("running")], Date.parse("2026-07-14T15:00:00.000Z"))).toBeNull();
  });

  it("notifies once when a thread enters an enabled phase", () => {
    const running = makeAggregate([state("running")], Date.parse("2026-07-14T12:00:30.000Z"));
    expect(
      shouldNotify({ state: state("waiting_for_approval"), previous: running, preferences }),
    ).toBe(true);
    expect(
      shouldNotify({
        state: state("waiting_for_approval"),
        previous: makeAggregate(
          [state("waiting_for_approval")],
          Date.parse("2026-07-14T12:00:30.000Z"),
        ),
        preferences,
      }),
    ).toBe(false);
  });

  it("persists devices and activity state in SQLite", () => {
    const store = new RelayStore(":memory:");
    store.registerDevice({
      deviceId: "device-1",
      label: "iPhone",
      platform: "ios",
      iosMajorVersion: 18,
      bundleId: "com.example.t3",
      apsEnvironment: "production",
      pushToken: "push-token",
      preferences,
    });
    store.publish({
      environmentId: "environment-1",
      threadId: "thread-1",
      state: state("running", new Date().toISOString()),
    });

    expect(store.targets()).toHaveLength(1);
    expect(store.aggregate()?.activeCount).toBe(1);
    expect(
      store.registerLiveActivity({ deviceId: "device-1", activityPushToken: "activity-token" }),
    ).toBe(true);
    expect(store.target("device-1")?.activityPushToken).toBe("activity-token");
    store.close();
  });
});
