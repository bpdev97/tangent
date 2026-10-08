// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../../../config.ts";

export const WALKTHROUGH_POLICY_FILE = "walkthrough-policy.md";

/**
 * How an agent should review, as opposed to what the tools can carry. This is
 * the default written to `<state dir>/walkthrough-policy.md` the first time
 * the server starts; the owner edits that file to tune reviews without a code
 * change. The server reads it at startup and puts it in the tool description,
 * so every provider sees the same policy.
 */
export const DEFAULT_WALKTHROUGH_POLICY = `# Review policy

## When to publish
- The user asks for a walkthrough, guide, tour, or review of a diff. If a pull request is linked, review the branch against its base; otherwise review the branch against origin/main when it exists.
- After you finish a multi-file change of your own, offer a walkthrough rather than publishing one unasked.

## Summary
- Two to four sentences: what the change does, why, and what it deliberately does not do. Name the risk you would want a reviewer to look at first.

## Sections
- Order by how much review each needs, not by directory: core logic first, then its consequences, then wiring, then tests, then generated or mechanical changes.
- Attention levels: "review" for new logic, auth, data, concurrency, and anything that changes behaviour; "skim" for wiring, renames, and straightforward UI; "trust" for lockfiles, generated files, and mechanical renames. Give a one-line reason for each.
- One paragraph per section, plain prose. Say what the reviewer should check, not what the code says; the diff is beside you.

## Flags
- Flag only findings, never narration. "blocker" must change before merge; "question" needs the author's answer; "nit" is optional polish; "note" is context the reader would miss.
- Anchor each flag to the exact new-side line. Prefer one well-placed flag to three vague ones.

## Diagrams
- Draw a diagram with walkthrough_visual when the change crosses two or more components, introduces a state machine or lifecycle, or reorders a data flow. Attach it to the walkthrough for an architecture view, or to the section it explains. Keep it to one screen.

## Updating
- When asked to update after the code changed, re-read the diff, republish the full structure with "replaces" set to the earlier id, drop resolved flags, and mention what changed in the summary.
`;

/**
 * The policy text for this environment: the file's contents, or the default
 * after writing it so the owner can find and edit it. A read or write failure
 * falls back to the default rather than failing startup.
 */
export const readWalkthroughPolicy = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(config.stateDir, WALKTHROUGH_POLICY_FILE);
  const read = yield* fileSystem.readFileString(file).pipe(
    Effect.map((text) => ({ kind: "found" as const, text: text.trim() })),
    Effect.catch((cause) =>
      Effect.succeed(
        cause.reason._tag === "NotFound"
          ? { kind: "missing" as const }
          : { kind: "unreadable" as const },
      ),
    ),
  );
  if (read.kind === "found" && read.text.length > 0) return { file, policy: read.text };
  // Only a file that is not there gets the default written; a file that
  // exists but cannot be read, or is empty, is the owner's to sort out.
  if (read.kind === "missing") {
    yield* fileSystem.writeFileString(file, DEFAULT_WALKTHROUGH_POLICY).pipe(Effect.ignore);
  }
  return { file, policy: DEFAULT_WALKTHROUGH_POLICY.trim() };
});
