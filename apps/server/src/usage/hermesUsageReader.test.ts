// @effect-diagnostics nodeBuiltinImport:off - the suite seeds real Hermes
// databases on disk, as Hermes itself writes them.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { hermesUsageRoots, readHermesUsage } from "./hermesUsageReader.ts";

const SINCE = Date.parse("2026-09-01T00:00:00Z");
const IN_WINDOW = Date.parse("2026-09-10T12:00:00Z") / 1_000;
const BEFORE_WINDOW = Date.parse("2026-08-01T12:00:00Z") / 1_000;

interface UsageRow {
  readonly session: string;
  readonly model: string;
  readonly task?: string;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly reasoning?: number;
  readonly estimated?: number;
  readonly actual?: number;
  readonly lastSeen?: number;
}

/** The columns Hermes's `session_model_usage` table has. */
async function writeDatabase(path: string, rows: ReadonlyArray<UsageRow> | null) {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  const database = new NodeSqlite.DatabaseSync(path);
  try {
    database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    if (rows === null) return;
    database.exec(`CREATE TABLE session_model_usage (
      session_id TEXT, model TEXT, billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT,
      task TEXT, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
      estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT,
      first_seen REAL, last_seen REAL)`);
    const insert = database.prepare(
      `INSERT INTO session_model_usage (session_id, model, task, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens, estimated_cost_usd,
         actual_cost_usd, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      const lastSeen = row.lastSeen ?? IN_WINDOW;
      insert.run(
        row.session,
        row.model,
        row.task ?? "",
        row.input ?? 0,
        row.output ?? 0,
        row.cacheRead ?? 0,
        row.cacheWrite ?? 0,
        row.reasoning ?? 0,
        row.estimated ?? 0,
        row.actual ?? 0,
        lastSeen,
        lastSeen,
      );
    }
  } finally {
    database.close();
  }
}

const makeRoot = () => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-hermes-usage-"));

describe("readHermesUsage", () => {
  it("reads each profile's per-model totals as Hermes recorded them", async () => {
    const root = await makeRoot();
    const main = NodePath.join(root, "state.db");
    const research = NodePath.join(root, "profiles", "research", "state.db");
    await writeDatabase(main, [
      // A subscription call: Hermes records no cost, so the price table estimates it.
      {
        session: "s1",
        model: "gpt-5.6-sol",
        input: 100,
        output: 40,
        cacheRead: 900,
        cacheWrite: 7,
        reasoning: 15,
      },
      // A background call Hermes made for the same session.
      { session: "s1", model: "gpt-5.6-sol", task: "title_generation", input: 20, output: 5 },
      // Outside the window, no tokens, and a model Hermes could not name.
      { session: "old", model: "gpt-5.6-sol", input: 50, output: 5, lastSeen: BEFORE_WINDOW },
      { session: "empty", model: "gpt-5.6-sol" },
      { session: "s2", model: "unknown", input: 10, output: 1 },
    ]);
    await writeDatabase(research, [
      { session: "r1", model: "x-ai/grok-4.5", input: 10, output: 30, estimated: 0.25 },
      {
        session: "r2",
        model: "anthropic/claude-fable-5",
        input: 1,
        output: 2,
        estimated: 0.5,
        actual: 0.4,
      },
    ]);

    const result = await readHermesUsage(root, SINCE);
    assert.isFalse(result.missing);
    assert.isFalse(result.error);
    assert.deepStrictEqual(
      result.files.map((file) => [file.path, file.records.length]),
      [
        [research, 2],
        [main, 2],
      ],
    );

    const [subscription, background] = result.files[1]!.records;
    assert.deepStrictEqual(subscription, {
      provider: "hermes",
      timestampMs: IN_WINDOW * 1_000,
      model: "gpt-5.6-sol",
      sessionId: "s1",
      // Hermes's input excludes cached tokens and its output includes reasoning.
      totals: {
        uncachedInputTokens: 100,
        cachedInputTokens: 900,
        cacheCreationTokens: 7,
        outputTokens: 40,
        reasoningTokens: 15,
      },
      reportedCostUsd: null,
      speed: "standard",
      dedupeKey: null,
    });
    assert.strictEqual(background?.totals.uncachedInputTokens, 20);

    const [estimated, billed] = result.files[0]!.records;
    // Vendor-prefixed names are OpenRouter ids, priced under that prefix.
    assert.strictEqual(estimated?.rateModel, "openrouter/x-ai/grok-4.5");
    assert.strictEqual(estimated?.reportedCostUsd, 0.25);
    // What was actually billed beats Hermes's estimate.
    assert.strictEqual(billed?.reportedCostUsd, 0.4);
  });

  it("reports nothing for a root without Hermes, or a database from before usage was recorded", async () => {
    const absent = await readHermesUsage(NodePath.join(await makeRoot(), "nowhere"), SINCE);
    assert.deepStrictEqual(absent, { files: [], missing: true, error: false });

    const root = await makeRoot();
    await writeDatabase(NodePath.join(root, "state.db"), null);
    const old = await readHermesUsage(root, SINCE);
    assert.isFalse(old.error);
    assert.deepStrictEqual(
      old.files.map((file) => file.records),
      [[]],
    );
  });

  it.effect("finds one root per Hermes home, however many instances share it", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(makeRoot);
      const custom = yield* Effect.promise(makeRoot);
      const roots = yield* hermesUsageRoots([
        { HOME: home },
        { HOME: home },
        // An instance pointed at a profile of another Hermes home.
        { HOME: home, HERMES_HOME: NodePath.join(custom, "profiles", "research") },
        {},
      ]);
      assert.sameMembers(
        roots.map((root) => NodePath.basename(root)),
        [".hermes", NodePath.basename(custom)],
      );
      assert.lengthOf(roots, 2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
