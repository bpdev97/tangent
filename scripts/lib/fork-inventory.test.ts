import { describe, expect, it } from "vite-plus/test";

import { attributeCommits, featureFiles, recordProblems } from "./fork-inventory.ts";

const record = (sections: ReadonlyArray<string>) =>
  ["# Record", ...sections.map((section) => `## ${section}\n\ntext`)].join("\n\n");

const commit = (
  sha: string,
  subject: string,
  trailers: ReadonlyArray<string>,
  files: ReadonlyArray<string> = [],
) => ({ sha: sha.repeat(40), subject, trailers, files });

describe("recordProblems", () => {
  const complete = [
    "Why",
    "Behavior",
    "Upstream hooks",
    "Resolving conflicts",
    "Never",
    "Remove when",
    "Verify",
  ];

  it("accepts every required section in order", () => {
    expect(recordProblems("a.md", record(complete))).toEqual([]);
  });

  it("names missing and misordered sections", () => {
    const sections = ["Behavior", "Why", ...complete.slice(2, 6)];
    expect(recordProblems("a.md", record(sections))).toEqual([
      'a.md: section "Behavior" is out of order.',
      'a.md: missing section "Verify".',
    ]);
  });
});

describe("attributeCommits", () => {
  const known = new Set(["FORK-A", "FORK-B"]);

  it("gives folded commits the features of the commit they name", () => {
    const { features, problems } = attributeCommits(
      [
        commit("a", "feat: hermes", ["FORK-A"]),
        commit("b", "fixup! feat: hermes", []),
        commit("c", "feat: shared hook", ["FORK-A", "FORK-B"]),
      ],
      known,
    );
    expect(problems).toEqual([]);
    expect(features.get("b".repeat(40))).toEqual(["FORK-A"]);
    expect(features.get("c".repeat(40))).toEqual(["FORK-A", "FORK-B"]);
  });

  it("reports commits no feature owns", () => {
    const { problems } = attributeCommits(
      [
        commit("a", "chore: stray", []),
        commit("b", "fixup! feat: missing", []),
        commit("c", "feat: typo", ["FORK-Z"]),
      ],
      known,
    );
    expect(problems).toEqual([
      'Commit aaaaaaaaaa "chore: stray" has no Fork-Feature trailer.',
      'Commit bbbbbbbbbb "fixup! feat: missing" folds into no feature commit.',
      'Commit cccccccccc "feat: typo" names unknown feature FORK-Z.',
    ]);
  });
});

describe("featureFiles", () => {
  it("collects upstream and test files per feature across folded commits", () => {
    const commits = [
      commit("a", "feat: hermes", ["FORK-A"], ["AGENTS.md", "apps/hermes/adapter.ts"]),
      commit("b", "fixup! feat: hermes", [], ["apps/hermes/adapter.test.ts", "AGENTS.md"]),
    ];
    const { features } = attributeCommits(commits, new Set(["FORK-A"]));
    const files = featureFiles(commits, features, (path) => path === "AGENTS.md");
    expect(files.get("FORK-A")).toEqual({
      upstream: ["AGENTS.md"],
      tests: ["apps/hermes/adapter.test.ts"],
    });
  });
});
