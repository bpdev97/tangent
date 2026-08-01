import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@t3tools/contracts";

export const MCP_ACTIVITY_DATA_MAX_BYTES = 32 * 1024;
const MCP_ACTIVITY_MAX_DEPTH = 8;
const MCP_ACTIVITY_MAX_COLLECTION_ENTRIES = 64;
const JSON_TRUNCATION_MARKER = "…";
const jsonTextEncoder = new TextEncoder();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function jsonByteLength(value: unknown): number | null {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? null : jsonTextEncoder.encode(encoded).byteLength;
  } catch {
    return null;
  }
}

interface JsonProjectionBudget {
  remainingBytes: number;
  readonly seen: WeakSet<object>;
}

function projectJsonString(value: string, budget: JsonProjectionBudget): string | undefined {
  const fullBytes = jsonByteLength(value);
  if (fullBytes !== null && fullBytes <= budget.remainingBytes) {
    budget.remainingBytes -= fullBytes;
    return value;
  }

  let low = 0;
  let high = value.length;
  let projected: string | undefined;
  let projectedBytes = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${value.slice(0, middle)}${JSON_TRUNCATION_MARKER}`;
    const candidateBytes = jsonByteLength(candidate) ?? Number.POSITIVE_INFINITY;
    if (candidateBytes <= budget.remainingBytes) {
      projected = candidate;
      projectedBytes = candidateBytes;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (projected === undefined) {
    return undefined;
  }
  budget.remainingBytes -= projectedBytes;
  return projected;
}

function projectJsonValue(value: unknown, budget: JsonProjectionBudget, depth: number): unknown {
  if (typeof value === "string") {
    return projectJsonString(value, budget);
  }
  if (value === null || typeof value === "boolean") {
    const bytes = jsonByteLength(value);
    if (bytes === null || bytes > budget.remainingBytes) return undefined;
    budget.remainingBytes -= bytes;
    return value;
  }
  if (typeof value === "number") {
    const normalized = Number.isFinite(value) ? value : null;
    const bytes = jsonByteLength(normalized);
    if (bytes === null || bytes > budget.remainingBytes) return undefined;
    budget.remainingBytes -= bytes;
    return normalized;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  if (depth >= MCP_ACTIVITY_MAX_DEPTH || budget.seen.has(value)) {
    return projectJsonString(JSON_TRUNCATION_MARKER, budget);
  }

  budget.seen.add(value);
  if (Array.isArray(value)) {
    if (budget.remainingBytes < 2) return undefined;
    budget.remainingBytes -= 2;
    const projected: unknown[] = [];
    for (const entry of value.slice(0, MCP_ACTIVITY_MAX_COLLECTION_ENTRIES)) {
      const separatorBytes = projected.length === 0 ? 0 : 1;
      if (budget.remainingBytes <= separatorBytes) break;
      budget.remainingBytes -= separatorBytes;
      const next = projectJsonValue(entry, budget, depth + 1);
      if (next === undefined) {
        budget.remainingBytes += separatorBytes;
        break;
      }
      projected.push(next);
    }
    budget.seen.delete(value);
    return projected;
  }

  if (budget.remainingBytes < 2) return undefined;
  budget.remainingBytes -= 2;
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MCP_ACTIVITY_MAX_COLLECTION_ENTRIES)) {
    const keyBytes = jsonByteLength(key);
    if (keyBytes === null) continue;
    const framingBytes = keyBytes + 1 + (Object.keys(projected).length === 0 ? 0 : 1);
    if (framingBytes >= budget.remainingBytes) break;
    budget.remainingBytes -= framingBytes;
    const next = projectJsonValue(entry, budget, depth + 1);
    if (next === undefined) {
      budget.remainingBytes += framingBytes;
      continue;
    }
    projected[key] = next;
  }
  budget.seen.delete(value);
  return projected;
}

function projectMcpData(data: Record<string, unknown>): Record<string, unknown> {
  const candidate: Record<string, unknown> = {};
  if ("toolCallId" in data) candidate.toolCallId = data.toolCallId;
  if ("kind" in data) candidate.kind = data.kind;
  if ("item" in data) candidate.item = data.item;

  const candidateBytes = jsonByteLength(candidate);
  if (candidateBytes !== null && candidateBytes <= MCP_ACTIVITY_DATA_MAX_BYTES) {
    return candidate;
  }

  const boundedCandidate: Record<string, unknown> = {};
  if ("toolCallId" in candidate) boundedCandidate.toolCallId = candidate.toolCallId;
  if ("kind" in candidate) boundedCandidate.kind = candidate.kind;
  boundedCandidate.truncated = true;
  if ("item" in candidate) boundedCandidate.item = candidate.item;
  const projected = projectJsonValue(
    boundedCandidate,
    {
      remainingBytes: MCP_ACTIVITY_DATA_MAX_BYTES,
      seen: new WeakSet(),
    },
    0,
  );
  return asRecord(projected) ?? { truncated: true };
}

function pushChangedFile(target: string[], seen: Set<string>, value: unknown): void {
  const normalized = asTrimmedString(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  target.push(normalized);
}

function collectChangedFiles(
  value: unknown,
  target: string[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > 4 || target.length >= 12) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangedFiles(entry, target, seen, depth + 1);
      if (target.length >= 12) {
        return;
      }
    }
    return;
  }

  const record = asRecord(value);
  if (!record) {
    return;
  }

  pushChangedFile(target, seen, record.path);
  pushChangedFile(target, seen, record.filePath);
  pushChangedFile(target, seen, record.relativePath);
  pushChangedFile(target, seen, record.filename);
  pushChangedFile(target, seen, record.newPath);
  pushChangedFile(target, seen, record.oldPath);

  for (const nestedKey of [
    "item",
    "result",
    "input",
    "data",
    "changes",
    "files",
    "edits",
    "patch",
    "patches",
    "operations",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectChangedFiles(record[nestedKey], target, seen, depth + 1);
    if (target.length >= 12) {
      return;
    }
  }
}

function projectCommandData(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const item = asRecord(data.item);
  if (!item) {
    return undefined;
  }

  const projectedItem: Record<string, unknown> = {};
  if ("command" in item) {
    projectedItem.command = item.command;
  }

  const input = asRecord(item.input);
  if (input && "command" in input) {
    projectedItem.input = { command: input.command };
  }

  const result = asRecord(item.result);
  if (result && "command" in result) {
    projectedItem.result = { command: result.command };
  }

  return Object.keys(projectedItem).length > 0 ? projectedItem : undefined;
}

function summarizeToolTextOutput(value: string): string | null {
  const lines: string[] = [];
  for (const rawLine of value.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length > 0) {
      lines.push(line);
    }
  }

  const firstLine = lines.find((line) => line !== "```");
  if (firstLine) {
    return firstLine.length <= 84 ? firstLine : `${firstLine.slice(0, 83).trimEnd()}…`;
  }
  if (lines.length > 1) {
    return `${lines.length.toLocaleString()} lines`;
  }
  return null;
}

function projectRawOutput(value: unknown): Record<string, unknown> | undefined {
  const rawOutput = asRecord(value);
  if (!rawOutput) {
    return undefined;
  }

  if (typeof rawOutput.totalFiles === "number" && Number.isFinite(rawOutput.totalFiles)) {
    return {
      totalFiles: rawOutput.totalFiles,
      ...(rawOutput.truncated === true ? { truncated: true } : {}),
    };
  }

  const content = asTrimmedString(rawOutput.content);
  if (content) {
    const summary = summarizeToolTextOutput(content);
    return summary ? { content: summary } : undefined;
  }

  const stdout = asTrimmedString(rawOutput.stdout);
  if (stdout) {
    const summary = summarizeToolTextOutput(stdout);
    return summary ? { content: summary } : undefined;
  }

  return undefined;
}

/**
 * Removes activity payload fields that no current client reads while retaining
 * the full payload in persistence and the event store.
 */
export function projectActivityPayload(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);
  if (!payload || !data) {
    return activity;
  }

  if (payload.itemType === "mcp_tool_call") {
    return {
      ...activity,
      payload: {
        ...payload,
        data: projectMcpData(data),
      },
    };
  }

  const projectedData: Record<string, unknown> = {};
  const item = projectCommandData(data);
  if (item) {
    projectedData.item = item;
  }
  if ("command" in data) {
    projectedData.command = data.command;
  }

  const changedFiles: string[] = [];
  collectChangedFiles(data, changedFiles, new Set<string>(), 0);
  if (changedFiles.length > 0) {
    // Both clients discover file names by walking objects with path-like keys.
    projectedData.files = changedFiles.map((path) => ({ path }));
  }

  if ("toolCallId" in data) {
    projectedData.toolCallId = data.toolCallId;
  }
  if ("kind" in data) {
    projectedData.kind = data.kind;
  }

  const rawOutput = projectRawOutput(data.rawOutput);
  if (rawOutput) {
    projectedData.rawOutput = rawOutput;
  }

  return {
    ...activity,
    payload: {
      ...payload,
      data: projectedData,
    },
  };
}

/**
 * Matches the validity rule in the web client's
 * `deriveLatestContextWindowSnapshot`: rows without a finite, non-negative
 * `usedTokens` are skipped during its backward walk, so they must not shadow
 * an earlier resolvable row here.
 */
function isResolvableContextWindowActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== "context-window.updated") {
    return false;
  }
  const payload = asRecord(activity.payload);
  const usedTokens = payload?.usedTokens;
  return typeof usedTokens === "number" && Number.isFinite(usedTokens) && usedTokens >= 0;
}

/**
 * Drops all but the last resolvable context-window activity per turn from a
 * snapshot. Clients only ever read the latest usage value (walking the array
 * backwards), so shipping the full history — often thousands of rows on long
 * threads — buys nothing. Retention is per turn rather than per thread because
 * a live `thread.reverted` makes the client discard whole turns; keeping each
 * turn's latest row means the meter can still resolve a value from the turns
 * that survive. Malformed rows pass through untouched rather than shadowing a
 * valid earlier row. Live `thread.activity-appended` events are untouched:
 * newer updates still stream through and supersede the retained rows on the
 * client.
 */
function dropStaleContextWindowActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<OrchestrationThreadActivity> {
  const latestIndexByTurn = new Map<string | null, number>();
  for (let index = 0; index < activities.length; index += 1) {
    if (isResolvableContextWindowActivity(activities[index]!)) {
      latestIndexByTurn.set(activities[index]!.turnId, index);
    }
  }
  if (latestIndexByTurn.size === 0) {
    return activities;
  }
  return activities.filter(
    (activity, index) =>
      !isResolvableContextWindowActivity(activity) ||
      latestIndexByTurn.get(activity.turnId) === index,
  );
}

export function projectThreadDetailSnapshot(
  snapshot: OrchestrationThreadDetailSnapshot,
): OrchestrationThreadDetailSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      activities: dropStaleContextWindowActivities(snapshot.thread.activities).map(
        projectActivityPayload,
      ),
    },
  };
}

export function projectActivityEvent(event: OrchestrationEvent): OrchestrationEvent {
  if (event.type !== "thread.activity-appended") {
    return event;
  }
  return {
    ...event,
    payload: {
      ...event.payload,
      activity: projectActivityPayload(event.payload.activity),
    },
  };
}
