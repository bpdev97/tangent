import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_CloseInterruptedHermesUserInputs", (it) => {
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

      yield* runMigrations({ toMigrationInclusive: 36 });

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
        WHERE activity_id LIKE 'migration-036:%'
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
