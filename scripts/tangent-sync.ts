// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off globalFetch:off - Sync bootstrap runs git, gh, and a server smoke check without an Effect runtime.
/**
 * The mechanical half of the `tangent-sync` skill (`.agents/skills/tangent-sync/SKILL.md`).
 * Each subcommand is safe to repeat. Working state lives in `<git common dir>/tangent-sync/`, so it
 * never appears in the working tree and survives across worktrees.
 *
 *   status    fetch and report whether there is anything to do
 *   rebase    move the stack onto the latest upstream; stops with a report on conflict
 *   continue  resume after conflicts were resolved and staged
 *   gates     local cheap checks, then Tangent CI on GitHub for the rebased commit
 *   startup   only the startup check: upgrade from the previous release in a temp home
 *   decide    apply the publish rules; exit 3 means hold
 *   notes     draft release notes for the agent to finish before publishing
 *   publish   push and start the release workflows, skipping anything already done
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  CLI_RELEASE_CHECKSUMS_FILE,
  cliArchiveFileName,
  cliArchivePlatformKey,
  parseChecksums,
} from "@t3tools/shared/cliRelease";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

import { PERSONAL_DISTRIBUTION } from "../downstream/config.ts";
import {
  checkRunsState,
  type Footprint,
  nextPatchVersion,
  parseProtocolVersion,
  publishBlockers,
  releaseNoteEntries,
  type SyncSnapshot,
} from "./lib/tangent-sync.ts";

interface Manifest {
  upstream: {
    repository: string;
    branch: string;
    pullRequest?: number;
    afterMerge?: string;
    requiredChecks: string[];
  };
  baseline: string;
  hermes: { version: string; tag: string; minimumContract: number };
  features: Record<string, string>;
}

interface SyncState {
  branch: string;
  originBefore: string | null;
  baselineBefore: string;
  newBase: string;
  targetBranch: string;
  before: SyncSnapshot;
  gates?: { head: string };
  notesHead?: string;
}

const EXIT_CONFLICT = 2;
const EXIT_HOLD = 3;
const MANIFEST_PATH = "downstream/fork.json";
const PROTOCOL_PATH = "packages/contracts/src/environment.ts";
const RELEASE_REPOSITORY = `${PERSONAL_DISTRIBUTION.repository.owner}/${PERSONAL_DISTRIBUTION.repository.name}`;
const MACOS_WORKFLOW = "personal-macos-release.yml";
const IOS_WORKFLOW = "personal-ios-release.yml";
const CI_WORKFLOW = "personal-ci.yml";
const CANDIDATE_BRANCH = "tangent-sync/candidate";
/** How far back to look for a green upstream commit. */
const UPSTREAM_SEARCH_DEPTH = 30;

class SyncStop extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function run(command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv): string {
  return NodeChildProcess.execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...(env ? { env: { ...process.env, ...env } } : {}),
  }).trim();
}

function attempt(command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

/** Streams output so long checks stay visible. */
function step(label: string, command: string, args: ReadonlyArray<string>) {
  console.log(`\n▶ ${label}`);
  const result = NodeChildProcess.spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new SyncStop(`Gate failed: ${label}.`);
}

const git = (...args: string[]) => run("git", args);
const gh = (...args: string[]) => run("gh", args);

const repoRoot = git("rev-parse", "--show-toplevel");
process.chdir(repoRoot);
const stateDir = NodePath.join(
  NodePath.resolve(git("rev-parse", "--git-common-dir")),
  "tangent-sync",
);
NodeFS.mkdirSync(stateDir, { recursive: true });
const statePath = NodePath.join(stateDir, "state.json");
const reportPath = NodePath.join(stateDir, "conflict-report.md");
const notesPath = NodePath.join(stateDir, "release-notes.md");
const MAX_NOTES_LENGTH = 30_000;
const vp = NodeFS.existsSync("node_modules/.bin/vp")
  ? NodePath.resolve("node_modules/.bin/vp")
  : "vp";

const readManifest = (): Manifest => JSON.parse(NodeFS.readFileSync(MANIFEST_PATH, "utf8"));
const readState = (): SyncState => {
  if (!NodeFS.existsSync(statePath)) throw new SyncStop("No sync in progress; run `rebase` first.");
  return JSON.parse(NodeFS.readFileSync(statePath, "utf8"));
};
const writeState = (state: SyncState) =>
  NodeFS.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

const rebaseInProgress = () =>
  ["rebase-merge", "rebase-apply"].some((name) =>
    NodeFS.existsSync(NodePath.join(git("rev-parse", "--git-dir"), name)),
  );

function currentBranch(): string {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch === "HEAD") throw new SyncStop("Check out the stack branch first.");
  return branch;
}

function requireCleanTree() {
  if (git("status", "--porcelain") !== "") throw new SyncStop("The working tree is not clean.");
}

/** Follows `afterMerge` once the tracked upstream pull request has merged. */
function targetUpstreamBranch(manifest: Manifest): string {
  const { pullRequest, afterMerge, repository, branch } = manifest.upstream;
  if (pullRequest === undefined || afterMerge === undefined) return branch;
  const state = attempt("gh", [
    "pr",
    "view",
    String(pullRequest),
    "-R",
    repository,
    "--json",
    "state",
    "--jq",
    ".state",
  ]);
  return state.ok && state.stdout === "MERGED" ? afterMerge : branch;
}

function fetchUpstream(branch: string): string {
  git("fetch", "--quiet", "upstream", `+refs/heads/${branch}:refs/remotes/upstream/${branch}`);
  return git("rev-parse", `refs/remotes/upstream/${branch}`);
}

/**
 * The newest upstream commit whose GitHub checks are green. Upstream pushes to its integration
 * branch often, and its head can be red or still running; syncing onto it would waste the run.
 */
function greenUpstreamCommit(
  manifest: Manifest,
  head: string,
): { sha: string | null; headState: string } {
  let headState = "unknown";
  const commits = git(
    "rev-list",
    "--first-parent",
    "-n",
    String(UPSTREAM_SEARCH_DEPTH),
    head,
  ).split("\n");
  for (const sha of commits) {
    const runs = attempt("gh", [
      "api",
      `repos/${manifest.upstream.repository}/commits/${sha}/check-runs?per_page=100`,
      "--jq",
      "[.check_runs[] | {name, status, conclusion}]",
    ]);
    if (!runs.ok) throw new SyncStop(`Could not read upstream checks: ${runs.stderr}`);
    const state = checkRunsState(JSON.parse(runs.stdout), manifest.upstream.requiredChecks);
    if (sha === head) headState = state;
    if (state === "green") return { sha, headState };
  }
  return { sha: null, headState };
}

function footprint(): Footprint {
  return JSON.parse(run(process.execPath, ["scripts/check-fork.ts", "--json"]));
}

function snapshot(manifest: Manifest, upstreamRev: string): SyncSnapshot {
  const protocol = attempt("git", ["show", `${upstreamRev}:${PROTOCOL_PATH}`]);
  return {
    footprint: footprint(),
    protocolVersion: protocol.ok ? parseProtocolVersion(protocol.stdout) : null,
    hermesMinimumContract: manifest.hermes.minimumContract,
    features: Object.keys(manifest.features),
  };
}

/** A commit counts as released once tagged or once a release run for it is live or succeeded. */
function released(sha: string, workflow: string): boolean {
  if (
    workflow === MACOS_WORKFLOW &&
    git("tag", "--points-at", sha, "--list", "personal-v*") !== ""
  ) {
    return true;
  }
  const runs = attempt("gh", [
    "run",
    "list",
    "-R",
    RELEASE_REPOSITORY,
    "--workflow",
    workflow,
    "--limit",
    "30",
    "--json",
    "headSha,status,conclusion",
  ]);
  if (!runs.ok) throw new SyncStop(`Could not list ${workflow} runs: ${runs.stderr}`);
  return (
    JSON.parse(runs.stdout) as Array<{ headSha: string; status: string; conclusion: string }>
  ).some(
    (entry) =>
      entry.headSha === sha && (entry.status !== "completed" || entry.conclusion === "success"),
  );
}

function status() {
  const manifest = readManifest();
  const target = targetUpstreamBranch(manifest);
  const upstreamHead = fetchUpstream(target);
  const green = greenUpstreamCommit(manifest, upstreamHead);
  git("fetch", "--quiet", "--tags", "origin");
  const hermes = attempt("gh", [
    "api",
    "repos/NousResearch/hermes-agent/releases/latest",
    "--jq",
    ".tag_name",
  ]);
  const head = git("rev-parse", "HEAD");
  const lastRelease = attempt("gh", [
    "run",
    "list",
    "-R",
    RELEASE_REPOSITORY,
    "--workflow",
    MACOS_WORKFLOW,
    "--limit",
    "1",
    "--json",
    "headSha,status,conclusion,url",
  ]);
  const report = {
    upstreamBranch: target,
    upstreamBranchChanged: target !== manifest.upstream.branch,
    upstreamHead,
    upstreamHeadChecks: green.headState,
    upstreamGreen: green.sha,
    baseline: manifest.baseline,
    upstreamMoved: green.sha !== null && green.sha !== manifest.baseline,
    hermesLatest: hermes.ok ? hermes.stdout : null,
    hermesBaseline: manifest.hermes.tag,
    hermesMoved: hermes.ok && hermes.stdout !== manifest.hermes.tag,
    head,
    headReleased: released(head, MACOS_WORKFLOW),
    lastRelease: lastRelease.ok ? (JSON.parse(lastRelease.stdout)[0] ?? null) : null,
  };
  const work = report.upstreamMoved || report.hermesMoved || !report.headReleased;
  console.log(JSON.stringify({ action: work ? "sync" : "nothing-to-do", ...report }, null, 2));
}

function rebase() {
  if (rebaseInProgress()) throw new SyncStop("A rebase is already in progress; use `continue`.");
  requireCleanTree();
  const branch = currentBranch();
  const manifest = readManifest();
  const target = targetUpstreamBranch(manifest);
  const green = greenUpstreamCommit(manifest, fetchUpstream(target));
  if (green.sha === null) {
    console.log(
      `No green commit in the last ${UPSTREAM_SEARCH_DEPTH} of ${target}; waiting for upstream.`,
    );
    return;
  }
  const newBase = green.sha;
  git("fetch", "--quiet", "origin");
  const origin = attempt("git", ["rev-parse", `refs/remotes/origin/${branch}`]);
  git("config", "rerere.enabled", "true");
  git("config", "rerere.autoupdate", "true");
  const state: SyncState = {
    branch,
    originBefore: origin.ok ? origin.stdout : null,
    baselineBefore: manifest.baseline,
    newBase,
    targetBranch: target,
    before: snapshot(manifest, manifest.baseline),
  };
  writeState(state);
  if (newBase === manifest.baseline && target === manifest.upstream.branch) {
    console.log(`Already on ${target} at ${newBase.slice(0, 10)}; nothing to rebase.`);
    return;
  }
  const result = attempt(
    "git",
    ["rebase", "-i", "--autosquash", "--onto", newBase, manifest.baseline, branch],
    { GIT_SEQUENCE_EDITOR: ":" },
  );
  if (!result.ok) return stopForConflict(state);
  finishRebase(state);
}

function resume() {
  const state = readState();
  if (!rebaseInProgress()) return finishRebase(state);
  if (git("diff", "--name-only", "--diff-filter=U") !== "") {
    throw new SyncStop("Conflicts remain; resolve and `git add` them first.", EXIT_CONFLICT);
  }
  const result = attempt("git", ["rebase", "--continue"], { GIT_EDITOR: "true" });
  if (!result.ok) return stopForConflict(state);
  finishRebase(state);
}

function stopForConflict(state: SyncState): never {
  const manifest = readManifest();
  const stopped = attempt("git", [
    "log",
    "-1",
    "--format=%H%x1f%s%x1f%(trailers:key=Fork-Feature,valueonly,separator=%x2C)",
    "REBASE_HEAD",
  ]);
  const [sha = "", subject = "", features = ""] = stopped.stdout.split("\x1f");
  const conflicted = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
  const records = features
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean)
    .map((feature) => `- ${feature}: ${manifest.features[feature] ?? "unknown feature"}`);
  // Upstream force-pushes, so the old baseline may not be an ancestor of the new one.
  const since = attempt("git", ["merge-base", state.baselineBefore, state.newBase]);
  const upstreamChanges = conflicted.length
    ? attempt("git", [
        "log",
        "--oneline",
        "-n",
        "20",
        `${since.ok ? since.stdout : state.baselineBefore}..${state.newBase}`,
        "--",
        ...conflicted,
      ]).stdout
    : "";
  NodeFS.writeFileSync(
    reportPath,
    [
      "# Tangent sync conflict",
      "",
      `Replaying \`${sha.slice(0, 10)}\` ${subject}`,
      "",
      "Owning records:",
      ...(records.length ? records : ["- none (the commit has no Fork-Feature trailer)"]),
      "",
      "Conflicted files:",
      ...conflicted.map((path) => `- ${path}`),
      "",
      "Upstream commits touching them:",
      "```",
      upstreamChanges || "(none found; upstream may have been rebased, see git range-diff)",
      "```",
      "",
      `Range diff: \`git range-diff ${state.baselineBefore.slice(0, 10)}...${state.newBase.slice(0, 10)}\``,
      "",
    ].join("\n"),
  );
  throw new SyncStop(`Conflict while replaying ${subject}. Report: ${reportPath}`, EXIT_CONFLICT);
}

/** Records the new baseline as a fixup of the maintenance commit and folds it in. */
function finishRebase(state: SyncState) {
  const manifest = readManifest();
  if (manifest.baseline !== state.newBase || manifest.upstream.branch !== state.targetBranch) {
    manifest.baseline = state.newBase;
    manifest.upstream.branch = state.targetBranch;
    NodeFS.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    const maintenance = git(
      "log",
      "--reverse",
      "--format=%s%x1f%(trailers:key=Fork-Feature,valueonly)",
      `${state.newBase}..HEAD`,
    )
      .split("\n")
      .map((line) => line.split("\x1f"))
      .find(
        ([subject, trailer]) =>
          trailer?.trim() === "FORK-MAINT-001" && !subject!.startsWith("fixup!"),
      );
    if (!maintenance) throw new SyncStop("No FORK-MAINT-001 commit found in the stack.");
    git("add", MANIFEST_PATH);
    git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", `fixup! ${maintenance[0]}`);
    const squash = attempt("git", ["rebase", "-i", "--autosquash", state.newBase], {
      GIT_SEQUENCE_EDITOR: ":",
    });
    if (!squash.ok) throw new SyncStop(`Could not fold the baseline update: ${squash.stderr}`);
  }
  const { gates: _gates, ...rest } = state;
  writeState(rest);
  console.log(`Stack is on ${state.targetBranch} at ${state.newBase.slice(0, 10)}.`);
}

async function gates() {
  const state = readState();
  if (rebaseInProgress()) throw new SyncStop("Finish the rebase first.");
  requireCleanTree();
  step("install dependencies", vp, ["install"]);
  const drift = git("status", "--porcelain");
  if (drift !== "") {
    throw new SyncStop(
      drift.split("\n").every((line) => line.endsWith("pnpm-lock.yaml"))
        ? "Installing refreshed pnpm-lock.yaml, usually a fork package picking up an upstream " +
            "version bump. Commit it as a fixup of the feature that owns the changed importer, " +
            "fold it in, and run `gates` again."
        : `Installing changed tracked files:\n${drift}`,
    );
  }
  step("check-fork", process.execPath, ["scripts/check-fork.ts"]);
  await startupCheck();
  const head = git("rev-parse", "HEAD");
  continuousIntegration(head);
  writeState({ ...state, gates: { head } });
  console.log("\nAll gates passed.");
}

/**
 * Runs Tangent CI on GitHub for this exact commit instead of on this machine: the full check,
 * typecheck, test suite on Linux, and mobile lint on macOS. The candidate branch exists only so
 * the workflow can be dispatched on the commit before it reaches `main`.
 */
function continuousIntegration(head: string) {
  console.log(`\n▶ Tangent CI on GitHub for ${head.slice(0, 10)}`);
  git("push", "--quiet", "--force", "origin", `${head}:refs/heads/${CANDIDATE_BRANCH}`);
  const findRun = () => {
    const runs = JSON.parse(
      gh(
        "run",
        "list",
        "-R",
        RELEASE_REPOSITORY,
        "--workflow",
        CI_WORKFLOW,
        "--branch",
        CANDIDATE_BRANCH,
        "--limit",
        "20",
        "--json",
        "databaseId,headSha,status,conclusion",
      ),
    ) as Array<{ databaseId: number; headSha: string; status: string; conclusion: string }>;
    return runs.find((run) => run.headSha === head);
  };
  let run = findRun();
  if (run?.conclusion === "success") {
    console.log("CI already passed for this commit.");
    return;
  }
  if (run === undefined || (run.status === "completed" && run.conclusion !== "success")) {
    gh("workflow", "run", CI_WORKFLOW, "-R", RELEASE_REPOSITORY, "--ref", CANDIDATE_BRANCH);
    const deadline = Date.now() + 120_000;
    do {
      run = findRun();
      if (run !== undefined && run.status !== "completed") break;
      NodeChildProcess.execFileSync("sleep", ["5"]);
    } while (Date.now() < deadline);
    if (run === undefined) throw new SyncStop("Tangent CI did not start.");
  }
  const watch = NodeChildProcess.spawnSync(
    "gh",
    [
      "run",
      "watch",
      String(run.databaseId),
      "-R",
      RELEASE_REPOSITORY,
      "--exit-status",
      "--interval",
      "30",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const url = `https://github.com/${RELEASE_REPOSITORY}/actions/runs/${run.databaseId}`;
  if (watch.status !== 0) throw new SyncStop(`Gate failed: Tangent CI. ${url}`);
  console.log(`Tangent CI passed: ${url}`);
}

/**
 * Upgrade smoke test with no user data: the previous release's server creates a database in an
 * empty temp home, then the new build starts against it, running its migrations (and, across the
 * v2 cutover, the v1 import). Only processes spawned here are stopped.
 */
async function startupCheck() {
  console.log("\n▶ startup check");
  const previous = previousReleaseServer();
  const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tangent-startup-"));
  try {
    await bootServer(`previous release ${previous.version}`, previous.executable, [], baseDir);
    await bootServer("new build", process.execPath, ["apps/server/src/bin.ts"], baseDir);
    console.log(`The new build started on a database created by ${previous.version}.`);
  } finally {
    NodeFS.rmSync(baseDir, { recursive: true, force: true });
  }
}

/** The newest published (not draft, not prerelease) Tangent release tag. */
function latestReleaseTag(): string {
  const tag = gh(
    "release",
    "list",
    "-R",
    RELEASE_REPOSITORY,
    "--exclude-drafts",
    "--exclude-pre-releases",
    "--limit",
    "1",
    "--json",
    "tagName",
    "--jq",
    ".[0].tagName",
  );
  if (!tag) throw new SyncStop("No published release found.");
  return tag;
}

/**
 * Drafts release notes: upstream's user-facing commits since the last release, and a Tangent
 * section for the agent to fill in. The agent edits the file before `publish`.
 */
function notes() {
  const state = readState();
  const head = git("rev-parse", "HEAD");
  git("fetch", "--quiet", "--tags", "origin");
  const lastTag = latestReleaseTag();
  const manifest = readManifest();
  const previous = attempt("git", ["show", `${lastTag}:${MANIFEST_PATH}`]);
  const lastBaseline = previous.ok ? (JSON.parse(previous.stdout) as Manifest).baseline : null;
  const since = lastBaseline
    ? attempt("git", ["merge-base", lastBaseline, manifest.baseline])
    : null;
  const subjects = (range: string) =>
    attempt("git", ["log", "--no-merges", "--format=%s", range]).stdout.split("\n").filter(Boolean);
  const entries =
    lastBaseline && since?.ok
      ? releaseNoteEntries(
          subjects(`${since.stdout}..${manifest.baseline}`),
          subjects(`${since.stdout}..${lastBaseline}`),
        )
      : releaseNoteEntries(subjects(`-50 ${manifest.baseline}`).slice(0, 50), []);
  const section = (title: string, items: ReadonlyArray<string>) =>
    items.length === 0
      ? []
      : [
          `### ${title}`,
          "",
          ...items.slice(0, 40).map((item) => `- ${item}`),
          ...(items.length > 40 ? [`- …and ${items.length - 40} more`] : []),
          "",
        ];
  const draft = [
    "## Upstream",
    "",
    `Changes from \`${manifest.upstream.branch}\` since ${lastTag}.`,
    "",
    ...section("Features", entries.features),
    ...section("Fixes", entries.fixes),
    ...section("Performance", entries.performance),
    "## Tangent",
    "",
    "- TODO: fork feature changes, conflicts resolved and how, Hermes baseline changes.",
    "",
  ].join("\n");
  NodeFS.writeFileSync(notesPath, draft);
  writeState({ ...state, notesHead: head });
  console.log(`Draft release notes: ${notesPath}\n\n${draft}`);
}

/** The latest published release's standalone server, downloaded once and verified. */
function previousReleaseServer(): { version: string; executable: string } {
  const tag = latestReleaseTag();
  const version = tag.replace(/^personal-v/, "");
  const host = {
    platform: Effect.runSync(HostProcessPlatform),
    arch: Effect.runSync(HostProcessArchitecture),
  };
  const platformKey = cliArchivePlatformKey(host.platform, host.arch);
  if (platformKey === undefined || platformKey.startsWith("win32")) {
    throw new SyncStop(`No release server archive for ${host.platform}-${host.arch}.`);
  }
  const directory = NodePath.join(stateDir, "releases", version);
  const executable = NodePath.join(directory, "t3");
  if (NodeFS.existsSync(executable)) return { version, executable };
  const archive = cliArchiveFileName(version, platformKey);
  const download = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tangent-release-"));
  try {
    gh(
      "release",
      "download",
      tag,
      "-R",
      RELEASE_REPOSITORY,
      "-D",
      download,
      "-p",
      archive,
      "-p",
      CLI_RELEASE_CHECKSUMS_FILE,
    );
    const expected = parseChecksums(
      NodeFS.readFileSync(NodePath.join(download, CLI_RELEASE_CHECKSUMS_FILE), "utf8"),
    ).get(archive);
    const actual = NodeCrypto.createHash("sha256")
      .update(NodeFS.readFileSync(NodePath.join(download, archive)))
      .digest("hex");
    if (expected !== actual) throw new SyncStop(`Checksum mismatch for ${archive}.`);
    NodeFS.mkdirSync(directory, { recursive: true });
    run("tar", ["-xzf", NodePath.join(download, archive), "-C", directory, "--strip-components=1"]);
  } catch (error) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    NodeFS.rmSync(download, { recursive: true, force: true });
  }
  return { version, executable };
}

/** Starts a server on the given home, waits until it listens and answers HTTP, then stops it. */
async function bootServer(
  label: string,
  command: string,
  args: ReadonlyArray<string>,
  baseDir: string,
) {
  const ready = NodePath.join(baseDir, "userdata", "server-runtime.json");
  NodeFS.rmSync(ready, { force: true });
  const port = await freePort();
  const logPath = NodePath.join(baseDir, `${label.replaceAll(/\W+/g, "-")}.log`);
  const log = NodeFS.openSync(logPath, "w");
  const child = NodeChildProcess.spawn(
    command,
    [...args, "--base-dir", baseDir, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    { stdio: ["ignore", log, log] },
  );
  try {
    const deadline = Date.now() + 180_000;
    // The runtime file is the server's own "listening" signal.
    while (!NodeFS.existsSync(ready)) {
      if (child.exitCode !== null)
        throw new SyncStop(`${label} exited during startup:\n${tail(logPath)}`);
      if (Date.now() > deadline)
        throw new SyncStop(`${label} did not start in time:\n${tail(logPath)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/t3/environment`);
    if (response.status >= 500) {
      throw new SyncStop(`${label} answered HTTP ${response.status}:\n${tail(logPath)}`);
    }
    const databases = NodeFS.readdirSync(NodePath.dirname(ready)).filter((name) =>
      name.endsWith(".sqlite"),
    );
    console.log(
      `${label} started and answered HTTP ${response.status}; databases: ${databases.join(", ") || "none"}.`,
    );
  } finally {
    await stop(child);
    NodeFS.closeSync(log);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Stops only the process this script spawned. */
async function stop(child: NodeChildProcess.ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  await exited;
  clearTimeout(timer);
}

const tail = (path: string) => NodeFS.readFileSync(path, "utf8").split("\n").slice(-40).join("\n");

function decide(): boolean {
  const state = readState();
  const head = git("rev-parse", "HEAD");
  if (state.gates?.head !== head) {
    throw new SyncStop("The gates have not passed on this commit; run `gates`.", EXIT_HOLD);
  }
  const manifest = readManifest();
  const reasons = publishBlockers({
    before: state.before,
    after: snapshot(manifest, manifest.baseline),
  });
  console.log(JSON.stringify({ publish: reasons.length === 0, reasons }, null, 2));
  return reasons.length === 0;
}

function publish() {
  if (!decide()) throw new SyncStop("Holding the release.", EXIT_HOLD);
  const state = readState();
  const branch = currentBranch();
  if (branch !== "main") throw new SyncStop("Release workflows only run from main.");
  const head = git("rev-parse", "HEAD");
  if (state.notesHead !== head || !NodeFS.existsSync(notesPath)) {
    throw new SyncStop("Draft and edit the release notes first: run `notes`.");
  }
  const releaseNotes = NodeFS.readFileSync(notesPath, "utf8").trim();
  if (releaseNotes.includes("TODO:"))
    throw new SyncStop(`Finish the release notes in ${notesPath}.`);
  if (releaseNotes.length > MAX_NOTES_LENGTH) {
    throw new SyncStop(`Release notes exceed ${MAX_NOTES_LENGTH} characters; shorten them.`);
  }
  git("fetch", "--quiet", "--tags", "origin");
  const remote = attempt("git", ["rev-parse", `refs/remotes/origin/${branch}`]);
  if (!remote.ok || remote.stdout !== head) {
    const lease = state.originBefore
      ? `--force-with-lease=${branch}:${state.originBefore}`
      : "--force-with-lease";
    git("push", lease, "origin", `HEAD:refs/heads/${branch}`);
    console.log(`Pushed ${head.slice(0, 10)} to origin/${branch}.`);
  }
  if (released(head, MACOS_WORKFLOW)) {
    console.log("macOS and server release already started or done for this commit.");
  } else {
    const releases = attempt("gh", [
      "api",
      "--paginate",
      `repos/${RELEASE_REPOSITORY}/releases`,
      "--jq",
      ".[].tag_name",
    ]);
    const tags = [
      ...git("tag", "--list", "personal-v*").split("\n"),
      ...(releases.ok ? releases.stdout.split("\n") : []),
    ];
    const version = process.argv[3] ?? nextPatchVersion(tags);
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new SyncStop(`Invalid version: ${version}`);
    gh(
      "workflow",
      "run",
      MACOS_WORKFLOW,
      "-R",
      RELEASE_REPOSITORY,
      "--ref",
      branch,
      "-f",
      `version=${version}`,
      "-F",
      `notes=@${notesPath}`,
    );
    console.log(`Started ${MACOS_WORKFLOW} for ${version}.`);
  }
  if (released(head, IOS_WORKFLOW)) {
    console.log("iOS release already started or done for this commit.");
  } else {
    gh(
      "workflow",
      "run",
      IOS_WORKFLOW,
      "-R",
      RELEASE_REPOSITORY,
      "--ref",
      branch,
      "-f",
      "mode=auto",
      "-f",
      `message=Tangent ${git("log", "-1", "--format=%h")}: see the macOS release notes`,
    );
    console.log(`Started ${IOS_WORKFLOW} in auto mode.`);
  }
  // GitHub enables newly added workflow files, including ones a sync brings in from upstream.
  const workflows = JSON.parse(
    gh("workflow", "list", "-R", RELEASE_REPOSITORY, "--all", "--json", "path,state"),
  ) as Array<{ path: string; state: string }>;
  for (const workflow of workflows) {
    const file = NodePath.basename(workflow.path);
    if (workflow.state === "active" && !file.startsWith("personal-")) {
      gh("workflow", "disable", file, "-R", RELEASE_REPOSITORY);
      console.log(`Disabled upstream workflow ${file}.`);
    }
  }
}

/** After a person reviews a hold, compares later decisions against this commit instead. */
function accept() {
  const state = readState();
  const manifest = readManifest();
  writeState({ ...state, before: snapshot(manifest, manifest.baseline) });
  console.log(`Accepted the held changes at ${git("rev-parse", "--short", "HEAD")}.`);
}

const commands: Record<string, () => unknown> = {
  status,
  rebase,
  continue: resume,
  gates,
  startup: startupCheck,
  notes,
  decide: () => {
    if (!decide()) throw new SyncStop("Holding the release.", EXIT_HOLD);
  },
  accept,
  publish,
};

const usage = `Usage: node scripts/tangent-sync.ts <${Object.keys(commands).join("|")}>`;
if (process.argv[2] === "--help") {
  console.log(usage);
  process.exit(0);
}
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(usage);
  process.exit(1);
}
try {
  await command();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error instanceof SyncStop ? error.exitCode : 1);
}
