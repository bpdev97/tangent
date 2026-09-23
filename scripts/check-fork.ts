// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Git maintenance bootstrap runs without an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import {
  attributeCommits,
  featureFiles,
  type ForkManifest,
  recordProblems,
  type StackCommit,
} from "./lib/fork-inventory.ts";

const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const lines = (output: string) => output.split("\n").filter(Boolean);

const manifest = JSON.parse(NodeFS.readFileSync("downstream/fork.json", "utf8")) as ForkManifest;
const problems: string[] = [];

try {
  git("merge-base", "--is-ancestor", manifest.baseline, "HEAD");
} catch {
  problems.push(`Baseline ${manifest.baseline} is not an ancestor of HEAD.`);
}

for (const record of Object.values(manifest.features)) {
  if (!NodeFS.existsSync(record)) {
    problems.push(`Missing feature record: ${record}`);
    continue;
  }
  problems.push(...recordProblems(record, NodeFS.readFileSync(record, "utf8")));
}

// Records are separated by \x1e and fields by \x1f; each record's changed paths follow its header.
const commits: StackCommit[] = git(
  "log",
  "--reverse",
  "--no-renames",
  "--name-only",
  "--format=%x1e%H%x1f%s%x1f%(trailers:key=Fork-Feature,valueonly,separator=%x2C)",
  `${manifest.baseline}..HEAD`,
)
  .split("\x1e")
  .filter((chunk) => chunk.trim())
  .map((chunk) => {
    const [header = "", ...files] = chunk.split("\n");
    const [sha = "", subject = "", trailers = ""] = header.split("\x1f");
    return {
      sha,
      subject,
      trailers: trailers
        .split(",")
        .map((feature) => feature.trim())
        .filter(Boolean),
      files: files.filter(Boolean),
    };
  });

const { features: attribution, problems: commitProblems } = attributeCommits(
  commits,
  new Set(Object.keys(manifest.features)),
);
problems.push(...commitProblems);

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}

const baselineFiles = new Set(lines(git("ls-tree", "-r", "--name-only", manifest.baseline)));
const files = featureFiles(commits, attribution, (path) => baselineFiles.has(path));

// `--json` gives sync tooling the upstream files per feature, to compare before and after a rebase.
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(Object.fromEntries(files), null, 2));
  process.exit(0);
}

console.log(
  `${commits.length} fork commits on ${manifest.upstream.branch} at ${manifest.baseline.slice(0, 10)}.`,
);
const uncommitted = lines(git("status", "--porcelain"));
if (uncommitted.length > 0) {
  console.log(`${uncommitted.length} uncommitted paths are not attributed to a feature yet.`);
}
for (const [feature, record] of Object.entries(manifest.features)) {
  const entry = files.get(feature) ?? { upstream: [], tests: [] };
  console.log(`${feature}: ${record}; touches ${entry.upstream.length} upstream files`);
  const tests = entry.tests.filter((path) => NodeFS.existsSync(path));
  if (tests.length > 0) console.log(`  vp test run ${tests.join(" ")}`);
}
