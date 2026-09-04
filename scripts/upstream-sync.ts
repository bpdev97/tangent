// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Git maintenance bootstrap runs without an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import manifest from "../downstream/fork.json" with { type: "json" };

const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
const upstream = git("rev-parse", "upstream/main");
const base = git("rev-parse", "HEAD");
const conflicts = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
if (conflicts.length) {
  const rows = conflicts.map((path) => {
    const owners = manifest.groups
      .filter((group) => group.paths.includes(path))
      .flatMap((group) => group.features);
    return `- \`${path}\`: ${owners.length ? [...new Set(owners)].join(", ") : "unregistered; review ownership"}`;
  });
  NodeFS.writeFileSync(
    "upstream-sync-report.md",
    [
      "# Upstream merge needs conflict resolution",
      "",
      `Tangent base: \`${base}\``,
      `Upstream target: \`${upstream}\``,
      "",
      "Resolve these conflicts in an isolated checkout. Read FORK.md and the listed feature records; preserve upstream ancestry with a merge commit.",
      "",
      ...rows,
      "",
      "```sh",
      `git switch -c sync/upstream-${upstream.slice(0, 12)} ${base}`,
      `git merge --no-ff ${upstream}`,
      "# Resolve conflicts, then update downstream/fork.json baseline and ownership.",
      "node scripts/check-fork.ts",
      "vp check",
      "vp run typecheck",
      "```",
      "",
      "Run the feature tests printed by check-fork and an integrated client pass for visible changes. Open a PR and merge only after review and successful checks. Merged PRs are the implementation record.",
      "",
    ].join("\n"),
  );
} else {
  const path = "downstream/fork.json";
  const updated = { ...manifest, baseline: upstream };
  NodeFS.writeFileSync(path, JSON.stringify(updated, null, 2) + "\n");
}
