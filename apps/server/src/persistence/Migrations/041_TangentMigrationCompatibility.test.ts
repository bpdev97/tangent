import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_TangentMigrationCompatibility", (it) => {
  it.effect("closes only orphaned Hermes prompts whose turns are terminal", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });

      for (const thread of [
        { id: "hermes-interrupted", provider: "hermes", turnState: "interrupted" },
        { id: "hermes-running", provider: "hermes", turnState: "running" },
        { id: "codex-interrupted", provider: "codex", turnState: "interrupted" },
      ] as const) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id,
            project_id,
            title,
            latest_turn_id,
            created_at,
            updated_at,
            pending_user_input_count
          )
          VALUES (
            ${thread.id},
            'project-1',
            ${thread.id},
            ${`turn:${thread.id}`},
            '2026-07-30T00:00:00.000Z',
            '2026-07-30T00:00:02.000Z',
            1
          )
        `;
        yield* sql`
          INSERT INTO projection_thread_sessions (
            thread_id,
            status,
            provider_name,
            active_turn_id,
            updated_at
          )
          VALUES (
            ${thread.id},
            'ready',
            ${thread.provider},
            NULL,
            '2026-07-30T00:00:02.000Z'
          )
        `;
        yield* sql`
          INSERT INTO projection_turns (
            thread_id,
            turn_id,
            state,
            requested_at,
            started_at,
            completed_at,
            checkpoint_files_json
          )
          VALUES (
            ${thread.id},
            ${`turn:${thread.id}`},
            ${thread.turnState},
            '2026-07-30T00:00:00.000Z',
            '2026-07-30T00:00:00.000Z',
            ${thread.turnState === "running" ? null : "2026-07-30T00:00:02.000Z"},
            '[]'
          )
        `;
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id,
            thread_id,
            turn_id,
            tone,
            kind,
            summary,
            payload_json,
            sequence,
            created_at
          )
          VALUES (
            ${`request:${thread.id}`},
            ${thread.id},
            ${`turn:${thread.id}`},
            'info',
            'user-input.requested',
            'User input requested',
            json_object(
              'requestId',
              ${`input:${thread.id}`},
              'questions',
              json_array(json_object(
                'id',
                'answer',
                'header',
                'Hermes question',
                'question',
                'What should I search for?',
                'options',
                json_array()
              ))
            ),
            NULL,
            '2026-07-30T00:00:01.000Z'
          )
        `;
      }

      yield* runMigrations({ toMigrationInclusive: 41 });

      const resolved = yield* sql<{
        readonly threadId: string;
        readonly kind: string;
        readonly requestId: string;
      }>`
        SELECT
          thread_id AS "threadId",
          kind,
          json_extract(payload_json, '$.requestId') AS "requestId"
        FROM projection_thread_activities
        WHERE activity_id LIKE 'migration-039:%'
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(resolved, [
        {
          threadId: "hermes-interrupted",
          kind: "user-input.resolved",
          requestId: "input:hermes-interrupted",
        },
      ]);

      const counts = yield* sql<{
        readonly threadId: string;
        readonly pendingUserInputCount: number;
      }>`
        SELECT
          thread_id AS "threadId",
          pending_user_input_count AS "pendingUserInputCount"
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(counts, [
        { threadId: "codex-interrupted", pendingUserInputCount: 1 },
        { threadId: "hermes-interrupted", pendingUserInputCount: 0 },
        { threadId: "hermes-running", pendingUserInputCount: 1 },
      ]);
    }),
  );
});

const compatibilityLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

compatibilityLayer("041_TangentMigrationCompatibility legacy ledger", (it) => {
  it.effect("repairs databases that already used Tangent migration IDs 36 and 39", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (36, 'CloseInterruptedHermesUserInputs')
      `;
      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (39, 'TangentMigrationCompatibility')
      `;

      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "pinned_at"));
      assert.ok(columns.some((column) => column.name === "pin_order_key"));

      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.ok(projectColumns.some((column) => column.name === "default_thread_env_mode"));
      assert.ok(projectColumns.some((column) => column.name === "favicon_path"));

      const migrations = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 36
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { migration_id: 36, name: "CloseInterruptedHermesUserInputs" },
        { migration_id: 37, name: "ProjectionTurnsKeysetIndex" },
        { migration_id: 38, name: "ProjectionThreadsPinOrderKey" },
        { migration_id: 39, name: "TangentMigrationCompatibility" },
        { migration_id: 40, name: "ProjectionProjectFaviconPath" },
        { migration_id: 41, name: "TangentMigrationCompatibility" },
      ]);
    }),
  );
});
