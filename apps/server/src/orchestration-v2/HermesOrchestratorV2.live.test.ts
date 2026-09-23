// Tangent(FORK-HERMES-001): opt-in live test against a real Hermes install.
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { SourceControlProviderRegistry } from "../sourceControl/SourceControlProviderRegistry.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ResetCreditCoordinator from "../provider/Layers/resetCreditCoordinator.ts";
import { FetchHttpClient } from "effect/unstable/http";
import { describe } from "vite-plus/test";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import { ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { AntigravityInstallation } from "../provider/AntigravityInstallation.ts";
import * as ModelManifest from "../provider/ModelManifest.ts";
import { ProviderInstanceRegistryHydrationLive } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import {
  NoOpProviderEventLoggers,
  ProviderEventLoggers,
} from "../provider/Layers/ProviderEventLoggers.ts";
import { OpenCodeRuntimeLive } from "../provider/opencodeRuntime.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { workerLive as ProviderContinuationWorkerLive } from "./ProviderContinuationService.ts";
import { layer as providerContinuationRequestsLayer } from "./ProviderContinuationRequests.ts";
import { makeHermesGatewayRuntime } from "../provider/hermes/HermesGatewayRuntime.ts";
import { makeHermesGatewayUtility } from "../provider/hermes/HermesGatewayUtility.ts";
import { HERMES_MIN_GATEWAY_CONTRACT } from "../provider/hermes/HermesGatewaySupport.ts";
import { layer as idAllocatorLayer, IdAllocatorV2 } from "./IdAllocator.ts";
import { makeHermesAdapterV2 } from "./Adapters/HermesAdapterV2.ts";
import { ProviderAdapterV2RuntimePolicy } from "./ProviderAdapter.ts";
import { worktreeRepairDependenciesTestLayer } from "./ProviderTurnStartService.testkit.ts";
import { runDaemonWithOptions as runEffectWorkerDaemonWithOptions } from "./EffectWorker.ts";
import { OrchestrationV2LayerLive } from "./runtimeLayer.ts";
import { layer as mcpSessionRegistryTestLayer } from "../mcp/McpSessionRegistry.testkit.ts";

const PlatformTestLayer = Layer.merge(
  NodeServices.layer,
  Layer.mock(SourceControlProviderRegistry)({ resolveLink: () => Effect.die("unused title link") }),
);

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-hermes-v2-live-",
});

const vcsDriverRegistryLayer = VcsDriverRegistry.layer.pipe(
  Layer.provide(VcsProcess.layer),
  Layer.provide(serverConfigLayer),
  Layer.provide(PlatformTestLayer),
);

const checkpointStoreLayer = CheckpointStore.layer.pipe(Layer.provide(vcsDriverRegistryLayer));

/**
 * Opt-in: runs the real `hermes` against a configured profile on this host.
 * T3_HERMES_LIVE_ORCHESTRATOR=1 enables it; T3_HERMES_LIVE_PROFILE picks the
 * profile (default "default"), T3_HERMES_LIVE_BINARY the binary.
 */
const HERMES_INSTANCE_ID = ProviderInstanceId.make("hermes_live");
const HERMES_MODEL_SELECTION: ModelSelection = { instanceId: HERMES_INSTANCE_ID, model: "default" };

const serverSettingsLayer = ServerSettingsService.layerTest({
  providerInstances: {
    [HERMES_INSTANCE_ID]: {
      driver: "hermes",
      config: {
        profile: process.env.T3_HERMES_LIVE_PROFILE ?? "default",
        binaryPath: process.env.T3_HERMES_LIVE_BINARY ?? "hermes",
      },
    },
  },
});
const backgroundPolicyLayer = BackgroundPolicy.layer.pipe(
  Layer.provide(Layer.effect(HostPowerMonitor.HostPowerMonitor, HostPowerMonitor.make())),
  Layer.provide(serverSettingsLayer),
);
const providerInstanceRegistryLayer = ProviderInstanceRegistryHydrationLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      serverConfigLayer.pipe(Layer.provide(PlatformTestLayer)),
      serverSettingsLayer,
      ServerSecretStore.layer.pipe(
        Layer.provide(serverConfigLayer),
        Layer.provide(PlatformTestLayer),
      ),
      NodeServices.layer,
      FetchHttpClient.layer,
      OpenCodeRuntimeLive.pipe(Layer.provide(PlatformTestLayer)),
      Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers),
      ModelManifest.layerTest,
      AntigravityInstallation.layer.pipe(
        Layer.provide(serverConfigLayer.pipe(Layer.provide(PlatformTestLayer))),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(PlatformTestLayer),
      ),
    ),
  ),
);

// The production layer adds the continuation worker; Hermes's background
// wake turns (async delegation results) need it.
const liveLayer = Layer.provideMerge(
  ProviderContinuationWorkerLive.pipe(
    Layer.provide(Layer.mergeAll(providerContinuationRequestsLayer, idAllocatorLayer)),
  ),
  OrchestrationV2LayerLive,
).pipe(
  Layer.provide(worktreeRepairDependenciesTestLayer),
  Layer.provide(mcpSessionRegistryTestLayer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(checkpointStoreLayer),
  Layer.provide(serverConfigLayer),
  Layer.provide(serverSettingsLayer),
  Layer.provide(providerInstanceRegistryLayer),
  Layer.provide(ResetCreditCoordinator.layer),
  Layer.provide(backgroundPolicyLayer),
  Layer.provide(PlatformTestLayer),
);

const waitForIdle = Effect.fn("HermesOrchestratorV2Live.waitForIdle")(function* (
  threadId: ThreadId,
) {
  const orchestrator = yield* OrchestratorV2;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const projection = yield* orchestrator.getThreadProjection(threadId);
    if (
      projection.runs.length > 0 &&
      projection.runs.every(
        (run) => !["queued", "starting", "running", "waiting"].includes(run.status),
      )
    ) {
      return projection;
    }
    yield* Effect.sleep("500 millis");
  }
  return yield* Effect.die(new Error(`Timed out waiting for Hermes thread ${threadId}.`));
});

describe.runIf(process.env.T3_HERMES_LIVE_ORCHESTRATOR === "1")(
  "Hermes V2 live orchestrator",
  () => {
    it.live(
      "runs and resumes turns on the real Hermes gateway",
      () =>
        Effect.gen(function* () {
          yield* runEffectWorkerDaemonWithOptions({ concurrency: 2 }).pipe(Effect.forkScoped);
          const orchestrator = yield* OrchestratorV2;
          const threadId = ThreadId.make("thread:hermes-live");
          const marker = "HERMES_LIVE_MARKER_4K2P";

          yield* orchestrator.dispatch({
            type: "thread.create",
            createdBy: "user",
            creationSource: "web",
            commandId: CommandId.make("command:hermes-live:create"),
            threadId,
            projectId: ProjectId.make("project:hermes-live"),
            title: "Hermes live",
            modelSelection: HERMES_MODEL_SELECTION,
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: process.cwd(),
          });
          const send = (id: string, text: string) =>
            orchestrator.dispatch({
              type: "message.dispatch",
              createdBy: "user",
              creationSource: "web",
              commandId: CommandId.make(`command:hermes-live:${id}`),
              threadId,
              messageId: MessageId.make(`message:hermes-live:${id}`),
              text,
              attachments: [],
              modelSelection: HERMES_MODEL_SELECTION,
              dispatchMode: { type: "start_immediately" },
            });

          yield* send("first", `Remember this marker. Respond with exactly: ${marker}`);
          yield* waitForIdle(threadId);
          yield* Console.log("Hermes live first turn completed.");
          yield* send("second", "Repeat the marker from your previous reply, and nothing else.");
          const projection = yield* waitForIdle(threadId);

          const assistantText = (value: OrchestrationV2ThreadProjection) =>
            value.messages
              .filter((message) => message.role === "assistant")
              .map((message) => message.text)
              .join("\n");
          assert.deepEqual(
            projection.runs.map((run) => [run.providerInstanceId, run.status]),
            [
              [HERMES_INSTANCE_ID, "completed"],
              [HERMES_INSTANCE_ID, "completed"],
            ],
          );
          assert.include(assistantText(projection), marker);
          const providerThread = projection.providerThreads[0];
          assert.match(providerThread?.nativeThreadRef?.nativeId ?? "", /^\d{8}_\d{6}_/);
        }).pipe(Effect.provide(liveLayer), Effect.scoped),
      360_000,
    );

    it.live(
      "settles an async delegation into an openable child thread",
      () =>
        Effect.gen(function* () {
          yield* runEffectWorkerDaemonWithOptions({ concurrency: 2 }).pipe(Effect.forkScoped);
          const orchestrator = yield* OrchestratorV2;
          const threadId = ThreadId.make("thread:hermes-live-subagent");
          yield* orchestrator.dispatch({
            type: "thread.create",
            createdBy: "user",
            creationSource: "web",
            commandId: CommandId.make("command:hermes-live-subagent:create"),
            threadId,
            projectId: ProjectId.make("project:hermes-live"),
            title: "Hermes live subagent",
            modelSelection: HERMES_MODEL_SELECTION,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: process.cwd(),
          });
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            createdBy: "user",
            creationSource: "web",
            commandId: CommandId.make("command:hermes-live-subagent:send"),
            threadId,
            messageId: MessageId.make("message:hermes-live-subagent:send"),
            text:
              "Use delegate_task to start exactly one subagent with the goal: " +
              "'Reply with the word PINEAPPLE and nothing else.' Do not do the task yourself.",
            attachments: [],
            modelSelection: HERMES_MODEL_SELECTION,
            dispatchMode: { type: "start_immediately" },
          });

          // Hermes reports the result in a turn of its own once the subagent finishes.
          let projection = yield* waitForIdle(threadId);
          for (let attempt = 0; attempt < 600; attempt += 1) {
            if (
              projection.runs.length > 1 &&
              projection.subagents.length > 0 &&
              projection.subagents.every((subagent) => subagent.status === "completed")
            ) {
              break;
            }
            yield* Effect.sleep("500 millis");
            projection = yield* orchestrator.getThreadProjection(threadId);
          }
          projection = yield* waitForIdle(threadId);
          assert.deepEqual(
            projection.runs.map((run) => run.status),
            ["completed", "completed"],
          );
          const subagent = projection.subagents[0];
          assert.equal(subagent?.status, "completed");
          assert.isNotNull(subagent?.childThreadId ?? null);
          const child = yield* orchestrator.getThreadProjection(subagent!.childThreadId!);
          assert.deepEqual(
            child.messages.map((message) => message.role),
            ["user", "assistant"],
          );
          assert.include(child.messages[1]?.text ?? "", "PINEAPPLE");
        }).pipe(Effect.provide(liveLayer), Effect.scoped),
      360_000,
    );
  },
);

/**
 * Gateway-only smoke that needs no model credentials, so it can run against a
 * disposable `HERMES_HOME`: T3_HERMES_LIVE_GATEWAY=1 HERMES_HOME=/tmp/... .
 */
describe.runIf(process.env.T3_HERMES_LIVE_GATEWAY === "1")("Hermes live gateway", () => {
  it.live(
    "starts the isolated backend, describes itself, and opens and closes a session",
    () =>
      Effect.gen(function* () {
        const runtime = yield* makeHermesGatewayRuntime({
          binaryPath: process.env.T3_HERMES_LIVE_BINARY ?? "hermes",
          profile: process.env.T3_HERMES_LIVE_PROFILE ?? "default",
          environment: { ...process.env },
        });
        const utility = yield* makeHermesGatewayUtility(runtime);
        const setup = yield* utility.getSetupStatus;
        assert.isBoolean(setup.provider_configured);
        const info = yield* utility.readInfo;
        assert.isAtLeast(info?.contract ?? 0, HERMES_MIN_GATEWAY_CONTRACT);

        const adapter = makeHermesAdapterV2({
          instanceId: HERMES_INSTANCE_ID,
          runtime,
          homeDirectory: process.env.HOME,
          idAllocator: yield* IdAllocatorV2,
          serverConfig: yield* ServerConfig,
        });
        const threadId = ThreadId.make("thread:hermes-live-gateway");
        const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
          runtimeMode: "approval-required",
          interactionMode: "default",
          cwd: process.cwd(),
        });
        const created = yield* Effect.scoped(
          Effect.gen(function* () {
            const session = yield* adapter.openSession({
              threadId,
              providerSessionId: ProviderSessionId.make("provider-session:hermes-live-gateway"),
              modelSelection: HERMES_MODEL_SELECTION,
              runtimePolicy,
            });
            return yield* session.ensureThread({
              threadId,
              modelSelection: HERMES_MODEL_SELECTION,
              runtimePolicy,
            });
          }),
        );
        assert.match(created.nativeThreadRef?.nativeId ?? "", /^\d{8}_\d{6}_/);
        yield* Console.log(
          `Hermes ${info?.version ?? "unknown"} contract ${info?.contract ?? "unknown"} update ${info?.updateCommand ?? "none"}`,
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            idAllocatorLayer,
            serverConfigLayer.pipe(Layer.provide(NodeServices.layer)),
          ),
        ),
      ),
    120_000,
  );
});
