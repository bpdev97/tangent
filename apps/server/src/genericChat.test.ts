import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { GENERIC_CHAT_PROJECT_ID } from "@t3tools/shared/genericChat";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as CheckpointStore from "./checkpointing/CheckpointStore.ts";
import { ServerConfig } from "./config.ts";
import {
  ensureGenericChatProject,
  genericChatCheckpointStoreLayer,
  genericChatProviderText,
  genericChatWorkspaceRoot,
} from "./genericChat.ts";
import {
  CheckpointServiceV2,
  layer as checkpointServiceLayer,
} from "./orchestration-v2/CheckpointService.ts";
import { layer as idAllocatorLayer } from "./orchestration-v2/IdAllocator.ts";
import * as RuntimePolicy from "./orchestration-v2/RuntimePolicy.ts";
import { ProjectServiceLayerLive } from "./orchestration-v2/runtimeLayer.ts";
import { ProjectionProjectRepositoryLive } from "./persistence/Layers/ProjectionProjects.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as ProjectEnrichmentService from "./project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./project/ProjectFaviconResolver.ts";
import * as ProjectService from "./project/ProjectService.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";

const TestLayer = ProjectServiceLayerLive.pipe(
  Layer.provideMerge(ProjectionProjectRepositoryLive),
  Layer.provideMerge(ProjectEnrichmentService.layer),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(
    Layer.merge(
      Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
        resolve: () => Effect.succeed(null),
      }),
      Layer.mock(ProjectFaviconResolver.ProjectFaviconResolver)({
        resolvePath: () => Effect.succeed(null),
      }),
    ),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "generic-chat-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const ensure = ensureGenericChatProject();

it.layer(TestLayer)("generic chat project", (it) => {
  it.effect(
    "is created once at the scratch workspace, then repaired without losing its model",
    () =>
      Effect.gen(function* () {
        const projects = yield* ProjectService.ProjectService;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { baseDir } = yield* ServerConfig;
        const workspaceRoot = genericChatWorkspaceRoot(path, baseDir);

        assert.equal(yield* ensure, "created");
        assert.equal(yield* ensure, "unchanged");
        const created = Option.getOrThrow(yield* projects.getById(GENERIC_CHAT_PROJECT_ID));
        assert.equal(created.title, "Chats");
        assert.equal(created.workspaceRoot, workspaceRoot);
        assert.equal(workspaceRoot, path.join(baseDir, "workspaces", "generic-chat"));
        assert.isTrue(yield* fileSystem.exists(workspaceRoot));

        // Upstream's runtime policy runs chat providers in the scratch directory.
        const policy = yield* Effect.gen(function* () {
          return yield* (yield* RuntimePolicy.RuntimePolicyV2).resolve({
            thread: {
              projectId: GENERIC_CHAT_PROJECT_ID,
              worktreePath: null,
              runtimeMode: "approval-required",
              interactionMode: "default",
            } as never,
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          });
        }).pipe(Effect.provide(RuntimePolicy.layerFromProjectRepository));
        assert.equal(policy.cwd, workspaceRoot);

        const elsewhere = path.join(baseDir, "elsewhere");
        yield* fileSystem.makeDirectory(elsewhere, { recursive: true });
        const modelSelection = {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        } as const;
        yield* projects.update({
          commandId: CommandId.make("command:generic-chat-test:drift"),
          projectId: GENERIC_CHAT_PROJECT_ID,
          title: "Renamed",
          workspaceRoot: elsewhere,
          defaultModelSelection: modelSelection,
        });
        yield* fileSystem.remove(workspaceRoot, { recursive: true });

        assert.equal(yield* ensure, "repaired");
        const repaired = Option.getOrThrow(yield* projects.getById(GENERIC_CHAT_PROJECT_ID));
        assert.equal(repaired.title, "Chats");
        assert.equal(repaired.workspaceRoot, workspaceRoot);
        assert.deepEqual(repaired.defaultModelSelection, modelSelection);
        assert.isTrue(yield* fileSystem.exists(workspaceRoot));
        assert.equal(yield* ensure, "unchanged");
      }),
  );

  it.effect("cannot be deleted, because its reserved ID could never be created again", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectService.ProjectService;
      yield* ensure;

      const error = yield* projects
        .delete({
          commandId: CommandId.make("command:generic-chat-test:delete"),
          projectId: GENERIC_CHAT_PROJECT_ID,
          force: true,
        })
        .pipe(Effect.flip);

      assert.equal(error._tag, "ProjectOperationError");
      assert.isTrue(Option.isSome(yield* projects.getById(GENERIC_CHAT_PROJECT_ID)));
    }),
  );

  it.effect("is never checkpointed, even when its scratch directory is nested in Git", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const { baseDir } = yield* ServerConfig;
      yield* ensure;
      let captures = 0;
      // Git detection walks up the tree, so a nested scratch directory reads as
      // a repository (see CheckpointStore.test.ts).
      const nestedInGit = Layer.mock(CheckpointStore.CheckpointStore)({
        isGitRepository: () => Effect.succeed(true),
        hasCheckpointRef: () => Effect.succeed(false),
        captureCheckpoint: () =>
          Effect.sync(() => {
            captures += 1;
          }),
      });
      const checkpoints = checkpointServiceLayer.pipe(
        Layer.provide(idAllocatorLayer),
        Layer.provide(genericChatCheckpointStoreLayer.pipe(Layer.provide(nestedInGit))),
      );

      yield* Effect.gen(function* () {
        const service = yield* CheckpointServiceV2;
        const guardedStore = yield* CheckpointStore.CheckpointStore;
        const workspaceRoot = genericChatWorkspaceRoot(path, baseDir);
        const scope = yield* service.prepareRootRunScope({
          threadId: ThreadId.make("thread:generic-chat-test"),
          runId: RunId.make("run:generic-chat-test"),
          rootNodeId: NodeId.make("node:generic-chat-test"),
          providerThreadId: ProviderThreadId.make("provider-thread:generic-chat-test"),
          cwd: workspaceRoot,
          createdAt: yield* DateTime.now,
        });
        yield* service.captureBaseline({ scope, ordinalWithinScope: 0 });
        const checkpoint = yield* service.capture({
          scope,
          runId: RunId.make("run:generic-chat-test"),
          nodeId: NodeId.make("node:generic-chat-test"),
          ordinalWithinScope: 1,
          appRunOrdinal: 1,
          capturedAt: yield* DateTime.now,
        });

        assert.equal(checkpoint.status, "missing");
        assert.equal(captures, 0);
        assert.isFalse(yield* guardedStore.isGitRepository(workspaceRoot));
        assert.isTrue(yield* guardedStore.isGitRepository(path.join(baseDir, "project")));
      }).pipe(
        Effect.provide(
          Layer.merge(
            checkpoints,
            genericChatCheckpointStoreLayer.pipe(Layer.provide(nestedInGit)),
          ),
        ),
      );
    }),
  );
});

it("wraps provider text for chat turns only, and leaves slash commands verbatim", () => {
  const chat = { projectId: GENERIC_CHAT_PROJECT_ID };
  const project = { projectId: ProjectId.make("project:regular") };
  const noAttachments: ReadonlyArray<unknown> = [];

  const wrapped = genericChatProviderText({
    thread: chat,
    message: { text: "Plan my week", attachments: noAttachments },
    providerText: "Plan my week",
  });
  assert.isTrue(wrapped.startsWith("<user_message>\nPlan my week\n</user_message>"));
  assert.include(wrapped, "No user project, repository, or working directory is attached");

  assert.equal(
    genericChatProviderText({
      thread: project,
      message: { text: "Plan my week", attachments: noAttachments },
      providerText: "Plan my week",
    }),
    "Plan my week",
  );

  const attachmentOnly = genericChatProviderText({
    thread: chat,
    message: { text: "", attachments: [{ type: "image" }] },
    providerText: "",
  });
  assert.include(attachmentOnly, "general chat session");

  assert.equal(
    genericChatProviderText({
      thread: chat,
      message: { text: "/compact", attachments: noAttachments },
      providerText: "/compact",
    }),
    "/compact",
  );
});
