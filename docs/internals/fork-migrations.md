# Fork database migrations

Upstream owns `effect_sql_migrations` and the numbered files in
`apps/server/src/persistence/Migrations/`. Tangent migrations live in `ForkMigrations/` and use
`tangent_sql_migrations`. Add each fork migration to the loader in `ForkMigrations.ts`; its ID is
independent of upstream IDs and must never change after release.

Startup first bridges legacy Tangent databases, then applies upstream migrations, then applies
fork migrations. The legacy bridge recognizes exact ID/name pairs from released builds: 36,
39, 41, 44, and 45. It repairs the corresponding upstream schema or data change before replacing
the ledger name. It removes Tangent's old entry 45 so upstream can use that ID normally. Repairs
and ledger normalization share a transaction. Unrecognized names and upstream entries are left
alone. The separate fork migration performs the historical Hermes prompt repair once.

`runMigrations({ toMigrationInclusive })` constructs an upstream-only schema fixture for tests.
Normal startup calls `runMigrations()` without a limit. Upgrade tests cover each released collision,
combined historical collisions, repeated startup, and subsequent upstream migrations. Run
`vp test run apps/server/src/persistence/ForkMigrations.test.ts` when changing this boundary.

Never renumber a fork migration to make room for upstream again. Preserve the legacy bridge while
databases from those releases remain supported.
