import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ApprovalRequestId,
  HermesSettings,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import {
  buildGenericChatProviderInput,
  extractGenericChatUserInput,
} from "@t3tools/shared/genericChat";
import { ServerConfig } from "../../config.ts";
import { makeHermesAdapter } from "./HermesAdapter.ts";
import type { HermesGatewayConnection, HermesGatewayEvent } from "./HermesGatewayClient.ts";
import type { HermesGatewayRuntime } from "./HermesGatewayRuntime.ts";

const decodeSettings = Schema.decodeSync(HermesSettings);
const settleEvents = Effect.gen(function* () {
  for (let index = 0; index < 20; index += 1) yield* Effect.yieldNow;
});

class FakeGateway implements HermesGatewayConnection {
  readonly requests: Array<{ method: string; params: Readonly<Record<string, unknown>> }> = [];
  promptSubmit: Promise<unknown> | undefined;
  slashExecResult: unknown = { output: "(no output)" };
  slashExecError: Error | undefined;
  commandDispatchResult: unknown = { type: "exec", output: "(no output)" };
  closed = false;

  async request<T>(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<T> {
    this.requests.push({ method, params });
    if (method === "prompt.submit" && this.promptSubmit) {
      return (await this.promptSubmit) as T;
    }
    if (method === "slash.exec") {
      if (this.slashExecError) throw this.slashExecError;
      return this.slashExecResult as T;
    }
    if (method === "command.dispatch") return this.commandDispatchResult as T;
    const result =
      method === "session.create"
        ? {
            session_id: "live-1",
            stored_session_id: "stored-1",
            messages: [],
            info: { model: "grok-4.5", provider: "openrouter", desktop_contract: 2 },
          }
        : method === "session.resume"
          ? {
              session_id: "live-resumed",
              resumed: String(params.session_id),
              messages: [],
              info: { model: "grok-4.5", provider: "openrouter", desktop_contract: 2 },
            }
          : method === "session.undo"
            ? { removed: 2 }
            : { status: "ok" };
    return result as T;
  }

  close(): void {
    this.closed = true;
  }
}

function fakeRuntime(
  gateway: FakeGateway,
  emitRef: { current?: (event: HermesGatewayEvent) => void },
) {
  return {
    connect: (onEvent) =>
      Effect.sync(() => {
        emitRef.current = onEvent;
        return gateway;
      }),
  } satisfies HermesGatewayRuntime;
}

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-hermes-gateway-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("HermesAdapter gateway", (it) => {
  it.effect("streams native gateway events and persists a durable gateway cursor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          instanceId: ProviderInstanceId.make("hermes-default"),
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("hermes-gateway-flow");
        const session = yield* adapter.startSession({
          threadId,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
          modelSelection: {
            instanceId: ProviderInstanceId.make("hermes-default"),
            model: "openrouter:grok-4.5",
          },
        });
        assert.deepEqual(session.resumeCursor, {
          schemaVersion: 2,
          transport: "tui-gateway",
          sessionId: "stored-1",
        });
        const started = yield* adapter.sendTurn({ threadId, input: "hello Hermes" });
        emitter.current?.({ type: "message.start", session_id: "live-1" });
        emitter.current?.({
          type: "reasoning.delta",
          session_id: "live-1",
          payload: { text: "thinking" },
        });
        emitter.current?.({
          type: "tool.start",
          session_id: "live-1",
          payload: { tool_id: "tool-1", name: "terminal", args_text: "pwd" },
        });
        emitter.current?.({
          type: "tool.complete",
          session_id: "live-1",
          payload: { tool_id: "tool-1", name: "terminal", result_text: process.cwd() },
        });
        emitter.current?.({
          type: "message.delta",
          session_id: "live-1",
          payload: { text: "hello" },
        });
        emitter.current?.({
          type: "message.complete",
          session_id: "live-1",
          payload: { text: "hello", status: "complete", usage: { total: 42 } },
        });
        yield* settleEvents;

        assert.isTrue(gateway.requests.some((request) => request.method === "prompt.submit"));
        assert.isTrue(
          events.some(
            (event) =>
              event.type === "content.delta" && event.payload.streamKind === "assistant_text",
          ),
        );
        assert.isTrue(
          events.some(
            (event) =>
              event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
          ),
        );
        assert.isTrue(
          events.some(
            (event) =>
              event.type === "item.completed" && event.payload.itemType === "command_execution",
          ),
        );
        assert.isTrue(
          events.some(
            (event) => event.type === "turn.completed" && event.turnId === started.turnId,
          ),
        );
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("routes approval and clarification responses through Hermes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const threadId = ThreadId.make("hermes-gateway-prompts");
        const events: ProviderRuntimeEvent[] = [];
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({ threadId, input: "do it" });
        emitter.current?.({
          type: "approval.request",
          session_id: "live-1",
          payload: {
            command: "rm one-file",
            description: "destructive command",
            allow_permanent: true,
          },
        });
        emitter.current?.({
          type: "clarify.request",
          session_id: "live-1",
          payload: { request_id: "clarify-1", question: "Which branch?", choices: ["main", "dev"] },
        });
        yield* settleEvents;
        const approval = events.find((event) => event.type === "request.opened");
        const clarification = events.find((event) => event.type === "user-input.requested");
        assert.isDefined(approval?.requestId);
        assert.isDefined(clarification?.requestId);
        yield* adapter.respondToRequest(
          threadId,
          ApprovalRequestId.make(approval!.requestId!),
          "acceptForSession",
        );
        yield* adapter.respondToUserInput(
          threadId,
          ApprovalRequestId.make(clarification!.requestId!),
          { answer: "dev" },
        );
        assert.isTrue(
          gateway.requests.some(
            (request) =>
              request.method === "approval.respond" && request.params.choice === "session",
          ),
        );
        assert.isTrue(
          gateway.requests.some(
            (request) => request.method === "clarify.respond" && request.params.answer === "dev",
          ),
        );
      }),
    ),
  );

  it.effect("executes slash commands through the gateway and publishes their output", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        gateway.slashExecResult = { output: "Priority Processing: normal" };
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, {}),
        });
        const threadId = ThreadId.make("hermes-gateway-slash");
        const events: ProviderRuntimeEvent[] = [];
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        const turn = yield* adapter.sendTurn({
          threadId,
          input: buildGenericChatProviderInput("/fast status"),
        });
        yield* settleEvents;

        assert.isTrue(
          gateway.requests.some(
            (request) =>
              request.method === "slash.exec" &&
              request.params.session_id === "live-1" &&
              request.params.command === "fast status",
          ),
        );
        assert.isFalse(gateway.requests.some((request) => request.method === "prompt.submit"));
        assert.isTrue(
          events.some(
            (event) =>
              event.type === "content.delta" &&
              event.payload.streamKind === "assistant_text" &&
              event.payload.delta === "Priority Processing: normal",
          ),
        );
        assert.isTrue(
          events.some((event) => event.type === "turn.completed" && event.turnId === turn.turnId),
        );
        assert.equal((yield* adapter.listSessions())[0]?.status, "ready");
      }),
    ),
  );

  it.effect("falls back to command.dispatch and submits skill payloads as prompts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        gateway.slashExecError = new Error("skill command: use command.dispatch");
        gateway.commandDispatchResult = {
          type: "skill",
          name: "plan",
          message: "Use the planning skill for: ship this",
        };
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const threadId = ThreadId.make("hermes-gateway-skill-command");
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({
          threadId,
          input: buildGenericChatProviderInput("/plan ship this"),
        });
        yield* settleEvents;

        assert.isTrue(
          gateway.requests.some(
            (request) =>
              request.method === "command.dispatch" &&
              request.params.name === "plan" &&
              request.params.arg === "ship this",
          ),
        );
        const promptSubmit = gateway.requests.find((request) => request.method === "prompt.submit");
        assert.equal(
          extractGenericChatUserInput(String(promptSubmit?.params.text)),
          "Use the planning skill for: ship this",
        );

        emitter.current?.({
          type: "message.complete",
          session_id: "live-1",
          payload: { text: "Plan ready", status: "complete" },
        });
      }),
    ),
  );

  it.effect("drops legacy ACP cursors and auto-approves only in full-access mode", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const threadId = ThreadId.make("hermes-gateway-legacy");
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          resumeCursor: { schemaVersion: 1, transport: "acp", sessionId: "legacy" },
        });
        assert.equal(gateway.requests[0]?.method, "session.create");
        yield* adapter.sendTurn({ threadId, input: "run it" });
        emitter.current?.({
          type: "approval.request",
          session_id: "live-1",
          payload: { command: "dangerous", description: "dangerous" },
        });
        yield* settleEvents;
        assert.isTrue(
          gateway.requests.some(
            (request) => request.method === "approval.respond" && request.params.choice === "once",
          ),
        );
      }),
    ),
  );

  it.effect("returns while prompt.submit is pending so active turns can be interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        let resolvePrompt!: (value: unknown) => void;
        gateway.promptSubmit = new Promise((resolve) => {
          resolvePrompt = resolve;
        });
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const threadId = ThreadId.make("hermes-gateway-interrupt");
        yield* adapter.startSession({ threadId, runtimeMode: "full-access" });

        const turn = yield* adapter.sendTurn({ threadId, input: "wait for it" });
        yield* settleEvents;
        assert.isTrue(gateway.requests.some((request) => request.method === "prompt.submit"));

        yield* adapter.interruptTurn(threadId, turn.turnId);
        assert.isTrue(gateway.requests.some((request) => request.method === "session.interrupt"));
        resolvePrompt({ status: "interrupted" });
      }),
    ),
  );

  it.effect("supports attachments, steering, model continuity, undo, and session close", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const threadId = ThreadId.make("hermes-gateway-controls");
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });

        const turn = yield* adapter.sendTurn({
          threadId,
          input: "inspect this",
          attachments: [
            {
              type: "image",
              id: "hermes-gateway-controls-00000000-0000-4000-8000-000000000001",
              name: "fixture.png",
              mimeType: "image/png",
              sizeBytes: 1,
            },
          ],
        });
        const steered = yield* adapter.sendTurn({ threadId, input: "focus on the title" });
        assert.equal(steered.turnId, turn.turnId);
        assert.isTrue(gateway.requests.some((request) => request.method === "image.attach"));
        assert.isTrue(gateway.requests.some((request) => request.method === "session.steer"));

        emitter.current?.({
          type: "message.complete",
          session_id: "live-1",
          payload: { text: "done", status: "complete" },
        });
        emitter.current?.({
          type: "session.info",
          session_id: "live-1",
          payload: { model: "grok-4.5", provider: "openrouter", running: false },
        });
        yield* settleEvents;

        const configSetCount = gateway.requests.filter(
          (request) => request.method === "config.set",
        ).length;
        yield* adapter.sendTurn({
          threadId,
          input: "continue",
          modelSelection: {
            instanceId: ProviderInstanceId.make("hermes"),
            model: "openrouter:grok-4.5",
          },
        });
        assert.equal(
          gateway.requests.filter((request) => request.method === "config.set").length,
          configSetCount,
        );
        emitter.current?.({
          type: "message.complete",
          session_id: "live-1",
          payload: { text: "continued", status: "complete" },
        });
        yield* settleEvents;

        yield* adapter.rollbackThread(threadId, 1);
        yield* adapter.stopSession(threadId);
        assert.isTrue(gateway.requests.some((request) => request.method === "session.undo"));
        assert.isTrue(gateway.requests.some((request) => request.method === "session.close"));
        assert.isTrue(gateway.closed);
      }),
    ),
  );
});
