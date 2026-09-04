import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    INSERT OR IGNORE INTO projection_thread_activities (
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
    SELECT
      'migration-039:hermes-user-input:' || requested.activity_id,
      requested.thread_id,
      requested.turn_id,
      'info',
      'user-input.resolved',
      'User input cancelled',
      json_object(
        'requestId',
        json_extract(requested.payload_json, '$.requestId'),
        'answers',
        json('{}')
      ),
      NULL,
      COALESCE(turn.completed_at, requested.created_at)
    FROM projection_thread_activities AS requested
    JOIN projection_thread_sessions AS session
      ON session.thread_id = requested.thread_id
      AND session.provider_name = 'hermes'
    JOIN projection_turns AS turn
      ON turn.thread_id = requested.thread_id
      AND turn.turn_id = requested.turn_id
      AND turn.state IN ('completed', 'interrupted', 'error')
    WHERE requested.kind = 'user-input.requested'
      AND json_extract(requested.payload_json, '$.requestId') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM projection_thread_activities AS resolved
        WHERE resolved.thread_id = requested.thread_id
          AND resolved.kind = 'user-input.resolved'
          AND json_extract(resolved.payload_json, '$.requestId')
            = json_extract(requested.payload_json, '$.requestId')
      )
  `;

  yield* sql`
    UPDATE projection_threads
    SET pending_user_input_count = COALESCE((
      WITH latest_user_input_states AS (
        SELECT
          latest.request_id,
          latest.kind,
          latest.detail
        FROM (
          SELECT
            json_extract(activity.payload_json, '$.requestId') AS request_id,
            activity.kind,
            lower(COALESCE(json_extract(activity.payload_json, '$.detail'), '')) AS detail,
            ROW_NUMBER() OVER (
              PARTITION BY json_extract(activity.payload_json, '$.requestId')
              ORDER BY activity.created_at DESC, activity.activity_id DESC
            ) AS row_number
          FROM projection_thread_activities AS activity
          WHERE activity.thread_id = projection_threads.thread_id
            AND json_extract(activity.payload_json, '$.requestId') IS NOT NULL
            AND activity.kind IN (
              'user-input.requested',
              'user-input.resolved',
              'provider.user-input.respond.failed'
            )
        ) AS latest
        WHERE latest.row_number = 1
      )
      SELECT COUNT(*)
      FROM latest_user_input_states
      WHERE latest_user_input_states.kind = 'user-input.requested'
        OR (
          latest_user_input_states.kind = 'provider.user-input.respond.failed'
          AND latest_user_input_states.detail NOT LIKE '%stale pending user-input request%'
          AND latest_user_input_states.detail NOT LIKE '%unknown pending user-input request%'
          AND latest_user_input_states.detail NOT LIKE '%unknown pending user input request%'
          AND latest_user_input_states.detail NOT LIKE '%unknown pending codex user input request%'
        )
    ), 0)
    WHERE projection_threads.thread_id IN (
      SELECT thread_id
      FROM projection_thread_sessions
      WHERE provider_name = 'hermes'
    )
  `;
});
