import * as NodeSqlite from "node:sqlite";
import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
  RelayAgentAwarenessPreferences,
  RelayDeviceRegistrationRequest,
  RelayLiveActivityRegistrationRequest,
} from "@t3tools/contracts/relay";

import { activityExpiresAtMs, makeAggregate } from "./aggregate.ts";

export interface DeliveryTarget {
  readonly deviceId: string;
  readonly pushToken: string | null;
  readonly activityPushToken: string | null;
  readonly bundleId: string | null;
  readonly apsEnvironment: "sandbox" | "production" | null;
  readonly preferences: RelayAgentAwarenessPreferences;
  readonly lastNotificationAggregate: RelayAgentActivityAggregateState | null;
  readonly lastLiveActivityAggregate: RelayAgentActivityAggregateState | null;
}

interface DeviceRow {
  device_id: string;
  push_token: string | null;
  activity_push_token: string | null;
  bundle_id: string | null;
  aps_environment: "sandbox" | "production" | null;
  preferences_json: string;
  last_notification_aggregate_json: string | null;
  last_live_activity_aggregate_json: string | null;
}

interface TableColumnRow {
  name: string;
}

interface ActivityRow {
  state_json: string;
}

interface ActivityMigrationRow extends ActivityRow {
  environment_id: string;
  thread_id: string;
}

export interface PendingDelivery {
  readonly deviceId: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly state: RelayAgentActivityState | null;
  readonly attempts: number;
}

export class RelayStore {
  readonly #database: NodeSqlite.DatabaseSync;

  constructor(path: string) {
    this.#database = new NodeSqlite.DatabaseSync(path);
    this.#database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        push_token TEXT,
        activity_push_token TEXT,
        bundle_id TEXT,
        aps_environment TEXT,
        preferences_json TEXT NOT NULL,
        last_aggregate_json TEXT,
        last_notification_aggregate_json TEXT,
        last_live_activity_aggregate_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activities (
        environment_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (environment_id, thread_id)
      );
      CREATE TABLE IF NOT EXISTS notification_phases (
        device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        environment_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, environment_id, thread_id)
      );
      CREATE TABLE IF NOT EXISTS pending_deliveries (
        device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        environment_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        state_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, environment_id, thread_id)
      );
    `);
    this.#migrateDeliveryWatermarks();
    this.#migrateActivityExpiry();
    this.pruneExpiredActivities();
  }

  #migrateActivityExpiry(): void {
    const columns = new Set(
      (
        this.#database.prepare("PRAGMA table_info(activities)").all() as unknown as TableColumnRow[]
      ).map((column) => column.name),
    );
    if (!columns.has("expires_at")) {
      this.#database.exec("ALTER TABLE activities ADD COLUMN expires_at TEXT");
    }
    const rows = this.#database
      .prepare(
        "SELECT environment_id, thread_id, state_json FROM activities WHERE expires_at IS NULL",
      )
      .all() as unknown as ActivityMigrationRow[];
    if (rows.length === 0) return;

    const update = this.#database.prepare(
      "UPDATE activities SET expires_at = ? WHERE environment_id = ? AND thread_id = ?",
    );
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const state = JSON.parse(row.state_json) as RelayAgentActivityState;
        update.run(
          new Date(activityExpiresAtMs(state)).toISOString(),
          row.environment_id,
          row.thread_id,
        );
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #migrateDeliveryWatermarks(): void {
    const columns = new Set(
      (
        this.#database.prepare("PRAGMA table_info(devices)").all() as unknown as TableColumnRow[]
      ).map((column) => column.name),
    );
    const missingColumns = (
      ["last_notification_aggregate_json", "last_live_activity_aggregate_json"] as const
    ).filter((column) => !columns.has(column));
    if (missingColumns.length === 0) return;

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const column of missingColumns) {
        this.#database.exec(`ALTER TABLE devices ADD COLUMN ${column} TEXT`);
        this.#database.exec(`UPDATE devices SET ${column} = last_aggregate_json`);
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.#database.close();
  }

  registerDevice(input: RelayDeviceRegistrationRequest): void {
    this.#database
      .prepare(`
      INSERT INTO devices (
        device_id, label, push_token, bundle_id, aps_environment, preferences_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        label = excluded.label,
        push_token = excluded.push_token,
        bundle_id = excluded.bundle_id,
        aps_environment = excluded.aps_environment,
        preferences_json = excluded.preferences_json,
        updated_at = excluded.updated_at
    `)
      .run(
        input.deviceId,
        input.label,
        input.pushToken ?? null,
        input.bundleId ?? null,
        input.apsEnvironment ?? null,
        JSON.stringify(input.preferences),
        new Date().toISOString(),
      );
  }

  registerLiveActivity(input: RelayLiveActivityRegistrationRequest): boolean {
    const result = this.#database
      .prepare(`
      UPDATE devices
      SET activity_push_token = ?, last_live_activity_aggregate_json = NULL, updated_at = ?
      WHERE device_id = ?
    `)
      .run(input.activityPushToken, new Date().toISOString(), input.deviceId);
    return result.changes > 0;
  }

  publish(input: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly state: RelayAgentActivityState | null;
  }): void {
    if (input.state === null) {
      this.#database
        .prepare("DELETE FROM activities WHERE environment_id = ? AND thread_id = ?")
        .run(input.environmentId, input.threadId);
      this.pruneExpiredActivities();
      return;
    }
    this.#database
      .prepare(`
      INSERT INTO activities (environment_id, thread_id, state_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(environment_id, thread_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `)
      .run(
        input.environmentId,
        input.threadId,
        JSON.stringify(input.state),
        input.state.updatedAt,
        new Date(activityExpiresAtMs(input.state)).toISOString(),
      );
    this.pruneExpiredActivities();
  }

  publishForDelivery(input: {
    readonly environmentId: string;
    readonly threadId: string;
    readonly state: RelayAgentActivityState | null;
  }): void {
    const now = Date.now();
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.publish(input);
      if (input.state === null) {
        this.#database
          .prepare("DELETE FROM notification_phases WHERE environment_id = ? AND thread_id = ?")
          .run(input.environmentId, input.threadId);
      }
      this.#database
        .prepare(`
        INSERT INTO pending_deliveries (device_id, environment_id, thread_id, state_json, next_attempt_at, expires_at)
        SELECT device_id, ?, ?, ?, ?, ? FROM devices WHERE true
        ON CONFLICT(device_id, environment_id, thread_id) DO UPDATE SET
          state_json = excluded.state_json, attempts = 0,
          next_attempt_at = excluded.next_attempt_at, expires_at = excluded.expires_at
      `)
        .run(
          input.environmentId,
          input.threadId,
          input.state ? JSON.stringify(input.state) : null,
          now,
          input.state ? activityExpiresAtMs(input.state) : now + 15 * 60_000,
        );
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  pendingDeliveries(now = Date.now()): ReadonlyArray<PendingDelivery> {
    this.#database.prepare("DELETE FROM pending_deliveries WHERE expires_at < ?").run(now);
    this.#database.prepare("DELETE FROM notification_phases WHERE expires_at < ?").run(now);
    const rows = this.#database
      .prepare(`
      SELECT device_id, environment_id, thread_id, state_json, attempts
      FROM pending_deliveries WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 256
    `)
      .all(now) as unknown as Array<{
      device_id: string;
      environment_id: string;
      thread_id: string;
      state_json: string | null;
      attempts: number;
    }>;
    return rows.map((row) => ({
      deviceId: row.device_id,
      environmentId: row.environment_id,
      threadId: row.thread_id,
      state: row.state_json ? (JSON.parse(row.state_json) as RelayAgentActivityState) : null,
      attempts: row.attempts,
    }));
  }

  nextDeliveryAt(): number | null {
    const row = this.#database
      .prepare("SELECT MIN(next_attempt_at) AS next FROM pending_deliveries")
      .get() as { next: number | null };
    return row.next;
  }

  completeDelivery(delivery: PendingDelivery): void {
    this.#database
      .prepare(
        "DELETE FROM pending_deliveries WHERE device_id = ? AND environment_id = ? AND thread_id = ?",
      )
      .run(delivery.deviceId, delivery.environmentId, delivery.threadId);
  }

  retryDelivery(delivery: PendingDelivery): void {
    if (delivery.attempts >= 5) {
      this.completeDelivery(delivery);
      return;
    }
    this.#database
      .prepare(`UPDATE pending_deliveries SET attempts = attempts + 1, next_attempt_at = ?
      WHERE device_id = ? AND environment_id = ? AND thread_id = ?`)
      .run(
        Date.now() + Math.min(30_000 * 2 ** delivery.attempts, 300_000),
        delivery.deviceId,
        delivery.environmentId,
        delivery.threadId,
      );
  }

  notificationPhase(
    target: DeliveryTarget,
    state: RelayAgentActivityState,
  ): RelayAgentActivityState["phase"] | null {
    const row = this.#database
      .prepare(
        "SELECT phase FROM notification_phases WHERE device_id = ? AND environment_id = ? AND thread_id = ?",
      )
      .get(target.deviceId, state.environmentId, state.threadId) as
      | { phase: RelayAgentActivityState["phase"] }
      | undefined;
    return (
      row?.phase ??
      target.lastNotificationAggregate?.activities.find(
        (activity) =>
          activity.environmentId === state.environmentId &&
          activity.threadId === state.threadId &&
          activityExpiresAtMs(activity) >= Date.now(),
      )?.phase ??
      null
    );
  }

  recordNotificationPhase(deviceId: string, state: RelayAgentActivityState): void {
    this.#database
      .prepare(`INSERT INTO notification_phases (device_id, environment_id, thread_id, phase, expires_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(device_id, environment_id, thread_id) DO UPDATE SET
      phase = excluded.phase, expires_at = excluded.expires_at`)
      .run(deviceId, state.environmentId, state.threadId, state.phase, activityExpiresAtMs(state));
  }

  pruneExpiredActivities(nowMs = Date.now()): void {
    this.#database
      .prepare("DELETE FROM activities WHERE expires_at IS NULL OR expires_at < ?")
      .run(new Date(nowMs).toISOString());
  }

  aggregate(): RelayAgentActivityAggregateState | null {
    this.pruneExpiredActivities();
    const rows = this.#database
      .prepare("SELECT state_json FROM activities")
      .all() as unknown as ActivityRow[];
    return makeAggregate(rows.map((row) => JSON.parse(row.state_json) as RelayAgentActivityState));
  }

  targets(): ReadonlyArray<DeliveryTarget> {
    const rows = this.#database
      .prepare(`
      SELECT device_id, push_token, activity_push_token, bundle_id, aps_environment,
             preferences_json, last_notification_aggregate_json,
             last_live_activity_aggregate_json
      FROM devices
    `)
      .all() as unknown as DeviceRow[];
    return rows.map((row) => ({
      deviceId: row.device_id,
      pushToken: row.push_token,
      activityPushToken: row.activity_push_token,
      bundleId: row.bundle_id,
      apsEnvironment: row.aps_environment,
      preferences: JSON.parse(row.preferences_json) as RelayAgentAwarenessPreferences,
      lastNotificationAggregate: row.last_notification_aggregate_json
        ? (JSON.parse(row.last_notification_aggregate_json) as RelayAgentActivityAggregateState)
        : null,
      lastLiveActivityAggregate: row.last_live_activity_aggregate_json
        ? (JSON.parse(row.last_live_activity_aggregate_json) as RelayAgentActivityAggregateState)
        : null,
    }));
  }

  target(deviceId: string): DeliveryTarget | null {
    return this.targets().find((target) => target.deviceId === deviceId) ?? null;
  }

  recordLiveActivityAggregate(
    deviceId: string,
    aggregate: RelayAgentActivityAggregateState | null,
  ): void {
    this.#database
      .prepare(
        "UPDATE devices SET last_live_activity_aggregate_json = ?, updated_at = ? WHERE device_id = ?",
      )
      .run(aggregate ? JSON.stringify(aggregate) : null, new Date().toISOString(), deviceId);
  }

  clearPushToken(deviceId: string): void {
    this.#database
      .prepare("UPDATE devices SET push_token = NULL WHERE device_id = ?")
      .run(deviceId);
  }

  clearActivityToken(deviceId: string): void {
    this.#database
      .prepare(
        "UPDATE devices SET activity_push_token = NULL, last_live_activity_aggregate_json = NULL WHERE device_id = ?",
      )
      .run(deviceId);
  }
}
