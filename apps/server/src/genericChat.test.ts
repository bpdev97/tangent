import * as NodeServices from "@effect/platform-node/NodeServices";
import type { OrchestrationCommand, OrchestrationProjectShell } from "@t3tools/contracts";
import { GENERIC_CHAT_PROJECT_ID, GENERIC_CHAT_PROJECT_TITLE } from "@t3tools/shared/genericChat";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import { ensureGenericChatProject } from "./genericChat.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

function projectionQuery(project: Option.Option<OrchestrationProjectShell>) {
  return ProjectionSnapshotQuery.of({
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: () => Effect.succeed(project),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
    getThreadDetailSnapshot: () => Effect.die("unused"),
    searchThreads: () => Effect.die("unused"),
  });
}

function orchestrationEngine(commands: Ref.Ref<ReadonlyArray<OrchestrationCommand>>) {
  return OrchestrationEngineService.of({
    readEvents: () => Stream.empty,
    dispatch: (command) =>
      Ref.update(commands, (current) => [...current, command]).pipe(Effect.as({ sequence: 1 })),
    latestSequence: Effect.succeed(0),
    streamDomainEvents: Stream.empty,
  });
}

it.effect("creates the managed generic chat workspace and project when missing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-generic-chat-" });
      const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

      const projectId = yield* ensureGenericChatProject().pipe(
        Effect.provideService(ProjectionSnapshotQuery, projectionQuery(Option.none())),
        Effect.provideService(OrchestrationEngineService, orchestrationEngine(commands)),
        Effect.provide(ServerConfig.layerTest(baseDir, baseDir)),
      );

      assert.equal(projectId, GENERIC_CHAT_PROJECT_ID);
      assert.isTrue(yield* fileSystem.exists(path.join(baseDir, "workspaces", "generic-chat")));
      const dispatched = yield* Ref.get(commands);
      assert.equal(dispatched.length, 1);
      assert.deepInclude(dispatched[0], {
        type: "project.create",
        projectId: GENERIC_CHAT_PROJECT_ID,
        title: GENERIC_CHAT_PROJECT_TITLE,
        workspaceRoot: path.join(baseDir, "workspaces", "generic-chat"),
        createWorkspaceRootIfMissing: true,
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("repairs managed generic chat project metadata without replacing its model", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-generic-chat-" });
      const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const existing: OrchestrationProjectShell = {
        id: GENERIC_CHAT_PROJECT_ID,
        title: "Renamed",
        workspaceRoot: "/tmp/old-chat-root",
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      yield* ensureGenericChatProject().pipe(
        Effect.provideService(ProjectionSnapshotQuery, projectionQuery(Option.some(existing))),
        Effect.provideService(OrchestrationEngineService, orchestrationEngine(commands)),
        Effect.provide(ServerConfig.layerTest(baseDir, baseDir)),
      );

      const dispatched = yield* Ref.get(commands);
      assert.equal(dispatched.length, 1);
      assert.deepInclude(dispatched[0], {
        type: "project.meta.update",
        projectId: GENERIC_CHAT_PROJECT_ID,
        title: GENERIC_CHAT_PROJECT_TITLE,
        workspaceRoot: path.join(baseDir, "workspaces", "generic-chat"),
      });
      assert.notProperty(dispatched[0], "defaultModelSelection");
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("does not dispatch when the managed generic chat project is already current", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-generic-chat-" });
      const workspaceRoot = path.join(baseDir, "workspaces", "generic-chat");
      const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const existing: OrchestrationProjectShell = {
        id: GENERIC_CHAT_PROJECT_ID,
        title: GENERIC_CHAT_PROJECT_TITLE,
        workspaceRoot,
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      yield* ensureGenericChatProject().pipe(
        Effect.provideService(ProjectionSnapshotQuery, projectionQuery(Option.some(existing))),
        Effect.provideService(OrchestrationEngineService, orchestrationEngine(commands)),
        Effect.provide(ServerConfig.layerTest(baseDir, baseDir)),
      );

      assert.deepEqual(yield* Ref.get(commands), []);
      assert.isTrue(yield* fileSystem.exists(workspaceRoot));
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);
