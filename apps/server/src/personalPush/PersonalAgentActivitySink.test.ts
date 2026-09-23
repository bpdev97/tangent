import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthSessionId,
  type BackgroundPolicySnapshot,
  type ClientActivityLease,
  EnvironmentId,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  RpcClientId,
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
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as TestClock from "effect/testing/TestClock";

import { BackgroundPolicy } from "../background/BackgroundPolicy.ts";
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

/** A client report as the background policy holds it, stamped at the test clock's start. */
function lease(overrides: Partial<ClientActivityLease> = {}): ClientActivityLease {
  return {
    sessionId: AuthSessionId.make("session"),
    rpcClientId: RpcClientId.make(1),
    clientId: "client",
    clientKind: "desktop-renderer",
    visible: true,
    focused: true,
    recentlyInteracted: true,
    scopes: [],
    updatedAt: DateTime.makeUnsafe(0),
    expiresAt: DateTime.makeUnsafe(45_000),
    ...overrides,
  };
}

function policySnapshot(leases: ReadonlyArray<ClientActivityLease>): BackgroundPolicySnapshot {
  return {
    hostPower: {} as BackgroundPolicySnapshot["hostPower"],
    leases,
    activeForegroundLeaseCount: leases.length,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: DateTime.makeUnsafe(0),
  };
}

const makeTestSink = Effect.fnUntraced(function* (
  relay: { url: string; password: string; quietAfterDesktopActivityMinutes?: number },
  leases: ReadonlyArray<ClientActivityLease> = [],
) {
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
    getTurnItem: unused,
    stopDelegatedTasks: unused,
    recoverDelegatedTask: unused,
    delegatedTaskResultPending: unused,
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
      getShell: unused,
      listShells: unused,
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
    Effect.provideService(
      BackgroundPolicy,
      BackgroundPolicy.of({
        reportClientActivity: unused,
        removeRpcClient: unused,
        reportHostPowerState: unused,
        snapshot: unused(),
        streamChanges: Stream.make(policySnapshot(leases)),
        subscribe: unused(),
        hasDemand: unused,
        shouldRunScopeWork: unused,
        shouldRunOpportunisticWork: unused(),
      }),
    ),
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
  /** Lets a held publish reach its deadline and go out. */
  const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
    TestClock.adjust(duration).pipe(Effect.andThen(sink.drain));
  return { publish, advance, currentShell, publications };
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

  it("holds tombstones and completions, and nothing that blocks the agent", () => {
    const state = (phase: string) => ({ phase }) as Parameters<typeof Sink.publishIdentity>[0];
    const running = Sink.publishIdentity(state("running"));
    assert.equal(Sink.confirmationDelayMs(null, running), 5_000);
    assert.equal(Sink.confirmationDelayMs(null, undefined), 5_000);
    assert.equal(Sink.confirmationDelayMs(null, Sink.publishIdentity(null)), 0);
    assert.equal(Sink.confirmationDelayMs(state("completed"), undefined), 10_000);
    assert.equal(Sink.confirmationDelayMs(state("completed"), running), 10_000);
    assert.equal(Sink.confirmationDelayMs(state("running"), undefined), 0);
    assert.equal(Sink.confirmationDelayMs(state("failed"), running), 0);
    assert.equal(Sink.confirmationDelayMs(state("waiting_for_approval"), running), 0);
    assert.equal(Sink.confirmationDelayMs(state("waiting_for_input"), running), 0);
  });

  it.effect("publishes a completion only after it has held for ten seconds", () =>
    Effect.gen(function* () {
      const { publish, advance, currentShell, publications } = yield* makeTestSink({
        url: "https://relay.example.test/",
        password: "relay-password",
      });
      yield* publish(THREAD_ID);

      yield* Ref.set(currentShell, shell({ status: "completed" }));
      yield* publish(THREAD_ID);
      yield* advance("9 seconds");
      assert.deepEqual(
        publications.map((publication) => publication.body.state?.phase),
        ["running"],
      );

      yield* advance("1 second");
      assert.deepEqual(
        publications.map((publication) => publication.body.state?.phase),
        ["running", "completed"],
      );
    }),
  );

  it.effect("drops a completion when the thread is working again inside the hold", () =>
    Effect.gen(function* () {
      const { publish, advance, currentShell, publications } = yield* makeTestSink({
        url: "https://relay.example.test/",
        password: "relay-password",
      });
      yield* publish(THREAD_ID);

      yield* Ref.set(currentShell, shell({ status: "completed" }));
      yield* publish(THREAD_ID);
      yield* advance("3 seconds");
      yield* Ref.set(currentShell, shell());
      yield* publish(THREAD_ID);
      yield* advance("30 seconds");
      assert.deepEqual(
        publications.map((publication) => publication.body.state?.phase),
        ["running"],
      );

      // A later completion gets a full hold of its own, not the stale deadline.
      yield* Ref.set(currentShell, shell({ status: "completed" }));
      yield* publish(THREAD_ID);
      yield* advance("9 seconds");
      assert.equal(publications.length, 1);
      yield* advance("1 second");
      assert.equal(publications.at(-1)?.body.state?.phase, "completed");
    }),
  );

  it.effect("gives a second run's completion its own hold when the first was never cleared", () =>
    Effect.gen(function* () {
      const { publish, advance, currentShell, publications } = yield* makeTestSink({
        url: "https://relay.example.test/",
        password: "relay-password",
      });
      const completedRun = (run: string, completedAtMs: number) =>
        shell({
          status: "completed",
          latestRunId: run as OrchestrationV2ThreadShell["latestRunId"],
          latestRunCompletedAt: DateTime.makeUnsafe(completedAtMs),
        });
      yield* publish(THREAD_ID);
      yield* Ref.set(currentShell, completedRun("run-1", 0));
      yield* publish(THREAD_ID);

      // The thread resumes and finishes again while the worker is busy with
      // other threads, so the sink never sees it running in between.
      yield* advance("9 seconds");
      yield* Ref.set(currentShell, completedRun("run-2", 9_000));
      yield* advance("1 second");
      assert.equal(publications.length, 1);

      yield* advance("9 seconds");
      assert.equal(publications.length, 1);
      yield* advance("1 second");
      assert.equal(publications.at(-1)?.body.state?.phase, "completed");
    }),
  );

  it.effect("keeps a completion's deadline when the thread is renamed during the hold", () =>
    Effect.gen(function* () {
      const { publish, advance, currentShell, publications } = yield* makeTestSink({
        url: "https://relay.example.test/",
        password: "relay-password",
      });
      yield* publish(THREAD_ID);
      yield* Ref.set(currentShell, shell({ status: "completed" }));
      yield* publish(THREAD_ID);
      yield* advance("5 seconds");
      yield* Ref.set(currentShell, shell({ status: "completed", title: "Renamed thread" }));
      yield* publish(THREAD_ID);
      yield* advance("5 seconds");
      assert.equal(publications.length, 2);
      assert.equal(publications[1]?.body.state?.phase, "completed");
      assert.equal(publications[1]?.body.state?.threadTitle, "Renamed thread");
    }),
  );

  it.effect("waits the tombstone delay, then a full hold if the thread completes instead", () =>
    Effect.gen(function* () {
      const { publish, advance, currentShell, publications } = yield* makeTestSink({
        url: "https://relay.example.test/",
        password: "relay-password",
      });
      yield* publish(THREAD_ID);
      yield* Ref.set(currentShell, null);
      yield* publish(THREAD_ID);
      yield* advance("4 seconds");
      assert.equal(publications.length, 1);

      // The thread reappears completed: the tombstone's deadline must not publish it early.
      yield* Ref.set(currentShell, shell({ status: "completed" }));
      yield* advance("1 second");
      assert.equal(publications.length, 1);
      yield* advance("10 seconds");
      assert.equal(publications.at(-1)?.body.state?.phase, "completed");

      yield* Ref.set(currentShell, null);
      yield* publish(THREAD_ID);
      yield* advance("5 seconds");
      assert.isNull(publications.at(-1)?.body.state);
    }),
  );

  it.effect("does not hold an approval request", () =>
    Effect.gen(function* () {
      const { publish, currentShell, publications } = yield* makeTestSink(
        { url: "https://relay.example.test/", password: "relay-password" },
        [lease()],
      );
      yield* publish(THREAD_ID);
      yield* Ref.set(
        currentShell,
        shell({
          pendingRuntimeRequest: {
            kind: "command",
          } as OrchestrationV2ThreadShell["pendingRuntimeRequest"],
        }),
      );
      yield* publish(THREAD_ID);
      assert.equal(publications.at(-1)?.body.state?.phase, "waiting_for_approval");
      // Blocking requests alert even while the user is at the desktop.
      assert.isUndefined(publications.at(-1)?.body.silent);
    }),
  );

  it.effect("silences a completion while the user was just active on the desktop", () =>
    Effect.gen(function* () {
      const { publish, advance, currentShell, publications } = yield* makeTestSink(
        {
          url: "https://relay.example.test/",
          password: "relay-password",
          quietAfterDesktopActivityMinutes: 2,
        },
        [lease()],
      );
      yield* publish(THREAD_ID);
      yield* Ref.set(currentShell, shell({ status: "completed" }));
      yield* publish(THREAD_ID);
      yield* advance("10 seconds");
      assert.equal(publications.at(-1)?.body.state?.phase, "completed");
      assert.isTrue(publications.at(-1)?.body.silent);

      // Past the window the same desktop report no longer counts.
      yield* Ref.set(currentShell, shell());
      yield* publish(THREAD_ID);
      yield* advance("3 minutes");
      yield* Ref.set(currentShell, shell({ status: "failed" }));
      yield* publish(THREAD_ID);
      assert.equal(publications.at(-1)?.body.state?.phase, "failed");
      assert.isUndefined(publications.at(-1)?.body.silent);
    }),
  );

  it.effect("alerts as usual when the quiet window is off", () =>
    Effect.gen(function* () {
      const { publish, currentShell, publications } = yield* makeTestSink(
        {
          url: "https://relay.example.test/",
          password: "relay-password",
          quietAfterDesktopActivityMinutes: 0,
        },
        [lease()],
      );
      yield* publish(THREAD_ID);
      yield* Ref.set(currentShell, shell({ status: "failed" }));
      yield* publish(THREAD_ID);
      assert.equal(publications.at(-1)?.body.state?.phase, "failed");
      assert.isUndefined(publications.at(-1)?.body.silent);
    }),
  );

  it("reads desktop activity only from interacting desktop and web clients", () => {
    const at = (ms: number) => DateTime.makeUnsafe(ms);
    assert.isNull(Sink.latestDesktopInteractionMs([]));
    assert.isNull(
      Sink.latestDesktopInteractionMs([
        lease({ clientKind: "mobile", updatedAt: at(9_000) }),
        lease({ recentlyInteracted: false, updatedAt: at(8_000) }),
      ]),
    );
    assert.equal(
      Sink.latestDesktopInteractionMs([
        lease({ clientKind: "web", updatedAt: at(5_000) }),
        lease({ updatedAt: at(7_000) }),
        lease({ clientKind: "mobile", updatedAt: at(9_000) }),
      ]),
      7_000,
    );
  });

  it("redacts failure details before they leave the server", () => {
    const failed = Sink.sanitizeState({
      phase: "failed",
      detail: "stack trace with /Users/me/secret/path",
    } as Parameters<typeof Sink.sanitizeState>[0]);
    assert.equal(failed?.detail, "The agent run failed.");
  });
});
