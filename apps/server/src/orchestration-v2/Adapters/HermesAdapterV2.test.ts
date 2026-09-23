import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CheckpointId,
  NodeId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { IdAllocatorV2, layer as idAllocatorLayer } from "../IdAllocator.ts";
import {
  ProviderAdapterV2RuntimePolicy,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2SessionRuntime,
} from "../ProviderAdapter.ts";
import type { ProviderContinuationRequest } from "../ProviderContinuationRequests.ts";
import {
  bufferHermesBackgroundItem,
  type HermesBackgroundBuffer,
} from "../../provider/hermes/HermesBackgroundTurns.ts";
import {
  HERMES_FIXTURE_CWD,
  HERMES_FIXTURE_STORED_ID,
  normalTurn,
  recorded,
  serverRequests,
  subagentEvents,
  toolTurn,
} from "./HermesAdapterV2.fixtures.ts";
import {
  hermesClarifyAnswer,
  hermesFinalTail,
  makeHermesAdapterV2,
  parseHermesCommandOutcome,
} from "./HermesAdapterV2.ts";
import {
  makeFakeHermesGateway,
  rpcError,
  type FakeHermesGateway,
} from "./HermesAdapterV2.testkit.ts";

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-hermes-v2-adapter-",
}).pipe(Layer.provide(NodeServices.layer));
const testLayer = Layer.mergeAll(NodeServices.layer, idAllocatorLayer, serverConfigLayer);

const INSTANCE_ID = ProviderInstanceId.make("hermes_research");
const THREAD_ID = ThreadId.make("thread-hermes-test");
const SESSION_ID = ProviderSessionId.make("provider-session-hermes-test");
const RESUMED_LIVE_ID = recorded.sessionResume.session_id;

const policy = (runtimeMode: RuntimeMode = "approval-required") =>
  ProviderAdapterV2RuntimePolicy.make({
    runtimeMode,
    interactionMode: "default",
    cwd: HERMES_FIXTURE_CWD,
  });

const selection = (model = "default"): ModelSelection => ({ instanceId: INSTANCE_ID, model });

const openRuntime = Effect.fnUntraced(function* (
  fake: FakeHermesGateway,
  runtimeMode: RuntimeMode = "approval-required",
) {
  const continuations = yield* Queue.unbounded<ProviderContinuationRequest>();
  const adapter = makeHermesAdapterV2({
    instanceId: INSTANCE_ID,
    runtime: fake.runtime,
    homeDirectory: "/home/test",
    idAllocator: yield* IdAllocatorV2,
    serverConfig: yield* ServerConfig,
    continuationRequests: {
      offer: (request) => Queue.offer(continuations, request).pipe(Effect.asVoid),
    },
  });
  const runtime = yield* adapter.openSession({
    threadId: THREAD_ID,
    providerSessionId: SESSION_ID,
    modelSelection: selection(),
    runtimePolicy: policy(runtimeMode),
  });
  const emitted = yield* Queue.unbounded<ProviderAdapterV2Event>();
  const streamEnd = yield* runtime.events.pipe(
    Stream.runForEach((event) => Queue.offer(emitted, event)),
    Effect.exit,
    Effect.forkScoped,
  );
  const takeEvent = <E extends ProviderAdapterV2Event>(
    predicate: (event: ProviderAdapterV2Event) => event is E,
  ) =>
    Effect.gen(function* () {
      while (true) {
        const event = yield* Queue.take(emitted);
        if (predicate(event)) return event;
      }
    });
  return { runtime, takeEvent, streamEnd, continuations };
});

const makeAppThread = Effect.fnUntraced(function* () {
  const now = yield* DateTime.now;
  return {
    createdBy: "user",
    creationSource: "web",
    id: THREAD_ID,
    projectId: "project:fixture:hermes" as OrchestrationV2AppThread["projectId"],
    title: "Hermes test thread",
    providerInstanceId: INSTANCE_ID,
    modelSelection: selection(),
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  } satisfies OrchestrationV2AppThread;
});

const startTurn = Effect.fnUntraced(function* (
  runtime: ProviderAdapterV2SessionRuntime,
  providerThread: OrchestrationV2ProviderThread,
  text = "Hello Hermes",
  options: {
    readonly runOrdinal?: number;
    readonly model?: string;
    readonly runtimeMode?: RuntimeMode;
    /** Start the run ProviderContinuationService creates for an adapter-buffered wake. */
    readonly continuation?: boolean;
  } = {},
) {
  const runOrdinal = options.runOrdinal ?? 1;
  const runId = runIdFor(runOrdinal);
  yield* runtime.startTurn({
    appThread: yield* makeAppThread(),
    threadId: THREAD_ID,
    runId,
    runOrdinal,
    providerTurnOrdinal: runOrdinal,
    attemptId: RunAttemptId.make(`run-attempt:${runId}:1`),
    rootNodeId: NodeId.make(`node:${runId}:root`),
    providerThread,
    message: {
      messageId: `message:${THREAD_ID}:${runOrdinal}` as never,
      text,
      attachments: [],
      ...(options.continuation
        ? { createdBy: "agent" as const, creationSource: "provider" as const }
        : { createdBy: "user" as const, creationSource: "web" as const }),
    },
    modelSelection: selection(options.model),
    runtimePolicy: policy(options.runtimeMode),
  });
});

const runIdFor = (runOrdinal: number) => RunId.make(`run:${THREAD_ID}:${runOrdinal}`);

/** Hermes asks for a bridge T3 refuses; the refusal proves earlier frames were handled. */
const drainInbox = Effect.fnUntraced(function* (fake: FakeHermesGateway) {
  yield* fake.takeReply(yield* fake.request("preview.read", {}));
});

const isFinalMessage = (
  event: ProviderAdapterV2Event,
): event is Extract<ProviderAdapterV2Event, { type: "message.updated" }> =>
  event.type === "message.updated" && !event.message.streaming;

/** A turn Hermes runs on its own after background work finishes. */
const backgroundTurn = [
  { type: "status.update", payload: { kind: "process", text: "Process proc_1 finished (exit 0)" } },
  { type: "message.start", payload: {} },
  { type: "message.delta", payload: { text: "The build " } },
  { type: "message.delta", payload: { text: "finished." } },
  { type: "message.complete", payload: { text: "The build finished.", status: "complete" } },
] as const;

const is =
  <T extends ProviderAdapterV2Event["type"]>(type: T) =>
  (event: ProviderAdapterV2Event): event is Extract<ProviderAdapterV2Event, { type: T }> =>
    event.type === type;

const isTurnItem =
  <T extends string>(type: T, status?: string) =>
  (
    event: ProviderAdapterV2Event,
  ): event is Extract<ProviderAdapterV2Event, { type: "turn_item.updated" }> =>
    event.type === "turn_item.updated" &&
    event.turnItem.type === type &&
    (status === undefined || event.turnItem.status === status);

const ensureThread = (runtime: ProviderAdapterV2SessionRuntime, runtimeMode?: RuntimeMode) =>
  runtime.ensureThread({
    threadId: THREAD_ID,
    modelSelection: selection(),
    runtimePolicy: policy(runtimeMode),
  });

describe("HermesAdapterV2", () => {
  it.effect("creates a Hermes session and runs a normal turn", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      assert.equal(fake.connections(), 1);
      const providerThread = yield* ensureThread(runtime);
      const create = yield* fake.takeRpc("session.create");
      assert.deepStrictEqual(create.params, {
        cwd: HERMES_FIXTURE_CWD,
        source: "t3-code",
        close_on_disconnect: true,
      });
      assert.equal(providerThread.nativeThreadRef?.nativeId, HERMES_FIXTURE_STORED_ID);

      yield* startTurn(runtime, providerThread);
      const submit = yield* fake.takeRpc("prompt.submit");
      assert.deepStrictEqual(submit.params, { session_id: "be7c8fa9", text: "Hello Hermes" });
      yield* fake.events(normalTurn);

      const reasoning = yield* takeEvent(isTurnItem("reasoning", "completed"));
      assert.equal(
        reasoning.turnItem.type === "reasoning" && reasoning.turnItem.text,
        "The user wants a greeting.",
      );
      const message = yield* takeEvent(
        (event): event is Extract<ProviderAdapterV2Event, { type: "message.updated" }> =>
          event.type === "message.updated" && !event.message.streaming,
      );
      assert.equal(message.message.text, "Hello from Hermes.");
      const usage = yield* takeEvent(
        (event): event is Extract<ProviderAdapterV2Event, { type: "provider_turn.updated" }> =>
          event.type === "provider_turn.updated" && event.providerTurn.status !== "running",
      );
      assert.equal(usage.providerTurn.status, "completed");
      assert.equal(usage.providerTurn.tokenUsage?.usedTokens, 1250);
      assert.equal(usage.providerTurn.tokenUsage?.maxTokens, 200000);
      assert.equal(usage.providerTurn.tokenUsage?.cachedInputTokens, 800);
      const terminal = yield* takeEvent(is("turn.terminal"));
      assert.equal(terminal.status, "completed");
      assert.equal(fake.activeTurns(), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("publishes tools at start, seals interim commentary, and dedupes the final text", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      yield* fake.takeRpc("prompt.submit");
      yield* fake.events(toolTurn.slice(0, 4));

      const interim = yield* takeEvent(isTurnItem("assistant_message", "completed"));
      assert.equal(
        interim.turnItem.type === "assistant_message" && interim.turnItem.text,
        "Let me check the tests.",
      );
      const running = yield* takeEvent(isTurnItem("command_execution", "running"));
      assert.equal(
        running.turnItem.type === "command_execution" && running.turnItem.input,
        "vp test run",
      );

      yield* fake.events(toolTurn.slice(4));
      const done = yield* takeEvent(isTurnItem("command_execution", "completed"));
      assert.isTrue(
        done.turnItem.type === "command_execution" &&
          done.turnItem.output === "12 passed" &&
          done.turnItem.exitCode === 0,
      );
      const final = yield* takeEvent(isTurnItem("assistant_message", "completed"));
      assert.equal(
        final.turnItem.type === "assistant_message" && final.turnItem.text,
        "All 12 tests pass.",
      );
      assert.notEqual(final.turnItem.id, interim.turnItem.id);
      yield* takeEvent(is("turn.terminal"));
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("maps subagent lifecycle keyed by subagent_id", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      yield* fake.takeRpc("prompt.submit");
      yield* fake.events([{ type: "message.start", payload: {} }, ...subagentEvents]);

      const statuses: Array<string> = [];
      let last: Extract<ProviderAdapterV2Event, { type: "subagent.updated" }> | undefined;
      for (let index = 0; index < subagentEvents.length; index += 1) {
        last = yield* takeEvent(is("subagent.updated"));
        statuses.push(last.subagent.status);
      }
      assert.deepStrictEqual(statuses, ["pending", "running", "running", "completed"]);
      assert.equal(last?.subagent.result, "No issues found.");
      assert.equal(last?.subagent.prompt, "Audit the parser");
      assert.equal(last?.subagent.nativeTaskRef?.nativeId, "sa_1");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("surfaces approvals and answers session scope without Hermes's permanent scope", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      yield* fake.takeRpc("prompt.submit");
      const srq = yield* fake.request("approval", serverRequests.approval);

      const request = yield* takeEvent(is("runtime_request.updated"));
      assert.equal(request.runtimeRequest.kind, "command");
      assert.equal(request.runtimeRequest.nativeRequestRef?.nativeId, "appr_1");
      const item = yield* takeEvent(isTurnItem("approval_request", "waiting"));
      assert.isTrue(
        item.turnItem.type === "approval_request" &&
          item.turnItem.prompt?.includes("rm -rf build") === true &&
          item.turnItem.options?.some((option) => option.decision === "acceptForSession") === true,
      );

      yield* runtime.respondToRuntimeRequest({
        requestId: request.runtimeRequest.id,
        decision: "acceptAlways",
      });
      const reply = yield* fake.takeReply(srq);
      assert.deepStrictEqual(reply.result, { choice: "session" });
      const resolved = yield* takeEvent(is("runtime_request.updated"));
      assert.equal(resolved.runtimeRequest.status, "resolved");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("auto-approves once in full access", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime } = yield* openRuntime(fake, "full-access");
      const providerThread = yield* ensureThread(runtime, "full-access");
      yield* startTurn(runtime, providerThread, "go", { runtimeMode: "full-access" });
      yield* fake.takeRpc("prompt.submit");
      const srq = yield* fake.request("approval", serverRequests.approval);
      const reply = yield* fake.takeReply(srq);
      assert.deepStrictEqual(reply.result, { choice: "once" });
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("answers batched clarifications one question at a time", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      yield* fake.takeRpc("prompt.submit");
      const srq = yield* fake.request("clarify", serverRequests.batchClarify);

      const request = yield* takeEvent(is("runtime_request.updated"));
      assert.equal(request.runtimeRequest.kind, "user_input");
      const item = yield* takeEvent(isTurnItem("user_input_request", "waiting"));
      assert.isTrue(item.turnItem.type === "user_input_request");
      if (item.turnItem.type !== "user_input_request") return;
      assert.deepStrictEqual(
        item.turnItem.questions.map((question) => [
          question.id,
          question.options.length,
          question.multiSelect ?? false,
        ]),
        [
          ["q1", 2, false],
          ["q2", 3, true],
          ["q3", 0, false],
        ],
      );

      yield* runtime.respondToRuntimeRequest({
        requestId: request.runtimeRequest.id,
        answers: { q1: "npm (Recommended)", q2: ["web", "mobile"], q3: "No" },
      });
      const locks = [
        yield* fake.takeRpc("clarify.lock"),
        yield* fake.takeRpc("clarify.lock"),
        yield* fake.takeRpc("clarify.lock"),
      ];
      assert.deepStrictEqual(
        locks.map((lock) => [lock.params.request_id, lock.params.question_id, lock.params.answer]),
        [
          [srq, "q1", "npm"],
          [srq, "q2", '["web","mobile"]'],
          [srq, "q3", "No"],
        ],
      );
      const resolved = yield* takeEvent(is("runtime_request.updated"));
      assert.equal(resolved.runtimeRequest.status, "resolved");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("steers the running turn with session.steer", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      const providerTurnId = (yield* takeEvent(is("provider_turn.updated"))).providerTurn.id;
      yield* runtime.steerTurn({
        threadId: THREAD_ID,
        runId: RunId.make(`run:${THREAD_ID}:1`),
        providerThread,
        providerTurnId,
        message: {
          messageId: "message:steer" as never,
          text: "Use pnpm instead",
          attachments: [],
          createdBy: "user",
          creationSource: "web",
        },
      });
      const steer = yield* fake.takeRpc("session.steer");
      assert.deepStrictEqual(steer.params, { session_id: "be7c8fa9", text: "Use pnpm instead" });
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("interrupts and resolves open requests when the turn ends", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      const providerTurnId = (yield* takeEvent(is("provider_turn.updated"))).providerTurn.id;
      const srq = yield* fake.request("sudo", serverRequests.sudo);
      yield* takeEvent(isTurnItem("user_input_request", "waiting"));

      yield* runtime.interruptTurn({ providerThread, providerTurnId });
      yield* fake.takeRpc("session.interrupt");
      yield* fake.event("message.complete", { text: "", status: "interrupted", usage: {} });

      const refused = yield* fake.takeReply(srq);
      assert.isDefined(refused.error);
      const cancelled = yield* takeEvent(is("runtime_request.updated"));
      assert.equal(cancelled.runtimeRequest.status, "cancelled");
      const terminal = yield* takeEvent(is("turn.terminal"));
      assert.equal(terminal.status, "interrupted");
      assert.equal(fake.activeTurns(), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("rolls back with one session.undo per discarded turn", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      const turn = (ordinal: number): OrchestrationV2ProviderTurn => ({
        id: ProviderTurnId.make(`provider-turn:${ordinal}`),
        providerThreadId: providerThread.id,
        nodeId: NodeId.make(`node:${ordinal}`),
        runAttemptId: null,
        nativeTurnRef: null,
        ordinal,
        status: "completed",
        startedAt: null,
        completedAt: null,
      });
      const snapshot = yield* runtime.rollbackThread({
        providerThread,
        target: {
          type: "provider_turn",
          checkpointId: CheckpointId.make("checkpoint:hermes:1"),
          appRunOrdinal: 1,
          providerTurn: turn(1),
        },
        providerThreadTurns: [turn(1), turn(2), turn(3)],
      });
      assert.equal(fake.rpcs().filter((rpc) => rpc.method === "session.undo").length, 2);
      assert.equal(snapshot.providerThread.id, providerThread.id);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("turns MEDIA directives split across chunks into file links", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      yield* fake.takeRpc("prompt.submit");
      yield* fake.events([
        { type: "message.start", payload: {} },
        { type: "message.delta", payload: { text: "Here is the chart:\nMED" } },
        { type: "message.delta", payload: { text: "IA: ~/out/chart.png\nDone." } },
        {
          type: "message.complete",
          payload: {
            text: "Here is the chart:\nMEDIA: ~/out/chart.png\nDone.",
            status: "complete",
          },
        },
      ]);
      const message = yield* takeEvent(
        (event): event is Extract<ProviderAdapterV2Event, { type: "message.updated" }> =>
          event.type === "message.updated" && !event.message.streaming,
      );
      assert.equal(
        message.message.text,
        "Here is the chart:\n[chart.png](</home/test/out/chart.png>)\nDone.",
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("resumes the durable Hermes session after a server restart", () =>
    Effect.gen(function* () {
      const first = yield* makeFakeHermesGateway;
      const before = yield* Effect.scoped(
        Effect.gen(function* () {
          const { runtime } = yield* openRuntime(first);
          return yield* ensureThread(runtime);
        }),
      );
      assert.isTrue(first.rpcs().some((rpc) => rpc.method === "session.close"));

      const second = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(second);
      const resumed = yield* runtime.resumeThread({ providerThread: before });
      const resume = yield* second.takeRpc("session.resume");
      assert.deepStrictEqual(resume.params, {
        session_id: HERMES_FIXTURE_STORED_ID,
        source: "t3-code",
        close_on_disconnect: true,
      });
      assert.equal(resumed.id, before.id);
      assert.equal(resumed.nativeThreadRef?.nativeId, HERMES_FIXTURE_STORED_ID);

      yield* startTurn(runtime, resumed, "Continue");
      const submit = yield* second.takeRpc("prompt.submit");
      assert.equal(submit.params.session_id, RESUMED_LIVE_ID);
      yield* second.events(normalTurn, RESUMED_LIVE_ID);
      const terminal = yield* takeEvent(is("turn.terminal"));
      assert.equal(terminal.status, "completed");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("fails the active turn when the gateway connection drops", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent, streamEnd } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread);
      yield* fake.takeRpc("prompt.submit");
      yield* fake.dropConnection;
      const terminal = yield* takeEvent(is("turn.terminal"));
      assert.isTrue(terminal.status === "failed" && terminal.failure.class === "transport_error");
      const exit = yield* Fiber.join(streamEnd);
      assert.isTrue(Exit.isFailure(exit));
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("runs slash commands, with command.dispatch fallback and prompt expansion", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);

      fake.handle("slash.exec", () => ({ output: "Available commands" }));
      yield* startTurn(runtime, providerThread, "/help");
      const exec = yield* fake.takeRpc("slash.exec");
      assert.equal(exec.params.command, "help");
      const output = yield* takeEvent(isTurnItem("assistant_message", "completed"));
      assert.equal(
        output.turnItem.type === "assistant_message" && output.turnItem.text,
        "Available commands",
      );
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "completed");

      fake.handle("slash.exec", () => {
        throw rpcError(4018, "skill command: use command.dispatch for /review");
      });
      fake.handle("command.dispatch", () => ({
        type: "skill",
        name: "review",
        message: "Review the diff.",
      }));
      yield* startTurn(runtime, providerThread, "/review src", { runOrdinal: 2 });
      const dispatch = yield* fake.takeRpc("command.dispatch");
      assert.deepStrictEqual(dispatch.params, {
        session_id: "be7c8fa9",
        name: "review",
        arg: "src",
      });
      const submit = yield* fake.takeRpc("prompt.submit");
      assert.equal(submit.params.text, "Review the diff.");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("switches models with a provider-qualified config.set", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread, "Hi", { model: "openrouter:openai/gpt-5" });
      const configSet = yield* fake.takeRpc("config.set");
      assert.equal(configSet.params.key, "model");
      assert.equal(configSet.params.value, "openai/gpt-5 --provider openrouter");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("rejects gateways below the minimum contract", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      fake.handle("session.create", () => ({
        ...recorded.sessionCreate,
        info: { ...recorded.sessionCreate.info, desktop_contract: 6 },
      }));
      const { runtime } = yield* openRuntime(fake);
      const exit = yield* Effect.exit(ensureThread(runtime));
      assert.isTrue(Exit.isFailure(exit));
      assert.isTrue(fake.rpcs().some((rpc) => rpc.method === "session.close"));
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );
});

describe("Hermes background turns", () => {
  it.effect("offers one continuation and streams the reply into the provider run", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent, continuations } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* fake.events(backgroundTurn.slice(0, 3));

      const offer = yield* Queue.take(continuations);
      assert.equal(offer.threadId, THREAD_ID);
      assert.equal(offer.providerThreadId, providerThread.id);
      assert.equal(offer.delivery, "adapter_buffered");
      assert.deepStrictEqual(offer.notification, {
        source: { kind: "background_task" },
        outcome: "completed",
        summary: "Hermes background work finished",
        detail: "Process proc_1 finished (exit 0)",
      });

      yield* startTurn(runtime, providerThread, "Background task completed.", {
        continuation: true,
      });
      yield* fake.events(backgroundTurn.slice(3));
      const message = yield* takeEvent(isFinalMessage);
      assert.equal(message.message.text, "The build finished.");
      assert.equal(message.message.runId, runIdFor(1));
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "completed");

      assert.equal(yield* Queue.size(continuations), 0);
      assert.isFalse(fake.rpcs().some((rpc) => rpc.method === "prompt.submit"));
      assert.equal(fake.activeTurns(), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("replays a background turn that finished before its run started", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent, continuations } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* fake.events([...backgroundTurn.slice(1, 2), ...toolTurn.slice(1)]);
      yield* drainInbox(fake);
      assert.equal(fake.activeTurns(), 0);
      const offer = yield* Queue.take(continuations);
      assert.isUndefined(offer.notification?.detail);

      yield* startTurn(runtime, providerThread, "Background task completed.", {
        continuation: true,
      });
      const tool = yield* takeEvent(isTurnItem("command_execution", "completed"));
      assert.equal(tool.turnItem.runId, runIdFor(1));
      const final = yield* takeEvent(
        (event): event is Extract<ProviderAdapterV2Event, { type: "turn_item.updated" }> =>
          isTurnItem("assistant_message", "completed")(event) &&
          event.turnItem.type === "assistant_message" &&
          event.turnItem.text === "All 12 tests pass.",
      );
      assert.equal(final.turnItem.runId, runIdFor(1));
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "completed");
      assert.equal(yield* Queue.size(continuations), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("settles a provider run with nothing to attach at once", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* startTurn(runtime, providerThread, "Background task completed.", {
        continuation: true,
      });
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "completed");
      assert.isFalse(fake.rpcs().some((rpc) => rpc.method === "prompt.submit"));
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("queues a user message behind the background turn", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent, continuations } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* fake.events(backgroundTurn.slice(1, 3));
      yield* Queue.take(continuations);

      yield* startTurn(runtime, providerThread, "What happened?");
      const submit = yield* fake.takeRpc("prompt.submit");
      assert.deepStrictEqual(submit.params, {
        session_id: "be7c8fa9",
        text: "What happened?",
        queued: true,
      });
      // Hermes finishes its own turn, then drains the queued prompt.
      yield* fake.events([
        ...backgroundTurn.slice(3),
        { type: "message.start", payload: {} },
        { type: "message.delta", payload: { text: "It finished." } },
        { type: "message.complete", payload: { text: "It finished.", status: "complete" } },
      ]);
      const reply = yield* takeEvent(isFinalMessage);
      assert.equal(reply.message.text, "It finished.");
      assert.equal(reply.message.runId, runIdFor(1));
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "completed");

      yield* startTurn(runtime, providerThread, "Background task completed.", {
        runOrdinal: 2,
        continuation: true,
      });
      const replayed = yield* takeEvent(isFinalMessage);
      assert.equal(replayed.message.text, "The build finished.");
      assert.equal(replayed.message.runId, runIdFor(2));
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "completed");
      assert.equal(fake.activeTurns(), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("interrupts Hermes from the provider run of a background turn", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent, continuations } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* fake.events(backgroundTurn.slice(1, 3));
      yield* Queue.take(continuations);
      yield* startTurn(runtime, providerThread, "Background task completed.", {
        continuation: true,
      });
      const providerTurnId = (yield* takeEvent(is("provider_turn.updated"))).providerTurn.id;

      yield* runtime.interruptTurn({ providerThread, providerTurnId });
      yield* fake.takeRpc("session.interrupt");
      yield* fake.event("message.complete", { text: "", status: "interrupted", usage: {} });
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "interrupted");
      assert.equal(fake.activeTurns(), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("stopping a run queued behind a background turn interrupts Hermes and settles", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent, continuations } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      yield* fake.events(backgroundTurn.slice(1, 3));
      yield* Queue.take(continuations);
      yield* startTurn(runtime, providerThread, "What happened?");
      const providerTurnId = (yield* takeEvent(is("provider_turn.updated"))).providerTurn.id;
      yield* fake.takeRpc("prompt.submit");

      // Hermes stops its own turn and drops the queued prompt, so no `message.start` follows.
      yield* runtime.interruptTurn({ providerThread, providerTurnId });
      yield* fake.takeRpc("session.interrupt");
      const terminal = yield* takeEvent(is("turn.terminal"));
      assert.equal(terminal.status, "interrupted");
      assert.equal(terminal.providerTurnId, providerTurnId);

      yield* fake.event("message.complete", { text: "", status: "interrupted", usage: {} });
      yield* drainInbox(fake);
      assert.equal(fake.activeTurns(), 0);
      assert.equal(yield* Queue.size(continuations), 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("keeps the full reply when a long background turn sheds its deltas", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeHermesGateway;
      const { runtime, takeEvent, continuations } = yield* openRuntime(fake);
      const providerThread = yield* ensureThread(runtime);
      const chunks = Array.from({ length: 2_100 }, (_, index) => `${index} `);
      yield* fake.events([
        { type: "message.start", payload: {} },
        ...chunks.map((chunk) => ({ type: "message.delta", payload: { text: chunk } })),
      ]);
      yield* drainInbox(fake);
      yield* Queue.take(continuations);

      yield* startTurn(runtime, providerThread, "Background task completed.", {
        continuation: true,
      });
      yield* fake.events([
        { type: "message.delta", payload: { text: "done" } },
        {
          type: "message.complete",
          payload: { text: `${chunks.join("")}done`, status: "complete" },
        },
      ]);
      const message = yield* takeEvent(isFinalMessage);
      assert.equal(message.message.text, `${chunks.join("")}done`);
      assert.equal((yield* takeEvent(is("turn.terminal"))).status, "completed");
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it("bounds the buffer by shedding deltas, then the oldest progress frames", () => {
    const buffer: HermesBackgroundBuffer = { items: [], deltasDropped: false };
    const event = (type: string) => ({ kind: "event" as const, event: { type } });
    bufferHermesBackgroundItem(buffer, event("message.start"), 4);
    bufferHermesBackgroundItem(buffer, event("tool.start"), 4);
    bufferHermesBackgroundItem(buffer, event("message.delta"), 4);
    bufferHermesBackgroundItem(buffer, event("tool.complete"), 4);
    assert.isFalse(buffer.deltasDropped);
    bufferHermesBackgroundItem(buffer, event("session.usage"), 4);
    assert.isTrue(buffer.deltasDropped);
    bufferHermesBackgroundItem(buffer, event("message.delta"), 4);
    bufferHermesBackgroundItem(buffer, event("message.complete"), 4);
    bufferHermesBackgroundItem(
      buffer,
      {
        kind: "request",
        request: { id: "srq-1", method: "approval", params: {} },
      },
      4,
    );
    assert.deepStrictEqual(
      buffer.items.map((item) => (item.kind === "event" ? item.event.type : item.request.id)),
      ["message.start", "tool.complete", "message.complete", "srq-1"],
    );
  });
});

describe("Hermes mapping helpers", () => {
  it("removes previewed interim segments from the final response", () => {
    assert.equal(hermesFinalTail("First.\n\nSecond.\n\nFinal.", ["First.", "Second."]), "Final.");
  });

  it("uses Hermes's JSON-array format for multi-select answers", () => {
    assert.equal(
      hermesClarifyAnswer(["a (Recommended)", "b"], {
        multiSelect: true,
        choices: ["a (Recommended)", "b"],
      }),
      '["a","b"]',
    );
    assert.equal(
      hermesClarifyAnswer("free text", { multiSelect: false, choices: [] }),
      "free text",
    );
  });

  it("reads command dispatch outcomes", () => {
    assert.deepStrictEqual(parseHermesCommandOutcome({ type: "alias", target: "compress" }), {
      type: "alias",
      target: "compress",
    });
    assert.deepStrictEqual(parseHermesCommandOutcome({ output: "ok", warning: "careful" }), {
      type: "output",
      output: "warning: careful\nok",
    });
  });
});
