// @effect-diagnostics nodeBuiltinImport:off - the suite seeds real Hermes
// databases on disk, as Hermes itself writes them.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { ProviderDriverKind, ProviderInstanceId, UsageDay } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageService from "./UsageService.ts";

import { hermesUsageRoots, readHermesUsage, scanHermesUsage } from "./hermesUsageReader.ts";

const SINCE = Date.parse("2026-09-01T00:00:00Z");
const IN_WINDOW_ISO = "2026-09-10T12:00:00Z";
const IN_WINDOW = Date.parse(IN_WINDOW_ISO) / 1_000;
const BEFORE_WINDOW = Date.parse("2026-08-01T12:00:00Z") / 1_000;

interface UsageRow {
  readonly session: string;
  readonly model: string;
  readonly billing?: string;
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
async function writeDatabase(
  path: string,
  rows: ReadonlyArray<UsageRow> | null,
  /** Session id to the `model_config` JSON Hermes keeps for it. */
  sessions: Readonly<Record<string, string>> = {},
) {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  const database = new NodeSqlite.DatabaseSync(path);
  try {
    database.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, model_config TEXT)");
    const session = database.prepare("INSERT INTO sessions VALUES (?, ?)");
    for (const [id, config] of Object.entries(sessions)) session.run(id, config);
    if (rows === null) return;
    database.exec(`CREATE TABLE session_model_usage (
      session_id TEXT, model TEXT, billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT,
      task TEXT, api_call_count INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
      estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, cost_source TEXT,
      first_seen REAL, last_seen REAL)`);
    const insert = database.prepare(
      `INSERT INTO session_model_usage (session_id, model, billing_provider, task, input_tokens,
         output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
         estimated_cost_usd, actual_cost_usd, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      const lastSeen = row.lastSeen ?? IN_WINDOW;
      insert.run(
        row.session,
        row.model,
        row.billing ?? "",
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

// Real paths, as sources are named by where their database really is.
const makeRoot = async () =>
  NodeFSP.realpath(await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-hermes-usage-")));

describe("readHermesUsage", () => {
  it("reads each profile's per-model totals as Hermes recorded them", async () => {
    const root = await makeRoot();
    const research = NodePath.join(root, "profiles", "research");
    await writeDatabase(NodePath.join(root, "state.db"), [
      // A subscription call: Hermes records no cost, so the price table estimates it.
      {
        session: "s1",
        model: "gpt-5.6-sol",
        billing: "openai-codex",
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
    await writeDatabase(NodePath.join(research, "state.db"), [
      {
        session: "r1",
        model: "x-ai/grok-4.5",
        billing: "openrouter",
        input: 10,
        output: 30,
        estimated: 0.25,
      },
      {
        session: "r2",
        model: "anthropic/claude-fable-5",
        billing: "openrouter",
        input: 1,
        output: 2,
        estimated: 0.5,
        actual: 0.4,
      },
      // The same vendor-prefixed name, billed by the vendor's own subscription.
      { session: "r3", model: "openai/gpt-5.6-sol", billing: "openai-codex", input: 5, output: 5 },
    ]);

    const [main, other] = await readHermesUsage([root], SINCE);
    assert.deepStrictEqual(
      [main, other].map((profile) => [profile?.home, profile?.status, profile?.records.length]),
      [
        [root, "ok", 2],
        [research, "ok", 3],
      ],
    );

    const [subscription, background] = main!.records;
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

    const [estimated, billed, direct] = other!.records;
    // Only what OpenRouter billed is priced at OpenRouter's rate.
    assert.strictEqual(estimated?.rateModel, "openrouter/x-ai/grok-4.5");
    assert.strictEqual(direct?.rateModel, "gpt-5.6-sol");
    assert.strictEqual(estimated?.reportedCostUsd, 0.25);
    // What was actually billed beats Hermes's estimate.
    assert.strictEqual(billed?.reportedCostUsd, 0.4);
  });

  it("leaves turns that ran on Hermes's Codex runtime to Codex's own history", async () => {
    const root = await makeRoot();
    await writeDatabase(
      NodePath.join(root, "state.db"),
      [
        { session: "codex", model: "gpt-5.6-sol", billing: "openai-codex", input: 100, output: 10 },
        // Hermes records `provider: openai` on that runtime as `custom`.
        { session: "codex", model: "gpt-5.6-sol", billing: "custom", input: 200, output: 10 },
        // Hermes made this call itself, so Codex never saw it.
        {
          session: "codex",
          model: "gpt-5.6-sol",
          billing: "openai-codex",
          task: "title_generation",
          input: 7,
          output: 1,
        },
        // The session switched to a provider Hermes calls itself and kept its thread.
        { session: "codex", model: "claude-fable-5", billing: "anthropic", input: 9, output: 1 },
        { session: "plain", model: "gpt-5.6-sol", billing: "openai-codex", input: 3, output: 1 },
        { session: "cleared", model: "gpt-5.6-sol", billing: "openai-codex", input: 4, output: 1 },
      ],
      {
        codex: '{"codex_thread_id":"thr_1"}',
        plain: '{"reasoning_config":null}',
        cleared: '{"codex_thread_id":null}',
      },
    );
    const [profile] = await readHermesUsage([root], SINCE);
    assert.sameMembers(
      profile!.records.map((record) => record.totals.uncachedInputTokens),
      [7, 9, 3, 4],
    );
  });

  it("reads a database once however it is reached, and all of a profile or none of it", async () => {
    const root = await makeRoot();
    const database = NodePath.join(root, "state.db");
    await writeDatabase(database, [
      { session: "s1", model: "gpt-5.6-sol", input: 100, output: 10 },
    ]);
    // A profile whose database is a link to the root's is the same history.
    const linked = NodePath.join(root, "profiles", "linked");
    await NodeFSP.mkdir(linked, { recursive: true });
    await NodeFSP.symlink(database, NodePath.join(linked, "state.db"));
    // So is a second Hermes root that links to it.
    const second = await makeRoot();
    await NodeFSP.symlink(database, NodePath.join(second, "state.db"));
    // A profile whose database cannot be read reports nothing rather than part of itself.
    const broken = NodePath.join(root, "profiles", "broken");
    await NodeFSP.mkdir(broken, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(broken, "state.db"), "not a database");

    const expected = [
      [root, "ok", 1],
      [broken, "failed", 0],
    ];
    const usage = await readHermesUsage([root, second], SINCE);
    assert.deepStrictEqual(
      usage.map((profile) => [profile.home, profile.status, profile.records.length]),
      expected,
    );
    // Reached through the link first, the history still belongs to the same source.
    const reversed = await readHermesUsage([second, root], SINCE);
    assert.deepStrictEqual(
      reversed.map((profile) => [profile.home, profile.status, profile.records.length]),
      expected,
    );
  });

  it("reports a root without Hermes as missing, and a database from before usage as empty", async () => {
    const nowhere = NodePath.join(await makeRoot(), "nowhere");
    const root = await makeRoot();
    await writeDatabase(NodePath.join(root, "state.db"), null);
    assert.deepStrictEqual(await readHermesUsage([nowhere, root], SINCE), [
      { home: nowhere, path: nowhere, records: [], status: "missing" },
      { home: root, path: NodePath.join(root, "state.db"), records: [], status: "ok" },
    ]);
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

  // Another server on this machine may hold an older complete copy of the same
  // profile. A partial source would be added on top of it, and Hermes moves a
  // row to a later day as its session goes on, so that would count it twice.
  it.effect("reports each profile as a whole source, never a partial one", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(makeRoot);
      const root = NodePath.join(home, ".hermes");
      const broken = NodePath.join(root, "profiles", "broken");
      yield* Effect.promise(async () => {
        await writeDatabase(NodePath.join(root, "state.db"), [
          { session: "s1", model: "gpt-5.6-sol", input: 100, output: 10 },
        ]);
        await NodeFSP.mkdir(broken, { recursive: true });
        await NodeFSP.writeFile(NodePath.join(broken, "state.db"), "not a database");
      });
      const sources = yield* scanHermesUsage([{ HOME: home }], SINCE);
      assert.deepStrictEqual(
        sources.map((source) => [source.dir, source.status, source.files?.length]),
        [
          [root, "ok", 1],
          [broken, "failed", 0],
        ],
      );
      // No Hermes on the machine is one missing source, like any other provider.
      const none = yield* scanHermesUsage([{ HOME: yield* Effect.promise(makeRoot) }], SINCE);
      assert.deepStrictEqual(
        none.map((source) => [source.status, source.files]),
        [["ok", null]],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("Hermes usage in the usage service", () => {
  // Two servers that read one profile must report the same usage for it, so
  // a Codex-runtime turn is always Codex's. Reading the Codex home Hermes runs
  // with is what keeps that turn counted.
  it.live("counts a Codex-runtime turn once, from the Codex home Hermes ran it in", () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(makeRoot);
      const hermesHome = NodePath.join(home, "hermes");
      const codexHome = NodePath.join(home, "hermes-codex");
      yield* Effect.promise(async () => {
        await writeDatabase(
          NodePath.join(hermesHome, "state.db"),
          [
            { session: "s1", model: "gpt-5.6-sol", billing: "openai-codex", input: 10, output: 11 },
            {
              session: "s1",
              model: "gpt-5.6-sol",
              billing: "openai-codex",
              task: "title_generation",
              input: 2,
              output: 5,
            },
          ],
          { s1: '{"codex_thread_id":"thr_1"}' },
        );
        await NodeFSP.mkdir(NodePath.join(codexHome, "sessions"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(codexHome, "sessions", "rollout.jsonl"),
          [
            { type: "session_meta", payload: { id: "thr_1" } },
            { type: "turn_context", payload: { model: "gpt-5.6-sol" } },
            {
              type: "event_msg",
              timestamp: IN_WINDOW_ISO,
              payload: {
                type: "token_count",
                info: { last_token_usage: { input_tokens: 10, output_tokens: 11 } },
              },
            },
          ]
            .map((line) => JSON.stringify(line))
            .join("\n") + "\n",
        );
      });
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "usage-service-hermes-test" }).pipe(
            Layer.provideMerge(NodeServices.layer),
            Layer.provideMerge(Layer.succeed(HostProcessPlatform, "linux")),
            Layer.provideMerge(
              ServerSettings.layerTest({
                // Keep the scan inside the temporary home.
                providers: {
                  claudeAgent: { homePath: NodePath.join(home, "claude") },
                  codex: { homePath: NodePath.join(home, "codex") },
                },
                providerInstances: {
                  // The only place this Codex home is named is the Hermes instance.
                  [ProviderInstanceId.make("hermes")]: {
                    driver: ProviderDriverKind.make("hermes"),
                    environment: [
                      { name: "HERMES_HOME", value: hermesHome, sensitive: false },
                      { name: "CODEX_HOME", value: codexHome, sensitive: false },
                    ],
                  },
                },
              }),
            ),
            Layer.provideMerge(
              Layer.succeed(
                HttpClient.HttpClient,
                HttpClient.make((request) =>
                  Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}))),
                ),
              ),
            ),
            Layer.provideMerge(
              Layer.succeed(HostProcessEnvironment, {
                HOME: home,
                GROK_HOME: NodePath.join(home, "grok"),
                OPENCODE_DATA_DIR: NodePath.join(home, "opencode"),
                ANTIGRAVITY_DATA_DIR: NodePath.join(home, "antigravity"),
                XDG_CONFIG_HOME: NodePath.join(home, "config"),
              }),
            ),
          ),
        ),
      );
      const summary = yield* service.readSummary({
        timeZone: "UTC",
        sinceDay: UsageDay.make("2026-09-09"),
        untilDay: UsageDay.make("2026-09-11"),
      });
      assert.deepStrictEqual(
        summary.buckets.map((bucket) => [bucket.provider, bucket.totals.outputTokens]).toSorted(),
        [
          ["codex", 11],
          ["hermes", 5],
        ],
      );
    }).pipe(Effect.scoped),
  );
});
