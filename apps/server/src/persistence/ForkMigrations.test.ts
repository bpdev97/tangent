import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Migrator from "effect/unstable/sql/Migrator";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

for (const id of [36, 39, 41, 44, 45]) {
  it.effect(`upgrades a release with fork migration ${id} and leaves upstream IDs available`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: id - 1 });
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${id === 36 ? "CloseInterruptedHermesUserInputs" : "TangentMigrationCompatibility"})`;
      yield* runMigrations();
      yield* runMigrations();
      const upstream = yield* sql<{
        migration_id: number;
        name: string;
      }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;
      assert.deepEqual(
        upstream.map(({ migration_id, name }) => [migration_id, name] as const),
        migrationManifest,
      );
      const fork = yield* sql<{
        migration_id: number;
        name: string;
      }>`SELECT migration_id, name FROM tangent_sql_migrations`;
      assert.deepEqual(fork, [{ migration_id: 1, name: "CloseInterruptedHermesUserInputs" }]);
      yield* Migrator.make({})({
        loader: Migrator.fromRecord({
          [`${migrationManifest.at(-1)![0] + 1}_FutureUpstream`]: sql`CREATE TABLE future_upstream (id TEXT)`,
        }),
      });
      yield* sql`INSERT INTO future_upstream (id) VALUES ('upstream ran')`;
      assert.deepEqual(yield* sql`SELECT id FROM future_upstream`, [{ id: "upstream ran" }]);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
}

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("ForkMigrations", (it) => {
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

      yield* runMigrations();

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

compatibilityLayer("ForkMigrations legacy ledger", (it) => {
  it.effect("repairs databases that already used Tangent migration IDs 36, 39, and 41", () =>
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
      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (41, 'TangentMigrationCompatibility')
      `;
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (44, 'TangentMigrationCompatibility')
      `;

      // Tangent 0.1.47 recorded its compatibility repair as migration 44,
      // so the upstream cleanup with that ID is skipped on released databases.
      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          favicon_path,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-auto',
          'Auto',
          '/tmp/auto',
          '{"instanceId":"codex","model":"gpt-5.6-sol"}',
          NULL,
          '[]',
          '2026-08-01T00:00:00.000Z',
          '2026-08-01T00:00:00.000Z',
          NULL
        )
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          'event-auto-create',
          'project',
          'project-auto',
          0,
          'project.created',
          '2026-08-01T00:00:00.000Z',
          'command-auto-create',
          NULL,
          'command-auto-create',
          'client',
          '{"defaultModelSelection":{"instanceId":"codex","model":"gpt-5.6-sol"}}',
          '{}'
        )
      `;

      yield* runMigrations();

      const [project] = yield* sql<{ readonly selection: string | null }>`
        SELECT default_model_selection_json AS "selection"
        FROM projection_projects
        WHERE project_id = 'project-auto'
      `;
      assert.strictEqual(project?.selection, null);
      const [createdEvent] = yield* sql<{ readonly model: string | null }>`
        SELECT json_extract(payload_json, '$.defaultModelSelection.model') AS "model"
        FROM orchestration_events
        WHERE event_id = 'event-auto-create'
      `;
      assert.strictEqual(createdEvent?.model, null);

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "pinned_at"));
      assert.ok(columns.some((column) => column.name === "pin_order_key"));
      assert.ok(columns.some((column) => column.name === "linked_pull_request_json"));
      assert.ok(columns.some((column) => column.name === "unsettled_at"));

      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.ok(projectColumns.some((column) => column.name === "default_thread_env_mode"));
      assert.ok(projectColumns.some((column) => column.name === "favicon_path"));

      const authSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      assert.ok(authSessionColumns.some((column) => column.name === "client_surface"));
      assert.ok(authSessionColumns.some((column) => column.name === "client_app_version"));

      const migrations = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 36
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        migrations,
        migrationManifest
          .filter(([id]) => id >= 36)
          .map(([migration_id, name]) => ({ migration_id, name })),
      );
    }),
  );
});
