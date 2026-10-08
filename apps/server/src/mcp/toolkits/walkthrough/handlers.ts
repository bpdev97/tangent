// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as WalkthroughService from "./WalkthroughService.ts";
import { WalkthroughToolkit } from "./tools.ts";

const INVALID_REQUEST_ERRORS = new Set([
  "WalkthroughNoTurnError",
  "WalkthroughInvalidError",
  "HtmlRenderImagesNotFoundError",
  "HtmlRenderImageTooLargeError",
  "HtmlRenderPageTooLargeError",
]);

// Every error message is built on the server and tells the agent what to do next.
const toFailure = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: INVALID_REQUEST_ERRORS.has(error._tag) ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

// Both tools act as the calling thread: the walkthrough lands in its timeline
// and a diagram is stored under its attachment ids, so they need its live run.
const handlers = {
  walkthrough_publish: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "walkthrough_publish",
      );
      const service = yield* WalkthroughService.WalkthroughService;
      const walkthrough = yield* service
        .publish({ threadId: thread.threadId, walkthrough: input })
        .pipe(Effect.mapError(toFailure));
      return {
        walkthrough,
        message: `Shown to the reader as a walkthrough card above your reply (id ${walkthrough.id}; pass it as "replaces" when you update this walkthrough). Reply with a short text summary of the sections and any blockers, since some clients show only text; don't repeat the section prose.`,
      };
    }),
  ),
  walkthrough_visual: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(
        scope,
        "walkthrough_visual",
      );
      const service = yield* WalkthroughService.WalkthroughService;
      const reference = yield* service
        .storeVisual({ threadId: thread.threadId, ...input })
        .pipe(Effect.mapError(toFailure));
      return {
        htmlRender: reference,
        message:
          'Stored. Pass this htmlRender object as "visual" on walkthrough_publish (top level or on a section); it is not shown until then.',
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof WalkthroughToolkit.tools>;

export const layer = McpToolAccess.toLayer(WalkthroughToolkit, handlers);
