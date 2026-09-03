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

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

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
          payload: { tool_id: "tool-1", name: "terminal", context: "Running pwd" },
        });
        emitter.current?.({
          type: "tool.complete",
          session_id: "live-1",
          payload: {
            tool_id: "tool-1",
            name: "terminal",
            args: { command: "pwd" },
            result_text: process.cwd(),
          },
        });
        emitter.current?.({
          type: "message.delta",
          session_id: "live-1",
          payload: { text: "hello" },
        });
        emitter.current?.({
          type: "subagent.start",
          session_id: "live-1",
          payload: { subagent_id: "research-1", goal: "Inspect the adapter" },
        });
        emitter.current?.({
          type: "subagent.tool",
          session_id: "live-1",
          payload: {
            subagent_id: "research-1",
            tool_name: "terminal",
            tool_preview: "Reading files",
          },
        });
        emitter.current?.({
          type: "subagent.complete",
          session_id: "live-1",
          payload: { subagent_id: "research-1", status: "completed", summary: "Done" },
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
              event.type === "item.updated" &&
              event.payload.itemType === "command_execution" &&
              asRecord(event.payload.data).command === "pwd",
          ),
        );
        assert.isTrue(
          events.some(
            (event) => event.type === "task.started" && event.payload.taskId === "research-1",
          ),
        );
        assert.isTrue(
          events.some(
            (event) =>
              event.type === "task.progress" &&
              event.payload.taskId === "research-1" &&
              event.payload.lastToolName === "terminal" &&
              event.payload.summary === "Reading files",
          ),
        );
        assert.isTrue(
          events.some(
            (event) => event.type === "task.completed" && event.payload.taskId === "research-1",
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

  it.effect("projects Hermes tool details into canonical activity items", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("hermes-gateway-tools");
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({ threadId, input: "exercise tools" });
        emitter.current?.({ type: "message.start", session_id: "live-1" });

        const tools = [
          {
            id: "terminal-1",
            name: "terminal",
            start: { context: "Running pwd" },
            complete: { args: { command: "pwd" }, result: { stdout: process.cwd() } },
          },
          {
            id: "read-1",
            name: "read_file",
            start: { args: { path: "src/index.ts" }, context: "Reading src/index.ts" },
            complete: { args: { path: "src/index.ts" }, result_text: "file contents" },
          },
          {
            id: "write-1",
            name: "write_file",
            start: {
              args: { path: "src/new.ts", content: "do not copy file contents into activity" },
            },
            complete: {
              args: { path: "src/new.ts", content: "do not copy file contents into activity" },
              result: { success: true },
            },
          },
          {
            id: "patch-1",
            name: "patch",
            start: {
              args: {
                patch:
                  "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch",
              },
            },
            complete: {
              args: {
                patch:
                  "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: src/b.ts\n*** End Patch",
              },
              result: { success: true },
            },
          },
          {
            id: "grep-1",
            name: "search_files",
            start: { args: { pattern: "projectHermesTool", path: "apps/server" } },
            complete: {
              args: { pattern: "projectHermesTool", path: "apps/server" },
              result: { matches: [] },
            },
          },
          {
            id: "web-1",
            name: "web_search",
            start: { context: "Searching the web for Hermes Agent" },
            complete: { args: { query: "Hermes Agent" }, result: { results: [] } },
          },
          {
            id: "browser-1",
            name: "browser_navigate",
            start: { args: { url: "https://example.com" } },
            complete: { args: { url: "https://example.com" }, result: { title: "Example" } },
          },
          {
            id: "browser-type-1",
            name: "browser_type",
            start: { args: { text: "secret-value" }, context: "Typing [REDACTED]" },
            complete: { args: { text: "secret-value" }, result: { success: true } },
          },
          {
            id: "image-1",
            name: "image_generate",
            start: { args: { prompt: "A blue circle" } },
            complete: { args: { prompt: "A blue circle" }, result: { path: "circle.png" } },
          },
          {
            id: "vision-1",
            name: "vision_analyze",
            start: { args: { question: "What is shown?" } },
            complete: { args: { question: "What is shown?" }, result: { answer: "A circle" } },
          },
          {
            id: "mcp-1",
            name: "mcp__github__search_issues",
            start: { args: { query: "Hermes" }, context: "Searching GitHub issues" },
            complete: {
              args: { query: "Hermes" },
              result: { content: [{ type: "text", text: "No issues" }] },
            },
          },
          {
            id: "delegate-1",
            name: "delegate_task",
            start: { args: { task: "Inspect the adapter" }, context: "Delegating adapter review" },
            complete: {
              args: { task: "Inspect the adapter" },
              result: { summary: "Reviewed" },
            },
          },
        ] satisfies ReadonlyArray<{
          readonly id: string;
          readonly name: string;
          readonly start: Readonly<Record<string, unknown>>;
          readonly complete: Readonly<Record<string, unknown>>;
        }>;

        for (const tool of tools) {
          emitter.current?.({
            type: "tool.start",
            session_id: "live-1",
            payload: { tool_id: tool.id, name: tool.name, ...tool.start },
          });
          emitter.current?.({
            type: "tool.complete",
            session_id: "live-1",
            payload: { tool_id: tool.id, name: tool.name, ...tool.complete },
          });
          yield* settleEvents;
        }

        function updatedTool(id: string) {
          const event = events.find(
            (candidate) =>
              candidate.type === "item.updated" && candidate.itemId === `hermes:live-1:tool:${id}`,
          );
          if (!event || event.type !== "item.updated") {
            throw new Error(`Missing tool update ${id}`);
          }
          return event;
        }

        function completedTool(id: string) {
          const event = events.find(
            (candidate) =>
              candidate.type === "item.completed" &&
              candidate.itemId === `hermes:live-1:tool:${id}`,
          );
          if (!event || event.type !== "item.completed") {
            throw new Error(
              `Missing completed tool ${id}; received ${events
                .filter((candidate) => candidate.type === "item.completed")
                .map((candidate) => candidate.itemId)
                .join(", ")}`,
            );
          }
          return event;
        }

        const terminalStart = updatedTool("terminal-1");
        assert.equal(terminalStart.payload.itemType, "command_execution");
        assert.equal(terminalStart.payload.title, "Ran command");
        assert.deepEqual(terminalStart.payload.data, {
          toolCallId: "terminal-1",
          toolName: "terminal",
          command: "pwd",
        });

        const read = completedTool("read-1");
        assert.equal(read.payload.itemType, "dynamic_tool_call");
        assert.equal(read.payload.title, "Read File");
        assert.equal(read.payload.detail, "src/index.ts");

        const write = updatedTool("write-1");
        assert.equal(write.payload.itemType, "file_change");
        assert.deepEqual(write.payload.data, {
          toolCallId: "write-1",
          toolName: "write_file",
          files: [{ path: "src/new.ts" }],
        });

        const patch = completedTool("patch-1");
        assert.deepEqual(asRecord(patch.payload.data).files, [
          { path: "src/a.ts" },
          { path: "src/b.ts" },
        ]);

        const grep = completedTool("grep-1");
        assert.equal(grep.payload.itemType, "web_search");
        assert.equal(grep.payload.title, "Grep");
        assert.equal(grep.payload.detail, "projectHermesTool");

        const webStart = updatedTool("web-1");
        assert.equal(webStart.payload.detail, "Searching the web for Hermes Agent");
        assert.equal(completedTool("web-1").payload.detail, "Hermes Agent");

        const browser = completedTool("browser-1");
        assert.equal(browser.payload.itemType, "dynamic_tool_call");
        assert.equal(browser.payload.title, "Browser Navigate");
        assert.equal(browser.payload.detail, "https://example.com");

        const browserType = updatedTool("browser-type-1");
        assert.equal(browserType.payload.detail, "Typing [REDACTED]");
        assert.deepEqual(browserType.payload.data, {
          toolCallId: "browser-type-1",
          toolName: "browser_type",
        });

        const image = completedTool("image-1");
        assert.equal(image.payload.itemType, "dynamic_tool_call");
        assert.equal(image.payload.title, "Generate Image");
        assert.equal(image.payload.detail, "A blue circle");

        const vision = completedTool("vision-1");
        assert.equal(vision.payload.itemType, "image_view");
        assert.equal(vision.payload.detail, "What is shown?");

        const mcp = completedTool("mcp-1");
        assert.equal(mcp.payload.itemType, "mcp_tool_call");
        assert.equal(mcp.payload.title, "github · search_issues");
        assert.deepEqual(asRecord(mcp.payload.data).item, {
          type: "mcpToolCall",
          id: "mcp-1",
          server: "github",
          tool: "search_issues",
          arguments: { query: "Hermes" },
          result: { content: [{ type: "text", text: "No issues" }] },
          status: "completed",
        });

        const delegated = completedTool("delegate-1");
        assert.equal(delegated.payload.itemType, "collab_agent_tool_call");
        assert.equal(delegated.payload.title, "Subagent task");
        assert.equal(delegated.payload.detail, "Delegating adapter review");

        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("preserves interim assistant commentary as a separate segment", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("hermes-gateway-interim");
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({ threadId, input: "inspect the project" });

        emitter.current?.({ type: "message.start", session_id: "live-1" });
        emitter.current?.({
          type: "message.delta",
          session_id: "live-1",
          payload: { text: "Checking the project." },
        });
        emitter.current?.({
          type: "message.interim",
          session_id: "live-1",
          payload: { text: "Checking the project.", already_streamed: true },
        });
        emitter.current?.({
          type: "message.delta",
          session_id: "live-1",
          payload: { text: "The project looks good." },
        });
        emitter.current?.({
          type: "message.complete",
          session_id: "live-1",
          payload: { text: "The project looks good.", status: "complete" },
        });
        yield* settleEvents;

        const assistantDeltas = events.filter(
          (event) =>
            event.type === "content.delta" && event.payload.streamKind === "assistant_text",
        );
        assert.equal(assistantDeltas.length, 2);
        assert.notEqual(assistantDeltas[0]?.itemId, assistantDeltas[1]?.itemId);
        assert.deepEqual(
          events
            .filter(
              (event) =>
                event.type === "item.completed" && event.payload.itemType === "assistant_message",
            )
            .map((event) => (event.type === "item.completed" ? event.payload.detail : undefined)),
          ["Checking the project.", "The project looks good."],
        );
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("turns streamed Hermes MEDIA output into portable file links", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          environment: { ...process.env, HOME: "/Users/hermes" },
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("hermes-gateway-media");
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({ threadId, input: "create a report" });

        emitter.current?.({ type: "message.start", session_id: "live-1" });
        emitter.current?.({
          type: "message.delta",
          session_id: "live-1",
          payload: { text: "Report ready.\nME" },
        });
        emitter.current?.({
          type: "message.delta",
          session_id: "live-1",
          payload: { text: 'DIA: "~/Exports/Q3 plan ' },
        });
        emitter.current?.({
          type: "message.delta",
          session_id: "live-1",
          payload: { text: '#1.pdf"' },
        });
        emitter.current?.({
          type: "session.usage",
          session_id: "live-1",
          payload: { usage: { context_used: 37.9, context_max: 100, total: 120.8 } },
        });
        emitter.current?.({
          type: "message.complete",
          session_id: "live-1",
          payload: {
            text: 'Report ready.\nMEDIA: "~/Exports/Q3 plan #1.pdf"',
            status: "complete",
          },
        });
        yield* settleEvents;

        const rendered =
          "Report ready.\n[Q3 plan #1.pdf](</Users/hermes/Exports/Q3 plan %231.pdf>)";
        assert.equal(
          events
            .filter(
              (event) =>
                event.type === "content.delta" && event.payload.streamKind === "assistant_text",
            )
            .map((event) => (event.type === "content.delta" ? event.payload.delta : ""))
            .join(""),
          rendered,
        );
        assert.isTrue(
          events.some(
            (event) =>
              event.type === "item.completed" &&
              event.payload.itemType === "assistant_message" &&
              event.payload.detail === rendered,
          ),
        );
        assert.deepEqual(
          events.find((event) => event.type === "thread.token-usage.updated")?.payload,
          {
            usage: {
              usedTokens: 37,
              maxTokens: 100,
              totalProcessedTokens: 120,
            },
          },
        );
        yield* Fiber.interrupt(eventFiber);
      }),
    ),
  );

  it.effect("does not duplicate an interim response preview at turn completion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const threadId = ThreadId.make("hermes-gateway-response-preview");
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({ threadId, input: "answer once" });

        emitter.current?.({ type: "message.start", session_id: "live-1" });
        emitter.current?.({
          type: "message.interim",
          session_id: "live-1",
          payload: { text: "One answer.", already_streamed: false },
        });
        emitter.current?.({
          type: "message.complete",
          session_id: "live-1",
          payload: { text: "One answer.", status: "complete", response_previewed: true },
        });
        yield* settleEvents;

        assert.equal(
          events.filter(
            (event) =>
              event.type === "item.completed" && event.payload.itemType === "assistant_message",
          ).length,
          1,
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

  it.effect("routes batched and multi-select clarifications through Hermes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = new FakeGateway();
        const emitter: { current?: (event: HermesGatewayEvent) => void } = {};
        const adapter = yield* makeHermesAdapter(decodeSettings({ profile: "default" }), {
          gatewayRuntime: fakeRuntime(gateway, emitter),
        });
        const threadId = ThreadId.make("hermes-gateway-batch-clarify");
        const events: ProviderRuntimeEvent[] = [];
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        yield* adapter.sendTurn({ threadId, input: "ask me" });
        emitter.current?.({
          type: "clarify.request",
          session_id: "live-1",
          payload: {
            request_id: "clarify-batch-1",
            questions: [
              {
                qid: "target",
                question: "Which branch?",
                choices: ["main (Recommended)", "dev"],
              },
              {
                qid: "checks",
                question: "Which checks?",
                choices: ["unit", "integration (Recommended)"],
                multi_select: true,
              },
              { qid: "notes", question: "Anything else?" },
            ],
          },
        });
        yield* settleEvents;

        const clarification = events.find((event) => event.type === "user-input.requested");
        assert.isDefined(clarification?.requestId);
        assert.deepEqual(
          clarification?.type === "user-input.requested"
            ? clarification.payload.questions.map((question) => ({
                id: question.id,
                multiSelect: question.multiSelect === true,
                options: question.options.map((option) => option.label),
              }))
            : undefined,
          [
            { id: "target", multiSelect: false, options: ["main (Recommended)", "dev"] },
            {
              id: "checks",
              multiSelect: true,
              options: ["unit", "integration (Recommended)"],
            },
            { id: "notes", multiSelect: false, options: [] },
          ],
        );

        yield* adapter.respondToUserInput(
          threadId,
          ApprovalRequestId.make(clarification!.requestId!),
          {
            target: "main (Recommended)",
            checks: ["unit", "integration (Recommended)"],
            notes: "No other constraints.",
          },
        );
        assert.deepEqual(
          gateway.requests
            .filter((request) => request.method === "clarify.respond")
            .map((request) => request.params),
          [
            {
              session_id: "live-1",
              request_id: "clarify-batch-1",
              question_id: "target",
              answer: "main",
            },
            {
              session_id: "live-1",
              request_id: "clarify-batch-1",
              question_id: "checks",
              answer: '["unit","integration"]',
            },
            {
              session_id: "live-1",
              request_id: "clarify-batch-1",
              question_id: "notes",
              answer: "No other constraints.",
            },
          ],
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
        const events: ProviderRuntimeEvent[] = [];
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.sync(() => events.push(event)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });

        const turn = yield* adapter.sendTurn({ threadId, input: "wait for it" });
        yield* settleEvents;
        assert.isTrue(gateway.requests.some((request) => request.method === "prompt.submit"));
        emitter.current?.({
          type: "approval.request",
          session_id: "live-1",
          payload: { command: "dangerous", description: "dangerous" },
        });
        emitter.current?.({
          type: "clarify.request",
          session_id: "live-1",
          payload: {
            request_id: "clarify-open-ended",
            question: "What should I search for?",
          },
        });
        yield* settleEvents;

        const inputRequested = events.find((event) => event.type === "user-input.requested");
        assert.deepEqual(
          inputRequested?.type === "user-input.requested"
            ? inputRequested.payload.questions[0]?.options
            : undefined,
          [],
        );

        yield* adapter.interruptTurn(threadId, turn.turnId);
        assert.isTrue(gateway.requests.some((request) => request.method === "session.interrupt"));
        assert.isTrue(events.some((event) => event.type === "request.resolved"));
        assert.isTrue(events.some((event) => event.type === "user-input.resolved"));
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
