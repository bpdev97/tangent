import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
} from "@t3tools/contracts/relay";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { RelayStore } from "./store.ts";

const preferences: RelayAgentAwarenessPreferences = {
  liveActivitiesEnabled: true,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

const aggregate: RelayAgentActivityAggregateState = {
  title: "T3 Code",
  subtitle: "Agent work in progress",
  activeCount: 1,
  updatedAt: "2026-07-17T12:00:00.000Z",
  activities: [],
};

describe("RelayStore migrations", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates the legacy aggregate watermark to both delivery channels", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "push-relay-store-"));
    temporaryDirectories.push(directory);
    const databasePath = NodePath.join(directory, "relay.sqlite");
    const database = new NodeSqlite.DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE devices (
        device_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        push_token TEXT,
        activity_push_token TEXT,
        bundle_id TEXT,
        aps_environment TEXT,
        preferences_json TEXT NOT NULL,
        last_aggregate_json TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    database
      .prepare(`
        INSERT INTO devices (
          device_id, label, push_token, activity_push_token, bundle_id, aps_environment,
          preferences_json, last_aggregate_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "device-1",
        "Test iPhone",
        "push-token",
        "activity-token",
        "com.example.t3code",
        "production",
        JSON.stringify(preferences),
        JSON.stringify(aggregate),
        aggregate.updatedAt,
      );
    database.close();

    const store = new RelayStore(databasePath);
    expect(store.target("device-1")).toMatchObject({
      lastNotificationAggregate: aggregate,
      lastLiveActivityAggregate: aggregate,
    });
    store.close();
  });

  it("removes expired activity rows from persistent storage", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "push-relay-store-"));
    temporaryDirectories.push(directory);
    const databasePath = NodePath.join(directory, "relay.sqlite");
    const store = new RelayStore(databasePath);
    store.publish({
      environmentId: "environment-1",
      threadId: "thread-1",
      state: {
        environmentId: "environment-1" as RelayAgentActivityState["environmentId"],
        threadId: "thread-1" as RelayAgentActivityState["threadId"],
        projectTitle: "Expired project",
        threadTitle: "Expired thread",
        phase: "running",
        headline: "Expired activity",
        modelTitle: "Codex",
        updatedAt: "2020-01-01T00:00:00.000Z",
        deepLink: "/",
      },
    });
    store.close();

    const database = new NodeSqlite.DatabaseSync(databasePath);
    const row = database.prepare("SELECT COUNT(*) AS count FROM activities").get() as {
      count: number;
    };
    database.close();
    expect(row.count).toBe(0);
  });
});
