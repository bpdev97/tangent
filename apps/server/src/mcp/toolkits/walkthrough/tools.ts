// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  HTML_RENDER_LAYOUT_GUIDE,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MAX_TITLE_LENGTH,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_THEME_GUIDE,
} from "@t3tools/shared/htmlRender";
import {
  WALKTHROUGH_MAX_FILES_PER_SECTION,
  WALKTHROUGH_MAX_FLAG_LENGTH,
  WALKTHROUGH_MAX_FLAGS_PER_FILE,
  WALKTHROUGH_MAX_REASON_LENGTH,
  WALKTHROUGH_MAX_SECTIONS,
  WALKTHROUGH_MAX_SUMMARY_LENGTH,
  WALKTHROUGH_MAX_TITLE_LENGTH,
  WALKTHROUGH_PUBLISH_TOOL_NAME,
  WALKTHROUGH_VISUAL_TOOL_NAME,
} from "@t3tools/shared/walkthrough";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DEFAULT_WALKTHROUGH_POLICY } from "./policy.ts";
import * as WalkthroughService from "./WalkthroughService.ts";

const Title = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(WALKTHROUGH_MAX_TITLE_LENGTH),
);
const Paragraph = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(WALKTHROUGH_MAX_SUMMARY_LENGTH),
);

const WalkthroughFlagInput = Schema.Struct({
  severity: Schema.Literals(["blocker", "question", "nit", "note"]).annotate({
    description:
      '"blocker": must change before merge. "question": you need an answer from the author. "nit": optional polish. "note": context the reader would otherwise miss.',
  }),
  line: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })).annotate({
      description: "New-side line number the flag sits under. Omit for a file-level remark.",
    }),
  ),
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(WALKTHROUGH_MAX_FLAG_LENGTH)),
});

const WalkthroughFileInput = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_024)).annotate({
    description: "Path relative to the repository root, exactly as the diff names it.",
  }),
  flags: Schema.optional(
    Schema.Array(WalkthroughFlagInput)
      .check(Schema.isMaxLength(WALKTHROUGH_MAX_FLAGS_PER_FILE))
      .annotate({
        description:
          "Remarks shown inline in this file's diff. Most files need none; use them for real findings, not to narrate the code.",
      }),
  ),
});

/** A stored diagram's reference, as `html_render` returns one. */
const VisualReference = Schema.Struct({
  attachmentId: Schema.String,
  title: Schema.String,
  height: Schema.Number,
  heights: Schema.optional(Schema.Array(Schema.Tuple([Schema.Int, Schema.Int]))),
});
const VisualInput = Schema.optional(
  VisualReference.annotate({
    description: "A diagram from walkthrough_visual's result, shown with this text.",
  }),
);

const WalkthroughSectionInput = Schema.Struct({
  title: Title.annotate({
    description: "Short section heading, for example 'Shared notification model'.",
  }),
  summary: Paragraph.annotate({
    description:
      "One paragraph: why this group of files changed and what a reviewer should check. Plain prose, no code.",
  }),
  attention: Schema.optional(
    Schema.Literals(["review", "skim", "trust"]).annotate({
      description:
        '"review": read every line (new logic, auth, data, concurrency). "skim": confirm the shape (wiring, renames, straightforward UI). "trust": generated, lockfiles, mechanical renames; the reader may skip it.',
    }),
  ),
  reason: Schema.optional(
    Schema.String.check(Schema.isMaxLength(WALKTHROUGH_MAX_REASON_LENGTH)).annotate({
      description: "One line on why the section earns its attention level.",
    }),
  ),
  visual: VisualInput,
  files: Schema.Array(WalkthroughFileInput).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(WALKTHROUGH_MAX_FILES_PER_SECTION),
  ),
});

const WalkthroughFlagOutput = Schema.Struct({
  severity: Schema.Literals(["blocker", "question", "nit", "note"]),
  line: Schema.optional(Schema.Int),
  text: Schema.String,
});

const PUBLISH_MECHANICS = `Publish a guided walkthrough of a diff into this thread. T3 shows a card with the summary and sections; opening one drives the native diff panel to that section's files with your text above them, so write prose only and never paste code. Scope "branch" walks every change on the checkout since its base (the default); "turn" walks only the diff of this turn. Flags sit under the new-side line they name. A diagram from walkthrough_visual can be attached to the walkthrough or to a section. To update a walkthrough after the code changed, publish the full new structure with "replaces" set to the previous id from this tool's result; the old card collapses. Call it before your final reply and keep that reply short: the reader has the sections already.`;

/**
 * The publish tool, with this environment's review policy in its description
 * so every provider reads the same guidance. The default export below carries
 * the shipped default; the server builds the live one from the policy file.
 */
const makeWalkthroughPublishTool = (policy: string) =>
  Tool.make(WALKTHROUGH_PUBLISH_TOOL_NAME, {
    description: `${PUBLISH_MECHANICS}\n\nReview policy for this environment:\n${policy}`,
    parameters: Schema.Struct({
      title: Title.annotate({
        description: "Name for the walkthrough, usually the change's title.",
      }),
      summary: Schema.optional(
        Paragraph.annotate({
          description:
            "Two to four sentences: what the change does, why, and what it deliberately does not do. Shown before any section.",
        }),
      ),
      scope: Schema.optional(
        Schema.Literals(["branch", "turn"]).annotate({
          description: 'Which diff the sections point into. Defaults to "branch".',
        }),
      ),
      baseRef: Schema.optional(
        Schema.String.check(Schema.isMaxLength(200)).annotate({
          description:
            'For scope "branch": the base ref to diff against, such as main or origin/main. Omit to let T3 pick the branch\'s base.',
        }),
      ),
      visual: VisualInput,
      replaces: Schema.optional(
        Schema.String.check(Schema.isMaxLength(128)).annotate({
          description:
            "The id of the walkthrough this one updates, from the earlier result. The earlier card collapses and the panel follows this one.",
        }),
      ),
      sections: Schema.Array(WalkthroughSectionInput).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(WALKTHROUGH_MAX_SECTIONS),
      ),
    }),
    success: Schema.Struct({
      walkthrough: Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        summary: Schema.optional(Schema.String),
        visual: Schema.optional(VisualReference),
        scope: Schema.Union([
          Schema.Struct({
            kind: Schema.Literal("branch"),
            baseRef: Schema.optional(Schema.String),
          }),
          Schema.Struct({ kind: Schema.Literal("turn"), turnId: Schema.String }),
        ]),
        sections: Schema.Array(
          Schema.Struct({
            title: Schema.String,
            summary: Schema.String,
            attention: Schema.optional(Schema.Literals(["review", "skim", "trust"])),
            reason: Schema.optional(Schema.String),
            visual: Schema.optional(VisualReference),
            files: Schema.Array(
              Schema.Struct({
                path: Schema.String,
                flags: Schema.optional(Schema.Array(WalkthroughFlagOutput)),
              }),
            ),
          }),
        ),
        replaces: Schema.optional(Schema.String),
        headCommit: Schema.optional(Schema.String),
        publishedAt: Schema.optional(Schema.String),
      }),
      message: Schema.String,
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      McpInvocationContext.McpInvocationContext,
      ThreadManagementService.ThreadManagementService,
      WalkthroughService.WalkthroughService,
    ],
  })
    .annotate(Tool.Title, "Publish walkthrough")
    // Read-only in the MCP sense: it shows structure in the caller's own thread
    // and touches no workspace, so plan mode and read-only sandboxes can use it.
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false);

const Html = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512_000)).annotate({
  description: "A complete, self-contained HTML document.",
});

// Read-only like html_render: it stores a page for the calling thread and
// touches no workspace. Unlike html_render, nothing appears in the thread.
const WalkthroughVisualTool = Tool.make(WALKTHROUGH_VISUAL_TOOL_NAME, {
  description: `Store a diagram for a walkthrough without showing it in the thread: an architecture view, a data flow, a state machine, or a before/after sketch. Returns a reference to pass as "visual" on walkthrough_publish, at the top level or on one section, where the reader sees it beside your text. Preview with html_preview first. Write one self-contained document with inline <style> and <script>; keep it to one screen. ${HTML_RENDER_LAYOUT_GUIDE} ${HTML_RENDER_THEME_GUIDE}`,
  parameters: Schema.Struct({
    html: Html,
    title: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(HTML_RENDER_MAX_TITLE_LENGTH),
    ).annotate({ description: "Short name for the diagram." }),
    height: Schema.Int.annotate({
      description: `The frame height in CSS pixels, ${HTML_RENDER_MIN_HEIGHT}-${HTML_RENDER_MAX_HEIGHT}. Use html_preview's contentHeight.`,
    }),
  }),
  success: Schema.Struct({
    htmlRender: VisualReference,
    message: Schema.String,
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    WalkthroughService.WalkthroughService,
  ],
})
  .annotate(Tool.Title, "Draw walkthrough diagram")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const makeWalkthroughToolkit = (policy: string) =>
  Toolkit.make(makeWalkthroughPublishTool(policy), WalkthroughVisualTool);

/** The toolkit with the shipped default policy, for tests and type derivation. */
export const WalkthroughToolkit = makeWalkthroughToolkit(DEFAULT_WALKTHROUGH_POLICY.trim());
