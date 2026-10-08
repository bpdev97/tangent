// Tangent(FORK-HERMES-001): usage from Hermes's own profile databases.
// node:sqlite reads live Hermes databases; Node fs finds the profiles.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTimersPromises from "node:timers/promises";

import { ProviderInstanceId, type ServerSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { hermesProfileHome } from "../provider/hermes/HermesT3Tools.ts";
import { totalTokens, type UsageRecord } from "./usageTranscripts.ts";

const USAGE_TABLE = "session_model_usage";
const DATABASE_NAME = "state.db";
/** `sessions.model_config` key Hermes sets on a session bound to a Codex app-server thread. */
const CODEX_THREAD_KEY = "codex_thread_id";
/**
 * The providers Hermes can hand to that runtime (`openai_runtime: codex_app_server`).
 * Hermes records both `provider: openai` and a named provider Codex also knows as `custom`.
 */
const CODEX_RUNTIME_PROVIDERS: ReadonlySet<string> = new Set(["openai", "openai-codex", "custom"]);

function tokens(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function errorCode(cause: unknown): unknown {
  return typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : null;
}

/**
 * The rate table's name for a model Hermes names with a vendor prefix. Only a
 * call billed through OpenRouter is priced at OpenRouter's rate; the same
 * name billed elsewhere is the vendor's own model.
 */
function rateModel(model: string, billingProvider: string): string | undefined {
  const slash = model.lastIndexOf("/");
  if (slash === -1) return undefined;
  return billingProvider === "openrouter" ? `openrouter/${model}` : model.slice(slash + 1);
}

/**
 * One row of Hermes's per-session, per-model totals.
 *
 * Hermes keeps running totals, not one row per request, so a row is dated by
 * its last activity and counts in full on that day. Its input excludes cached
 * tokens and its output already includes reasoning.
 */
function parseHermesUsageRow(row: Record<string, unknown>): UsageRecord | null {
  const model = text(row.model).trim();
  const lastSeen = row.last_seen;
  if (!model || model === "unknown" || typeof lastSeen !== "number" || !Number.isFinite(lastSeen)) {
    return null;
  }
  const outputTokens = tokens(row.output_tokens);
  const totals = {
    uncachedInputTokens: tokens(row.input_tokens),
    cachedInputTokens: tokens(row.cache_read_tokens),
    cacheCreationTokens: tokens(row.cache_write_tokens),
    outputTokens,
    reasoningTokens: Math.min(tokens(row.reasoning_tokens), outputTokens),
  };
  if (totalTokens(totals) === 0) return null;
  const priced = rateModel(model, text(row.billing_provider));
  return {
    provider: "hermes",
    // Hermes stores epoch seconds.
    timestampMs: Math.trunc(lastSeen * 1_000),
    model,
    ...(priced === undefined ? {} : { rateModel: priced }),
    sessionId: text(row.session_id),
    totals,
    // What the provider billed when Hermes knows it, else Hermes's own estimate. A
    // subscription call records neither, and the shared price table estimates it.
    reportedCostUsd: cost(row.actual_cost_usd) ?? cost(row.estimated_cost_usd),
    speed: "standard",
    // Rows are unique within a database, and each database is read once.
    dedupeKey: null,
  };
}

/**
 * Sessions bound to a Codex app-server thread. Codex wrote their turns to its
 * own history, and those turns are Codex usage wherever that history is read.
 *
 * This must not depend on what else this server scanned: two servers that
 * read one profile have to report the same usage for it, or merging them
 * counts a turn under both providers.
 */
function codexRuntimeSessions(database: NodeSqlite.DatabaseSync): ReadonlySet<string> {
  const sessions = new Set<string>();
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .map((column) => column.name),
  );
  if (!columns.has("id") || !columns.has("model_config")) return sessions;
  const statement = database.prepare(
    `SELECT id, model_config FROM sessions WHERE model_config LIKE '%${CODEX_THREAD_KEY}%'`,
  );
  for (const row of statement.iterate()) {
    try {
      const config: unknown = JSON.parse(text(row.model_config));
      if (
        typeof config === "object" &&
        config !== null &&
        text((config as Record<string, unknown>)[CODEX_THREAD_KEY]) !== ""
      ) {
        sessions.add(text(row.id));
      }
    } catch {
      // Not the JSON Hermes writes; the session keeps its usage.
    }
  }
  return sessions;
}

/** One profile's usage. A database that could not be read in full reports nothing. */
export interface HermesProfileUsage {
  /** The directory that holds the profile's database, which identifies it as a usage source. */
  readonly home: string;
  readonly path: string;
  readonly records: readonly UsageRecord[];
  /** "missing" is a Hermes root with no database at all. */
  readonly status: "ok" | "failed" | "missing";
}

async function readDatabase(path: string, sinceMs: number): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  const database = new NodeSqlite.DatabaseSync(path, { readOnly: true });
  try {
    // A busy live Hermes should fail this source promptly rather than
    // stalling the server while SQLite waits for its writer.
    database.exec("PRAGMA busy_timeout = 100");
    const hasUsage = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(USAGE_TABLE);
    // A database from before Hermes recorded per-model usage has nothing to report.
    if (hasUsage === undefined) return records;
    const onCodex = codexRuntimeSessions(database);
    const statement = database.prepare(
      `SELECT session_id, model, billing_provider, task, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, reasoning_tokens, estimated_cost_usd,
              actual_cost_usd, last_seen
         FROM ${USAGE_TABLE}
        WHERE last_seen >= ?`,
    );
    let count = 0;
    for (const row of statement.iterate(sinceMs / 1_000)) {
      // A session keeps its thread when it switches to a provider Hermes calls
      // itself, and Hermes's own background calls carry a task: neither went
      // through Codex. One provider used both ways in a session has a single
      // total, which is left to Codex.
      const viaCodex =
        text(row.task) === "" &&
        CODEX_RUNTIME_PROVIDERS.has(text(row.billing_provider)) &&
        onCodex.has(text(row.session_id));
      const record = viaCodex ? null : parseHermesUsageRow(row);
      if (record !== null && record.timestampMs >= sinceMs) records.push(record);
      // The driver is synchronous; let the server answer other work during a long history.
      if (++count % 256 === 0) await NodeTimersPromises.setImmediate();
    }
    return records;
  } finally {
    database.close();
  }
}

/**
 * Reads every profile under each Hermes root (`state.db` and
 * `profiles/<name>/state.db`) without modifying any of them. This includes
 * Hermes sessions started outside T3 Code.
 *
 * Each profile is its own source, read in full or not at all. Hermes rewrites a
 * row as its session goes on, so half a history mixed with an older complete
 * copy from another server on this machine would count the same usage twice.
 */
export async function readHermesUsage(
  roots: ReadonlyArray<string>,
  sinceMs: number,
): Promise<ReadonlyArray<HermesProfileUsage>> {
  const usage: HermesProfileUsage[] = [];
  const unreadable = (home: string) =>
    usage.push({ home, path: home, records: [], status: "failed" });
  // A database reached twice, through a link or a second root, is one history.
  const read = new Set<string>();
  for (const root of roots) {
    const homes = [root];
    const profiles = NodePath.join(root, "profiles");
    let found = false;
    try {
      // Do not follow symlinks: a profile is a real directory under the root.
      for (const entry of await NodeFSP.readdir(profiles, { withFileTypes: true })) {
        if (entry.isDirectory()) homes.push(NodePath.join(profiles, entry.name));
      }
    } catch (cause) {
      if (errorCode(cause) !== "ENOENT") {
        unreadable(profiles);
        found = true;
      }
    }

    for (const home of homes.toSorted()) {
      let path: string;
      try {
        path = await NodeFSP.realpath(NodePath.join(home, DATABASE_NAME));
      } catch (cause) {
        if (errorCode(cause) !== "ENOENT") {
          unreadable(home);
          found = true;
        }
        continue;
      }
      found = true;
      if (read.has(path)) continue;
      read.add(path);
      // Where the database really is names the source, so every server that reaches it agrees.
      const source = NodePath.dirname(path);
      try {
        const records = await readDatabase(path, sinceMs);
        usage.push({ home: source, path, records, status: "ok" });
      } catch {
        usage.push({ home: source, path, records: [], status: "failed" });
      }
    }
    if (!found) usage.push({ home: root, path: root, records: [], status: "missing" });
  }
  return usage;
}

/**
 * The Hermes root each environment resolves to, once each: the host's, and
 * that of any Hermes instance that sets its own `HERMES_HOME`.
 */
export const hermesUsageRoots = Effect.fn("hermesUsageRoots")(function* (
  environments: ReadonlyArray<NodeJS.ProcessEnv>,
) {
  const fs = yield* FileSystem.FileSystem;
  const roots = new Set<string>();
  for (const environment of environments) {
    const root = yield* hermesProfileHome(environment, "default");
    if (root === undefined) continue;
    roots.add(yield* fs.realPath(root).pipe(Effect.orElseSucceed(() => root)));
  }
  return [...roots];
});

/**
 * Every Hermes profile those environments can reach, as the usage service's
 * scanned sources. A profile is "ok" or "failed", never partial (see
 * `readHermesUsage`), and a root with no database is one missing source.
 */
export const scanHermesUsage = Effect.fn("scanHermesUsage")(function* (
  environments: ReadonlyArray<NodeJS.ProcessEnv>,
  sinceMs: number,
) {
  const roots = yield* hermesUsageRoots(environments);
  const profiles = yield* Effect.promise(() => readHermesUsage(roots, sinceMs));
  return profiles.map((profile) => ({
    provider: "hermes" as const,
    dir: profile.home,
    files:
      profile.status === "missing"
        ? null
        : profile.status === "failed"
          ? []
          : [{ path: profile.path, records: profile.records }],
    status: profile.status === "failed" ? ("failed" as const) : ("ok" as const),
    ...(profile.status === "failed"
      ? { message: "This Hermes profile's history could not be read." }
      : {}),
  }));
});

/**
 * Hermes instances as the Codex accounts their Codex runtime writes to: the
 * `CODEX_HOME` of the instance's environment, else the default Codex home.
 * Reading those homes as Codex history is what counts the turns
 * `codexRuntimeSessions` leaves out.
 */
export function hermesCodexInstances(instances: ServerSettings["providerInstances"]) {
  return Object.entries(instances)
    .filter(([, instance]) => instance.driver === "hermes")
    .map(([id, instance]) => ({
      config: {},
      ...(instance.environment === undefined ? {} : { environment: instance.environment }),
      instanceId: ProviderInstanceId.make(id),
    }));
}
