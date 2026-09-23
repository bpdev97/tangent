// Pure rules behind `scripts/tangent-sync.ts`. Git, GitHub, and process calls stay in the CLI so
// the publish decision can be tested with plain data.

/** Upstream files each feature touches, as printed by `check-fork --json`. */
export type Footprint = Readonly<
  Record<
    string,
    { readonly upstream: ReadonlyArray<string>; readonly tests?: ReadonlyArray<string> }
  >
>;

export interface SyncSnapshot {
  readonly footprint: Footprint;
  /** `ORCHESTRATION_PROTOCOL_VERSION` from the upstream base. */
  readonly protocolVersion: number | null;
  readonly hermesMinimumContract: number;
  readonly features: ReadonlyArray<string>;
}

export interface PublishDecisionInput {
  readonly before: SyncSnapshot;
  readonly after: SyncSnapshot;
}

const PROTOCOL_VERSION = /export const ORCHESTRATION_PROTOCOL_VERSION = (\d+);/;

export function parseProtocolVersion(source: string): number | null {
  const match = PROTOCOL_VERSION.exec(source);
  return match ? Number(match[1]) : null;
}

/** Features whose set of touched upstream files gained a file. */
export function footprintGrowth(before: Footprint, after: Footprint): string[] {
  return Object.entries(after)
    .filter(([feature, entry]) => {
      const previous = new Set(before[feature]?.upstream ?? []);
      return entry.upstream.some((path) => !previous.has(path));
    })
    .map(([feature]) => feature)
    .toSorted();
}

/**
 * Reasons to hold a release, per the `tangent-sync` skill. An empty list means the checks
 * alone decide.
 */
export function publishBlockers(input: PublishDecisionInput): string[] {
  const { before, after } = input;
  const reasons: string[] = [];
  const grown = footprintGrowth(before.footprint, after.footprint);
  if (grown.length > 0) {
    reasons.push(`Upstream footprint grew for ${grown.join(", ")}.`);
  }
  if (before.protocolVersion !== after.protocolVersion) {
    reasons.push(
      `ORCHESTRATION_PROTOCOL_VERSION changed from ${before.protocolVersion} to ` +
        `${after.protocolVersion}; clients and servers must update together.`,
    );
  }
  if (before.hermesMinimumContract !== after.hermesMinimumContract) {
    reasons.push(
      `The Hermes minimum contract changed from ${before.hermesMinimumContract} to ` +
        `${after.hermesMinimumContract}; every Hermes host must update.`,
    );
  }
  const removed = before.features.filter((feature) => !after.features.includes(feature));
  if (removed.length > 0) {
    reasons.push(`Removed features need review: ${removed.join(", ")}.`);
  }
  return reasons;
}

const STABLE_TAG = /^personal-v(\d+)\.(\d+)\.(\d+)$/;

/** The next patch version after every existing stable `personal-v` tag. */
export function nextPatchVersion(tags: ReadonlyArray<string>): string {
  let newest: [bigint, bigint, bigint] | null = null;
  for (const tag of tags) {
    const match = STABLE_TAG.exec(tag.trim());
    if (!match) continue;
    const version: [bigint, bigint, bigint] = [
      BigInt(match[1]!),
      BigInt(match[2]!),
      BigInt(match[3]!),
    ];
    if (newest === null || compareVersions(version, newest) > 0) newest = version;
  }
  if (newest === null) return "0.1.0";
  return `${newest[0]}.${newest[1]}.${newest[2] + 1n}`;
}

function compareVersions(a: readonly bigint[], b: readonly bigint[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  }
  return 0;
}

export interface ReleaseNoteEntries {
  readonly features: ReadonlyArray<string>;
  readonly fixes: ReadonlyArray<string>;
  readonly performance: ReadonlyArray<string>;
}

const CONVENTIONAL = /^(feat|fix|perf)(\([^)]*\))?!?:\s*(.+)$/;

/**
 * User-facing upstream changes since the last release. Upstream force-pushes, so commits already
 * released can reappear with new hashes; they are matched by subject and left out.
 */
export function releaseNoteEntries(
  newSubjects: ReadonlyArray<string>,
  releasedSubjects: ReadonlyArray<string>,
): ReleaseNoteEntries {
  const released = new Set(releasedSubjects.map((subject) => subject.trim()));
  const seen = new Set<string>();
  const features: string[] = [];
  const fixes: string[] = [];
  const performance: string[] = [];
  for (const raw of newSubjects) {
    const subject = raw.trim();
    if (released.has(subject) || seen.has(subject)) continue;
    seen.add(subject);
    const match = CONVENTIONAL.exec(subject);
    if (!match) continue;
    const scope = match[2] ? `${match[2].slice(1, -1)}: ` : "";
    const entry = `${scope}${match[3]}`;
    if (match[1] === "feat") features.push(entry);
    else if (match[1] === "fix") fixes.push(entry);
    else performance.push(entry);
  }
  return { features, fixes, performance };
}

export interface CheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

const PASSING_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);

/**
 * Whether an upstream commit is safe to rebase onto: every required check ran and passed. Other
 * checks (lint ratchets, bots) are advisory, because Tangent CI runs its own check on the result.
 * A commit without the required runs is unknown, not green.
 */
export function checkRunsState(
  runs: ReadonlyArray<CheckRun>,
  required: ReadonlyArray<string>,
): "green" | "red" | "pending" | "unknown" {
  const relevant = runs.filter((run) => required.includes(run.name));
  if (
    relevant.some(
      (run) => run.status === "completed" && !PASSING_CONCLUSIONS.has(run.conclusion ?? ""),
    )
  ) {
    return "red";
  }
  if (relevant.some((run) => run.status !== "completed")) return "pending";
  const passed = new Set(relevant.map((run) => run.name));
  return required.every((name) => passed.has(name)) ? "green" : "unknown";
}
