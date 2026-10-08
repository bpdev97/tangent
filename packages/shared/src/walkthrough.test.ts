// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { describe, expect, it } from "vite-plus/test";

import {
  compactDynamicToolOutput,
  htmlRenderFromToolItem,
  walkthroughFromToolItem,
  walkthroughVisualFromToolItem,
} from "./toolOutput.ts";
import {
  readWalkthroughReference,
  supersededWalkthroughIds,
  WALKTHROUGH_MAX_SECTIONS,
  walkthroughFilePaths,
  walkthroughFlagCounts,
  walkthroughReferencesEqual,
} from "./walkthrough.ts";

const section = (title: string, ...paths: string[]) => ({
  title,
  summary: `Why ${title.toLowerCase()} changed.`,
  files: paths.map((path) => ({ path })),
});

const reference = {
  id: "walk-1",
  title: "Quiet connection status",
  scope: { kind: "branch" as const },
  sections: [
    section("Decide the mark", "apps/mobile/src/features/home/quiet-connection-indicator.ts"),
    section("Upstream hook", "apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx"),
  ],
};

describe("readWalkthroughReference", () => {
  it("accepts a well-formed reference and trims its text", () => {
    const parsed = readWalkthroughReference({
      ...reference,
      title: "  Quiet connection status  ",
      summary: " Keeps the brand in the header. ",
      replaces: "walk-0",
      headCommit: "a".repeat(40),
      sections: [
        {
          ...reference.sections[0],
          attention: "review",
          reason: " First guard keeps upstream's title. ",
          files: [
            {
              path: " a.ts ",
              flags: [{ severity: "question", line: 15, text: " Returns undefined before load? " }],
            },
          ],
        },
      ],
    });
    expect(parsed?.title).toBe("Quiet connection status");
    expect(parsed?.summary).toBe("Keeps the brand in the header.");
    expect(parsed?.replaces).toBe("walk-0");
    expect(parsed?.sections[0]?.attention).toBe("review");
    expect(parsed?.sections[0]?.reason).toBe("First guard keeps upstream's title.");
    expect(parsed?.sections[0]?.files[0]).toEqual({
      path: "a.ts",
      flags: [{ severity: "question", line: 15, text: "Returns undefined before load?" }],
    });
  });

  it("reads the earlier single-note spelling as a note flag and drops a bad line", () => {
    const parsed = readWalkthroughReference({
      ...reference,
      sections: [
        {
          ...reference.sections[0],
          files: [
            { path: "a.ts", note: { text: "Whole file" } },
            { path: "b.ts", flags: [{ severity: "nit", line: 0, text: "Bad line" }] },
            { path: "c.ts", flags: [{ severity: "fatal", text: "Unknown severity" }] },
          ],
        },
      ],
    });
    expect(parsed?.sections[0]?.files.map((file) => file.flags)).toEqual([
      [{ severity: "note", text: "Whole file" }],
      [{ severity: "nit", text: "Bad line" }],
      [{ severity: "note", text: "Unknown severity" }],
    ]);
  });

  it("keeps a valid diagram reference on the walkthrough and a section, and drops a broken one", () => {
    const visual = { attachmentId: "thread-1-abc.html", title: "Flow", height: 320 };
    const parsed = readWalkthroughReference({
      ...reference,
      visual,
      sections: [
        { ...reference.sections[0], visual },
        { ...reference.sections[1], visual: { attachmentId: "", title: "x", height: 1 } },
      ],
    });
    expect(parsed?.visual).toEqual(visual);
    expect(parsed?.sections[0]?.visual).toEqual(visual);
    expect(parsed?.sections[1]?.visual).toBeUndefined();
  });

  it("drops an unknown attention level rather than the section", () => {
    const parsed = readWalkthroughReference({
      ...reference,
      sections: [{ ...reference.sections[0], attention: "ignore" }],
    });
    expect(parsed?.sections[0]?.attention).toBeUndefined();
  });

  it("requires an id and resolves a turn scope", () => {
    expect(readWalkthroughReference({ ...reference, id: "" })).toBeUndefined();
    expect(
      readWalkthroughReference({ ...reference, scope: { kind: "turn", turnId: "run-1" } })?.scope,
    ).toEqual({ kind: "turn", turnId: "run-1" });
    expect(readWalkthroughReference({ ...reference, scope: { kind: "turn" } })).toBeUndefined();
    expect(readWalkthroughReference({ ...reference, scope: { kind: "commit" } })).toBeUndefined();
  });

  it("rejects an empty section, a section without files, and too many sections", () => {
    expect(
      readWalkthroughReference({
        ...reference,
        sections: [{ ...reference.sections[0], summary: "" }],
      }),
    ).toBeUndefined();
    expect(
      readWalkthroughReference({
        ...reference,
        sections: [{ ...reference.sections[0], files: [] }],
      }),
    ).toBeUndefined();
    expect(
      readWalkthroughReference({
        ...reference,
        sections: Array.from({ length: WALKTHROUGH_MAX_SECTIONS + 1 }, (_, i) =>
          section(`Section ${i}`, `file-${i}.ts`),
        ),
      }),
    ).toBeUndefined();
  });

  it("rejects a reference over its byte cap, measured in UTF-8", () => {
    const summary = "é".repeat(1_200);
    const sections = Array.from({ length: WALKTHROUGH_MAX_SECTIONS }, (_, i) => ({
      title: `Section ${i}`,
      summary,
      files: Array.from({ length: 40 }, (_, j) => ({
        path: `${"d".repeat(200)}/file-${i}-${j}.ts`,
      })),
    }));
    expect(readWalkthroughReference({ ...reference, sections })).toBeUndefined();
  });
});

describe("walkthrough helpers", () => {
  it("lists each path once in reading order", () => {
    const parsed = readWalkthroughReference({
      ...reference,
      sections: [section("One", "b.ts", "a.ts"), section("Two", "a.ts", "c.ts")],
    });
    expect(walkthroughFilePaths(parsed!)).toEqual(["b.ts", "a.ts", "c.ts"]);
  });

  it("counts a section's flags by severity", () => {
    const parsed = readWalkthroughReference({
      ...reference,
      sections: [
        {
          ...reference.sections[0],
          files: [
            {
              path: "a.ts",
              flags: [
                { severity: "blocker", text: "x" },
                { severity: "nit", text: "y" },
              ],
            },
            { path: "b.ts", flags: [{ severity: "blocker", text: "z" }] },
          ],
        },
      ],
    });
    expect(walkthroughFlagCounts(parsed!.sections[0]!)).toEqual({
      blocker: 2,
      question: 0,
      nit: 1,
      note: 0,
    });
  });

  it("marks only walkthroughs a later one in the list replaces", () => {
    const first = readWalkthroughReference(reference)!;
    const second = readWalkthroughReference({ ...reference, id: "walk-2", replaces: "walk-1" })!;
    const orphan = readWalkthroughReference({ ...reference, id: "walk-3", replaces: "missing" })!;
    expect([...supersededWalkthroughIds([first, second, orphan])]).toEqual(["walk-1"]);
  });

  it("compares references by content", () => {
    const left = readWalkthroughReference(reference)!;
    const right = readWalkthroughReference(structuredClone(reference))!;
    expect(walkthroughReferencesEqual(left, right)).toBe(true);
    expect(
      walkthroughReferencesEqual(left, readWalkthroughReference({ ...reference, title: "Other" })!),
    ).toBe(false);
  });
});

describe("walkthrough in compact tool output", () => {
  it("survives compaction under every provider's tool-name spelling", () => {
    const output = { walkthrough: reference, message: "Shown." };
    for (const toolName of [
      "mcp__t3-code__walkthrough_publish",
      "t3-code.walkthrough_publish",
      "t3-code-thread_walkthrough_publish",
    ]) {
      expect(walkthroughFromToolItem({ toolName, output })).toEqual(reference);
    }
    expect(
      walkthroughFromToolItem({ toolName: "mcp__t3-code__html_render", output }),
    ).toBeUndefined();
  });

  it("reads a stored diagram from walkthrough_visual but never as an inline page", () => {
    const output = { htmlRender: { attachmentId: "thread-1-d.html", title: "Flow", height: 300 } };
    const item = { toolName: "mcp__t3-code__walkthrough_visual", output };
    expect(walkthroughVisualFromToolItem(item)?.attachmentId).toBe("thread-1-d.html");
    expect(htmlRenderFromToolItem(item)).toBeUndefined();
    expect(walkthroughFromToolItem(item)).toBeUndefined();
  });

  it("is dropped from a failed call and never trips the generic size cap", () => {
    expect(
      walkthroughFromToolItem({
        toolName: "mcp__t3-code__walkthrough_publish",
        output: { isError: true, walkthrough: reference },
      }),
    ).toBeUndefined();
    const large = {
      ...reference,
      sections: Array.from({ length: 10 }, (_, i) => ({
        title: `Section ${i}`,
        summary: "y".repeat(1_000),
        files: [{ path: `file-${i}.ts` }],
      })),
    };
    const compact = compactDynamicToolOutput({ walkthrough: large, threadId: "thread-1" });
    expect(compact?.walkthrough?.sections).toHaveLength(10);
    expect(compact?.threadId).toBe("thread-1");
  });
});
