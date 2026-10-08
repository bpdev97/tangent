// Tangent(FORK-HERMES-001): usage from Hermes's own profile databases.
// node:sqlite reads live Hermes databases; Node fs finds the profiles.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { hermesProfileHome } from "../provider/hermes/HermesT3Tools.ts";
import { totalTokens, type UsageRecord } from "./usageTranscripts.ts";

const USAGE_TABLE = "session_model_usage";
const DATABASE_NAME = "state.db";

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
  return {
    provider: "hermes",
    // Hermes stores epoch seconds.
    timestampMs: Math.trunc(lastSeen * 1_000),
    model,
    // Names with a vendor prefix are OpenRouter ids, which the rate table files under `openrouter/`.
    ...(model.includes("/") ? { rateModel: `openrouter/${model}` } : {}),
    sessionId: text(row.session_id),
    totals,
    // What the provider billed when Hermes knows it, else Hermes's own estimate. A
    // subscription call records neither, and the shared price table estimates it.
    reportedCostUsd: cost(row.actual_cost_usd) ?? cost(row.estimated_cost_usd),
    speed: "standard",
    // Rows are unique within a database, and no two profiles share one.
    dedupeKey: null,
  };
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

export interface HermesUsageReadResult {
  readonly files: readonly { readonly path: string; readonly records: readonly UsageRecord[] }[];
  readonly missing: boolean;
  readonly error: boolean;
}

/**
 * Reads every profile under a Hermes root (`state.db` and
 * `profiles/<name>/state.db`) without modifying any of them. This includes
 * Hermes sessions started outside T3 Code.
 */
export async function readHermesUsage(
  root: string,
  sinceMs: number,
): Promise<HermesUsageReadResult> {
  const files: { path: string; records: UsageRecord[] }[] = [];
  let error = false;

  const databases = [NodePath.join(root, DATABASE_NAME)];
  try {
    // Do not follow symlinks: a profile is a real directory under the root.
    for (const entry of await NodeFSP.readdir(NodePath.join(root, "profiles"), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        databases.push(NodePath.join(root, "profiles", entry.name, DATABASE_NAME));
      }
    }
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") error = true;
  }

  for (const path of databases.toSorted()) {
    try {
      await NodeFSP.access(path);
    } catch (cause) {
      if (errorCode(cause) !== "ENOENT") error = true;
      continue;
    }
    const file = { path, records: [] as UsageRecord[] };
    files.push(file);
    let database: NodeSqlite.DatabaseSync | undefined;
    try {
      database = new NodeSqlite.DatabaseSync(path, { readOnly: true });
      // A busy live Hermes should fail this source promptly rather than
      // stalling the server while SQLite waits for its writer.
      database.exec("PRAGMA busy_timeout = 100");
      const hasUsage = database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(USAGE_TABLE);
      // A database from before Hermes recorded per-model usage has nothing to report.
      if (hasUsage === undefined) continue;
      const statement = database.prepare(
        `SELECT session_id, model, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, reasoning_tokens, estimated_cost_usd, actual_cost_usd, last_seen
           FROM ${USAGE_TABLE}
          WHERE last_seen >= ?`,
      );
      for (const row of statement.iterate(sinceMs / 1_000)) {
        const record = parseHermesUsageRow(row);
        if (record !== null && record.timestampMs >= sinceMs) file.records.push(record);
      }
    } catch {
      error = true;
    } finally {
      database?.close();
    }
  }
  return { files, missing: files.length === 0 && !error, error };
}
