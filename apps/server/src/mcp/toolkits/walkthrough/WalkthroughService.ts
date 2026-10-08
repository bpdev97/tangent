// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import type { ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import type { HtmlRenderReference } from "@t3tools/shared/htmlRender";
import {
  readWalkthroughReference,
  type WalkthroughReference,
  type WalkthroughScope,
} from "@t3tools/shared/walkthrough";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";

/** The agent's input, already schema-checked by the tool; the service decides what it means. */
export interface WalkthroughPublishInput {
  readonly title: string;
  readonly summary?: string | undefined;
  /** Checked by readWalkthroughReference, like the sections. */
  readonly visual?: unknown;
  readonly scope?: "branch" | "turn" | undefined;
  readonly baseRef?: string | undefined;
  readonly replaces?: string | undefined;
  readonly sections: ReadonlyArray<unknown>;
}

export class WalkthroughNoTurnError extends Schema.TaggedError<WalkthroughNoTurnError>()(
  "WalkthroughNoTurnError",
  {},
) {
  override get message(): string {
    return 'No turn is running in this thread, so scope "turn" has nothing to walk. Use scope "branch".';
  }
}

export class WalkthroughInvalidError extends Schema.TaggedError<WalkthroughInvalidError>()(
  "WalkthroughInvalidError",
  {},
) {
  override get message(): string {
    return "The walkthrough is too large or has an empty section. Keep summaries to a paragraph and split long walkthroughs into fewer, larger sections.";
  }
}

export class WalkthroughThreadError extends Schema.TaggedError<WalkthroughThreadError>()(
  "WalkthroughThreadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The thread could not be read.";
  }
}

/**
 * Turns an agent's walkthrough into the reference the client renders: picks
 * the diff it points at, stamps an id, the head commit and the time, and
 * validates the result against the same reader the client uses. Diagrams go
 * through the HTML render store under the thread's own attachment ids.
 */
export class WalkthroughService extends Context.Service<
  WalkthroughService,
  {
    readonly publish: (input: {
      readonly threadId: ThreadId;
      readonly walkthrough: WalkthroughPublishInput;
    }) => Effect.Effect<
      WalkthroughReference,
      WalkthroughNoTurnError | WalkthroughInvalidError | WalkthroughThreadError
    >;
    readonly storeVisual: (input: {
      readonly threadId: ThreadId;
      readonly html: string;
      readonly title: string;
      readonly height: number;
    }) => Effect.Effect<
      HtmlRenderReference,
      HtmlRender.HtmlRenderPrepareError | HtmlRender.HtmlRenderStoreError
    >;
  }
>()("t3/mcp/toolkits/walkthrough/WalkthroughService") {}

const SHA_PATTERN = /^[0-9a-f]{40}$/;

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const vcs = yield* VcsProcess.VcsProcess;
  const crypto = yield* Crypto.Crypto;
  const htmlRender = yield* HtmlRender.HtmlRender;

  // Best effort: a missing checkout, or git failing in any way, only loses the
  // "branch moved" notice.
  const readHeadCommit = (projectId: ProjectId, worktreePath: string | null) =>
    Effect.gen(function* () {
      const project = yield* projects.getById(projectId);
      if (Option.isNone(project)) return undefined;
      const result = yield* vcs.run({
        operation: "walkthrough.headCommit",
        command: "git",
        args: ["rev-parse", "HEAD"],
        cwd: worktreePath ?? project.value.workspaceRoot,
      });
      const sha = result.stdout.trim();
      return SHA_PATTERN.test(sha) ? sha : undefined;
    }).pipe(Effect.catchCause(() => Effect.succeed(undefined)));

  const resolveScope = (
    requested: "branch" | "turn",
    baseRef: string | undefined,
    runId: RunId | null,
  ): Effect.Effect<WalkthroughScope, WalkthroughNoTurnError> => {
    if (requested === "turn") {
      return runId === null
        ? Effect.fail(new WalkthroughNoTurnError())
        : Effect.succeed({ kind: "turn", turnId: runId });
    }
    const trimmed = baseRef?.trim();
    return Effect.succeed(trimmed ? { kind: "branch", baseRef: trimmed } : { kind: "branch" });
  };

  return WalkthroughService.of({
    publish: ({ threadId, walkthrough }) =>
      Effect.gen(function* () {
        const shell = yield* threads
          .getThreadShell(threadId)
          .pipe(Effect.mapError((cause) => new WalkthroughThreadError({ cause })));
        const scope = yield* resolveScope(
          walkthrough.scope ?? "branch",
          walkthrough.baseRef,
          shell?.activeRunId ?? shell?.latestRunId ?? null,
        );
        const headCommit = shell
          ? yield* readHeadCommit(shell.projectId, shell.worktreePath)
          : undefined;
        const reference = readWalkthroughReference({
          id: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
          title: walkthrough.title,
          summary: walkthrough.summary,
          visual: walkthrough.visual,
          scope,
          sections: walkthrough.sections,
          replaces: walkthrough.replaces,
          headCommit,
          publishedAt: DateTime.formatIso(yield* DateTime.now),
        });
        if (reference === undefined) return yield* new WalkthroughInvalidError();
        return reference;
      }),
    storeVisual: ({ threadId, html, title, height }) =>
      htmlRender.publish({ threadId, html, title, height }),
  });
});

export const layer = Layer.effect(WalkthroughService, make);
