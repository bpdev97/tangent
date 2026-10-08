// Tangent(FORK-WALK-001): see docs/fork/walkthrough.md.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  type OrchestrationV2ThreadShell,
  type Project,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/process";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import { OrchestratorProjectionError } from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as WalkthroughService from "./WalkthroughService.ts";

const threadId = ThreadId.make("thread:walkthrough");
const HEAD = "0123456789abcdef0123456789abcdef01234567";

const section = {
  title: "Policy file",
  summary: "The policy is read once at MCP startup.",
  files: [{ path: "apps/server/src/mcp/toolkits/walkthrough/policy.ts" }],
};

const layerFor = (options: {
  readonly shell?: OrchestrationV2ThreadShell | null | "error";
  readonly git?: { readonly stdout: string } | "error";
}) =>
  WalkthroughService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadShell: (id) =>
            options.shell === "error"
              ? Effect.fail(
                  new OrchestratorProjectionError({ threadId: id, cause: new Error("closed") }),
                )
              : Effect.succeed(
                  options.shell === undefined
                    ? McpToolAccessTestkit.liveThreadShell(id)
                    : options.shell,
                ),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeed(
              Option.some({
                id: ProjectId.make("project:mcp-test"),
                workspaceRoot: "/tmp/walkthrough-project",
              } as Project),
            ),
        }),
        Layer.mock(VcsProcess.VcsProcess)({
          run: () =>
            options.git === "error"
              ? Effect.die(new Error("no git"))
              : Effect.succeed({
                  exitCode: ChildProcessSpawner.ExitCode(0),
                  stdout: options.git?.stdout ?? `${HEAD}\n`,
                  stderr: "",
                  stdoutTruncated: false,
                  stderrTruncated: false,
                }),
        }),
        Layer.mock(HtmlRender.HtmlRender)({}),
        NodeCrypto.layer,
      ),
    ),
  );

describe("WalkthroughService.publish", () => {
  it.effect("stamps an id, the head commit, the time and the branch scope", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const published = yield* service.publish({
        threadId,
        walkthrough: { title: "Policy", baseRef: " main ", sections: [section] },
      });
      expect(published.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(published.scope).toEqual({ kind: "branch", baseRef: "main" });
      expect(published.headCommit).toBe(HEAD);
      expect(published.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(published.sections[0]?.files[0]?.path).toBe(section.files[0]?.path);
    }).pipe(Effect.provide(layerFor({}))),
  );

  it.effect("points a turn walkthrough at the running turn", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const published = yield* service.publish({
        threadId,
        walkthrough: { title: "Turn", scope: "turn", sections: [section] },
      });
      expect(published.scope).toEqual({ kind: "turn", turnId: RunId.make("run:mcp-test") });
    }).pipe(Effect.provide(layerFor({}))),
  );

  it.effect("falls back to the latest finished turn when none is running", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const published = yield* service.publish({
        threadId,
        walkthrough: { title: "Turn", scope: "turn", sections: [section] },
      });
      expect(published.scope).toEqual({ kind: "turn", turnId: RunId.make("run:last") });
    }).pipe(
      Effect.provide(
        layerFor({
          shell: {
            ...McpToolAccessTestkit.liveThreadShell(threadId, { activeRunId: null }),
            latestRunId: RunId.make("run:last"),
          },
        }),
      ),
    ),
  );

  it.effect("refuses a turn walkthrough for a thread that never ran", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const error = yield* service
        .publish({ threadId, walkthrough: { title: "Turn", scope: "turn", sections: [section] } })
        .pipe(Effect.flip);
      expect(error._tag).toBe("WalkthroughNoTurnError");
    }).pipe(
      Effect.provide(
        layerFor({ shell: McpToolAccessTestkit.liveThreadShell(threadId, { activeRunId: null }) }),
      ),
    ),
  );

  it.effect("publishes without a head commit when git is unavailable", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const published = yield* service.publish({
        threadId,
        walkthrough: { title: "Policy", sections: [section] },
      });
      expect(published.headCommit).toBeUndefined();
    }).pipe(Effect.provide(layerFor({ git: "error" }))),
  );

  it.effect("ignores a head that is not a commit sha", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const published = yield* service.publish({
        threadId,
        walkthrough: { title: "Policy", sections: [section] },
      });
      expect(published.headCommit).toBeUndefined();
    }).pipe(Effect.provide(layerFor({ git: { stdout: "fatal: not a git repository\n" } }))),
  );

  it.effect("rejects a walkthrough the client reader would drop", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const error = yield* service
        .publish({
          threadId,
          walkthrough: { title: "Empty", sections: [{ ...section, files: [] }] },
        })
        .pipe(Effect.flip);
      expect(error._tag).toBe("WalkthroughInvalidError");
    }).pipe(Effect.provide(layerFor({}))),
  );

  it.effect("reports a thread that cannot be read", () =>
    Effect.gen(function* () {
      const service = yield* WalkthroughService.WalkthroughService;
      const error = yield* service
        .publish({ threadId, walkthrough: { title: "Policy", sections: [section] } })
        .pipe(Effect.flip);
      expect(error._tag).toBe("WalkthroughThreadError");
    }).pipe(Effect.provide(layerFor({ shell: "error" }))),
  );
});
