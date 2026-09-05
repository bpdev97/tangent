// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Git maintenance bootstrap runs without an Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import manifest from "../downstream/fork.json" with { type: "json" };

const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { encoding: "utf8" }).trim();
const paths = new Map<string, Set<string>>();
for (const group of manifest.groups) {
  if (group.features.length === 0) throw new Error("Fork ownership group has no features.");
  for (const owner of group.features) {
    if (!Object.hasOwn(manifest.features, owner)) throw new Error(`Unknown fork feature: ${owner}`);
  }
  for (const path of group.paths) {
    const owners = paths.get(path) ?? new Set<string>();
    for (const owner of group.features) owners.add(owner);
    paths.set(path, owners);
  }
}

git("merge-base", "--is-ancestor", manifest.baseline, "HEAD");
const changed = git("diff", "--name-only", "--diff-filter=ACDMRT", manifest.baseline)
  .split("\n")
  .filter(Boolean);
const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
const missing = [...new Set([...changed, ...untracked])].filter((path) => !paths.has(path));
const obsolete = [...paths.keys()].filter(
  (path) => !NodeFS.existsSync(path) && !changed.includes(path),
);
if (missing.length || obsolete.length) {
  throw new Error(
    [
      ...missing.map((path) => `Unregistered fork path: ${path}`),
      ...obsolete.map((path) => `Remove obsolete fork path: ${path}`),
    ].join("\n"),
  );
}
console.log(`Fork inventory covers ${changed.length} changed paths against ${manifest.baseline}.`);
for (const [feature, record] of Object.entries(manifest.features)) {
  const tests = [...paths]
    .filter(([path, owners]) => owners.has(feature) && /\.test\.[cm]?[jt]sx?$/.test(path))
    .map(([path]) => path);
  console.log(`${feature}: ${record}`);
  if (tests.length) console.log(`  vp test run ${tests.join(" ")}`);
}
