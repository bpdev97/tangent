import { describe, expect, it } from "vite-plus/test";

import {
  checkRunsState,
  footprintGrowth,
  nextPatchVersion,
  parseProtocolVersion,
  publishBlockers,
  releaseNoteEntries,
  type SyncSnapshot,
} from "./tangent-sync.ts";

const snapshot = (overrides: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  footprint: { "FORK-A": { upstream: ["a.ts"] }, "FORK-B": { upstream: ["b.ts"] } },
  protocolVersion: 2,
  hermesMinimumContract: 7,
  features: ["FORK-A", "FORK-B"],
  ...overrides,
});

describe("parseProtocolVersion", () => {
  it("reads the exported constant", () => {
    expect(parseProtocolVersion("x\nexport const ORCHESTRATION_PROTOCOL_VERSION = 3;\n")).toBe(3);
    expect(parseProtocolVersion("no constant here")).toBeNull();
  });
});

describe("footprintGrowth", () => {
  it("reports only features that gained an upstream file", () => {
    const before = { "FORK-A": { upstream: ["a.ts", "b.ts"] }, "FORK-B": { upstream: ["c.ts"] } };
    const after = {
      "FORK-A": { upstream: ["a.ts"] },
      "FORK-B": { upstream: ["c.ts", "d.ts"] },
      "FORK-C": { upstream: ["e.ts"] },
    };
    expect(footprintGrowth(before, after)).toEqual(["FORK-B", "FORK-C"]);
  });
});

describe("publishBlockers", () => {
  it("allows publishing when nothing sensitive changed", () => {
    expect(publishBlockers({ before: snapshot(), after: snapshot() })).toEqual([]);
  });

  it("holds for each sensitive change", () => {
    const reasons = publishBlockers({
      before: snapshot(),
      after: snapshot({
        footprint: { "FORK-A": { upstream: ["a.ts", "new.ts"] }, "FORK-B": { upstream: [] } },
        protocolVersion: 3,
        hermesMinimumContract: 8,
        features: ["FORK-A"],
      }),
    });
    expect(reasons).toHaveLength(4);
    expect(reasons[0]).toContain("FORK-A");
    expect(reasons[3]).toContain("FORK-B");
  });
});

describe("nextPatchVersion", () => {
  it("bumps the newest stable personal tag and ignores others", () => {
    expect(
      nextPatchVersion([
        "personal-v0.1.9",
        "personal-v0.1.57",
        "personal-v0.1.100-nightly.1",
        "v9.9.9",
        "personal-v0.1.10",
      ]),
    ).toBe("0.1.58");
    expect(nextPatchVersion(["personal-v0.2.0", "personal-v0.1.57"])).toBe("0.2.1");
    expect(nextPatchVersion([])).toBe("0.1.0");
  });
});

describe("releaseNoteEntries", () => {
  it("keeps new user-facing commits and drops ones already released", () => {
    const entries = releaseNoteEntries(
      [
        "feat(web): new sidebar",
        "fix(v2): queue during compaction",
        "fix(v2): queue during compaction",
        "perf(mobile): recycle lists",
        "chore: bump deps",
        "feat(server): already shipped",
        "Merge branch 'main'",
      ],
      ["feat(server): already shipped"],
    );
    expect(entries).toEqual({
      features: ["web: new sidebar"],
      fixes: ["v2: queue during compaction"],
      performance: ["mobile: recycle lists"],
    });
  });
});

describe("checkRunsState", () => {
  const required = ["Test", "Rust"];
  const run = (name: string, conclusion: string | null, status = "completed") => ({
    name,
    status,
    conclusion,
  });

  it("is green when every required check passed, whatever advisory checks did", () => {
    expect(
      checkRunsState(
        [run("Test", "success"), run("Rust", "skipped"), run("Check", "failure")],
        required,
      ),
    ).toBe("green");
  });

  it("is red, pending, or unknown from the required checks alone", () => {
    expect(checkRunsState([run("Test", "failure"), run("Rust", "success")], required)).toBe("red");
    expect(
      checkRunsState([run("Test", null, "in_progress"), run("Rust", "success")], required),
    ).toBe("pending");
    expect(checkRunsState([run("Test", "success")], required)).toBe("unknown");
    expect(checkRunsState([], required)).toBe("unknown");
  });
});
