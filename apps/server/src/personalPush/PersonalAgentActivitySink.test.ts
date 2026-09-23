import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { PersonalPushActivityPublishRequest } from "@t3tools/contracts/personalPush";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import * as ServerConfig from "../config.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectService } from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Sink from "./PersonalAgentActivitySink.ts";

const THREAD_ID = ThreadId.make("personal-thread");
const PROJECT_ID = ProjectId.make("personal-project");
const NOW = "2026-09-04T12:00:00.000Z";
const decodePublish = Schema.decodeUnknownSync(
  Schema.fromJsonString(PersonalPushActivityPublishRequest),
);
const unused = () => Effect.die("Unexpected test dependency call");

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: THREAD_ID, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "running",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: DateTime.makeUnsafe(NOW),
    updatedAt: DateTime.makeUnsafe(NOW),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

const makeTestSink = Effect.fnUntraced(function* (relay: { url: string; password: string }) {
  const currentShell = yield* Ref.make<OrchestrationV2ThreadShell | null>(shell());
  const publications: Array<{
    readonly url: string;
    readonly authorization: string | null;
    readonly body: typeof PersonalPushActivityPublishRequest.Type;
  }> = [];
  const fetch: typeof globalThis.fetch = Object.assign(
    (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const request = input instanceof Request ? input : null;
      const headers = request?.headers ?? new Headers(init?.headers);
      const body = init?.body;
      const text = typeof body === "string" ? body : new TextDecoder().decode(body as Uint8Array);
      publications.push({
        url: request?.url ?? String(input),
        authorization: headers.get("authorization"),
        body: decodePublish(text),
      });
      return Promise.resolve(Response.json({ ok: true }));
    },
    { preconnect: () => {} },
  );
  const threads = ThreadManagementService.of({
    getThreadShell: () => Ref.get(currentShell),
    getShellSnapshot: unused,
    ensureLegacyTranscript: unused,
    dispatch: unused,
    getTimelinePage: () => Effect.die("Unused timeline read"),
    getMessageCount: () => Effect.die("unused message count"),
    getThreadRecords: () => Effect.die("unused record read"),
    getThreadProjection: unused,
    getCheckpointContext: unused,
    getThreadSnapshot: unused,
    getThreadSnapshotWindow: unused,
    getProjectThreadRecords: () => Effect.die("unused project record read"),
    getProjectThread: unused,
    listProjectThreads: unused,
    sendToThread: unused,
    waitForThread: unused,
    interruptThread: unused,
    getThreadEventSequence: unused,
    streamStoredEvents: Stream.empty,
    streamStoredEventsFrom: () => Stream.empty,
    streamDomainEvents: Stream.empty,
  });
  const sink = yield* Sink.make.pipe(
    Effect.provideService(ThreadManagementService, threads),
    Effect.provideService(ServerEnvironment, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("personal-environment")),
      getDescriptor: unused(),
    }),
    Effect.provideService(ProjectService, {
      create: unused,
      bootstrap: unused,
      update: unused,
      delete: unused,
      getByWorkspaceRoot: unused,
      snapshot: unused(),
      getById: () =>
        Effect.succeed(
          Option.some({
            id: PROJECT_ID,
            title: "Project",
            workspaceRoot: "/workspace",
            defaultModelSelection: null,
            scripts: [],
            createdAt: NOW,
            updatedAt: NOW,
            deletedAt: null,
          }),
        ),
    }),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3code-personal-sink-test-" }),
        ServerSettings.layerTest({ personalPushRelay: relay }),
      ).pipe(Layer.provide(NodeServices.layer)),
    ),
  );
  const publish = (threadId: ThreadId) =>
    Sink.publishThread(threadId).pipe(
      Effect.provideService(Sink.PersonalAgentActivitySink, sink),
      Effect.andThen(sink.drain),
    );
  return { publish, currentShell, publications };
});

describe("PersonalAgentActivitySink", () => {
  it.effect("publishes each meaningful state once with the relay password", () =>
    Effect.gen(function* () {
      const { publish, currentShell, publications } = yield* makeTestSink({
        url: "https://relay.example.test/",
        password: "relay-password",
      });

      yield* publish(THREAD_ID);
      yield* publish(THREAD_ID);
      assert.equal(publications.length, 1);
      assert.equal(publications[0]?.url, "https://relay.example.test/v1/agent-activities");
      assert.equal(publications[0]?.authorization, "Bearer relay-password");
      assert.equal(publications[0]?.body.threadId, THREAD_ID);
      assert.equal(publications[0]?.body.state?.phase, "running");

      yield* Ref.set(currentShell, shell({ title: "Renamed thread" }));
      yield* publish(THREAD_ID);
      assert.equal(publications.length, 2);
      assert.equal(publications[1]?.body.state?.threadTitle, "Renamed thread");
    }),
  );

  it.effect("does nothing when no personal relay is configured", () =>
    Effect.gen(function* () {
      const { publish, publications } = yield* makeTestSink({ url: "", password: "" });
      yield* publish(THREAD_ID);
      assert.equal(publications.length, 0);
    }),
  );

  it("defers transient tombstones and first completions", () => {
    const running = { phase: "running" } as Parameters<typeof Sink.publishIdentity>[0];
    const completed = { phase: "completed" } as Parameters<typeof Sink.publishIdentity>[0];
    assert.isTrue(Sink.requiresConfirmation(null, Sink.publishIdentity(running)));
    assert.isTrue(Sink.requiresConfirmation(null, undefined));
    assert.isFalse(Sink.requiresConfirmation(null, Sink.publishIdentity(null)));
    assert.isTrue(Sink.requiresConfirmation(completed, undefined));
    assert.isFalse(Sink.requiresConfirmation(completed, Sink.publishIdentity(running)));
    assert.isFalse(Sink.requiresConfirmation(running, undefined));
  });

  it("redacts failure details before they leave the server", () => {
    const failed = Sink.sanitizeState({
      phase: "failed",
      detail: "stack trace with /Users/me/secret/path",
    } as Parameters<typeof Sink.sanitizeState>[0]);
    assert.equal(failed?.detail, "The agent run failed.");
  });
});
