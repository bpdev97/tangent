import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import CloseInterruptedHermesUserInputs from "./ForkMigrations/001_CloseInterruptedHermesUserInputs.ts";
import ClearAutomaticProjectModelDefaults from "./Migrations/044_ClearAutomaticProjectModelDefaults.ts";

const legacyMigrations = [
  [36, "CloseInterruptedHermesUserInputs", "ProjectionThreadsPinned"],
  [39, "TangentMigrationCompatibility", "ProjectionProjectsDefaultThreadEnvMode"],
  [41, "TangentMigrationCompatibility", "AuthSessionClientConnection"],
  [44, "TangentMigrationCompatibility", "ClearAutomaticProjectModelDefaults"],
  [45, "TangentMigrationCompatibility", null],
] as const;

// Normalize only IDs that a released Tangent build occupied. Repairs and ledger changes
// share a transaction so upstream can safely resume at its own next migration.
export const bridgeLegacyForkMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables =
    yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'`;
  if (tables.length === 0) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const entries = yield* sql<{
        migration_id: number;
        name: string;
      }>`SELECT migration_id, name FROM effect_sql_migrations`;
      const addColumn = (table: string, column: string) =>
        Effect.gen(function* () {
          const columns = yield* sql<{ name: string }>`PRAGMA table_info(${sql(table)})`;
          if (!columns.some(({ name }) => name === column)) {
            yield* sql`ALTER TABLE ${sql(table)} ADD COLUMN ${sql(column)} TEXT`;
          }
        });
      for (const [id, legacyName, upstreamName] of legacyMigrations) {
        if (!entries.some((entry) => entry.migration_id === id && entry.name === legacyName))
          continue;
        switch (id) {
          case 36:
            yield* addColumn("projection_threads", "pinned_at");
            break;
          case 39:
            yield* addColumn("projection_projects", "default_thread_env_mode");
            break;
          case 41:
            yield* addColumn("auth_sessions", "client_surface");
            yield* addColumn("auth_sessions", "client_app_version");
            break;
          case 44:
            yield* ClearAutomaticProjectModelDefaults;
            break;
        }
        if (upstreamName === null) {
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${id} AND name = ${legacyName}`;
        } else {
          yield* sql`UPDATE effect_sql_migrations SET name = ${upstreamName} WHERE migration_id = ${id} AND name = ${legacyName}`;
        }
      }
    }),
  );
});

export const runForkMigrations = Migrator.make({})({
  table: "tangent_sql_migrations",
  loader: Migrator.fromRecord({
    "1_CloseInterruptedHermesUserInputs": CloseInterruptedHermesUserInputs,
  }),
});
