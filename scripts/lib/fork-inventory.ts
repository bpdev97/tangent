// Pure checks behind `scripts/check-fork.ts`. Git and filesystem reads stay in the CLI so these
// rules can be tested with plain data. Feature ownership comes from the stack itself: each
// commit's `Fork-Feature` trailer, with `fixup!`-style commits belonging to the commit they fold into.

export const REQUIRED_RECORD_SECTIONS = [
  "Why",
  "Behavior",
  "Upstream hooks",
  "Resolving conflicts",
  "Never",
  "Remove when",
  "Verify",
] as const;

export interface ForkManifest {
  readonly upstream: {
    readonly repository: string;
    readonly branch: string;
    readonly pullRequest?: number;
    readonly afterMerge?: string;
  };
  readonly baseline: string;
  readonly hermes: {
    readonly version: string;
    readonly tag: string;
    readonly minimumContract: number;
  };
  /** Feature ID to its record path. */
  readonly features: Readonly<Record<string, string>>;
}

export interface StackCommit {
  readonly sha: string;
  readonly subject: string;
  /** Values of the commit's `Fork-Feature` trailers. */
  readonly trailers: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
}

/** Required `## ` sections that are missing or out of order in a feature record. */
export function recordProblems(record: string, markdown: string): string[] {
  const headings = markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
  const problems: string[] = [];
  let cursor = 0;
  for (const section of REQUIRED_RECORD_SECTIONS) {
    const index = headings.indexOf(section, cursor);
    if (index === -1) {
      problems.push(
        headings.includes(section)
          ? `${record}: section "${section}" is out of order.`
          : `${record}: missing section "${section}".`,
      );
      continue;
    }
    cursor = index + 1;
  }
  return problems;
}

const FOLDED_COMMIT = /^(?:fixup|squash|amend)! (.*)$/;

/**
 * Assigns every commit (oldest first) to features. Folded commits inherit the features of the
 * commit whose subject they name.
 */
export function attributeCommits(
  commits: ReadonlyArray<StackCommit>,
  knownFeatures: ReadonlySet<string>,
): { features: Map<string, ReadonlyArray<string>>; problems: string[] } {
  const features = new Map<string, ReadonlyArray<string>>();
  const bySubject = new Map<string, ReadonlyArray<string>>();
  const problems: string[] = [];
  for (const commit of commits) {
    const label = `${commit.sha.slice(0, 10)} "${commit.subject}"`;
    const folded = FOLDED_COMMIT.exec(commit.subject);
    let owners: ReadonlyArray<string>;
    if (folded) {
      owners = bySubject.get(folded[1]!) ?? [];
      if (owners.length === 0) problems.push(`Commit ${label} folds into no feature commit.`);
    } else {
      owners = commit.trailers;
      if (owners.length === 0) problems.push(`Commit ${label} has no Fork-Feature trailer.`);
      for (const owner of owners) {
        if (!knownFeatures.has(owner)) {
          problems.push(`Commit ${label} names unknown feature ${owner}.`);
        }
      }
      bySubject.set(commit.subject, owners);
    }
    features.set(commit.sha, owners);
  }
  return { features, problems };
}

/** Paths each feature's commits touch, split into upstream files and test files. */
export function featureFiles(
  commits: ReadonlyArray<StackCommit>,
  attribution: ReadonlyMap<string, ReadonlyArray<string>>,
  isUpstreamFile: (path: string) => boolean,
): Map<string, { upstream: string[]; tests: string[] }> {
  const result = new Map<string, { upstream: Set<string>; tests: Set<string> }>();
  for (const commit of commits) {
    for (const feature of attribution.get(commit.sha) ?? []) {
      const entry = result.get(feature) ?? { upstream: new Set(), tests: new Set() };
      for (const path of commit.files) {
        if (isUpstreamFile(path)) entry.upstream.add(path);
        if (TEST_FILE.test(path)) entry.tests.add(path);
      }
      result.set(feature, entry);
    }
  }
  return new Map(
    [...result].map(([feature, entry]) => [
      feature,
      { upstream: [...entry.upstream].toSorted(), tests: [...entry.tests].toSorted() },
    ]),
  );
}

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
