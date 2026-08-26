import {
  ApprovalRequestId,
  EventId,
  type HermesSettings,
  ProviderItemId,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  type ToolLifecycleItemType,
  TurnId,
} from "@t3tools/contracts";
import {
  buildGenericChatProviderInput,
  extractGenericChatUserInput,
} from "@t3tools/shared/genericChat";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { EventNdjsonLogger } from "../Layers/EventNdjsonLogger.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { type HermesGatewayConnection, type HermesGatewayEvent } from "./HermesGatewayClient.ts";
import { makeHermesGatewayRuntime, type HermesGatewayRuntime } from "./HermesGatewayRuntime.ts";
import {
  hermesApprovalChoice,
  HERMES_DRIVER_KIND,
  HERMES_GATEWAY_MIN_DESKTOP_CONTRACT,
  HERMES_GATEWAY_RESUME_SCHEMA_VERSION,
  parseHermesGatewayConversationCursor,
  parseHermesModelSelection,
  shouldAutoApproveHermes,
} from "./HermesGatewaySupport.ts";

export interface HermesAdapterOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly gatewayRuntime?: HermesGatewayRuntime;
}

type PendingInteraction =
  | { readonly kind: "approval"; readonly requestType: "command_execution_approval" }
  | {
      readonly kind: "user-input";
      readonly method: "clarify.respond" | "sudo.respond" | "secret.respond";
      readonly gatewayRequestId: string;
      readonly answerKey: "answer" | "password" | "value";
      readonly questionId: string;
    };

interface HermesSessionContext {
  readonly threadId: ThreadId;
  readonly client: HermesGatewayConnection;
  readonly liveSessionId: string;
  readonly pendingInteractions: Map<ApprovalRequestId, PendingInteraction>;
  readonly toolItems: Map<string, HermesToolState>;
  readonly eventQueue: Queue.Queue<HermesGatewayEvent>;
  session: ProviderSession;
  turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeTurnId: TurnId | undefined;
  assistantItemId: RuntimeItemId | undefined;
  assistantSegmentIndex: number;
  assistantText: string;
  assistantInterimTexts: Array<string>;
  reasoningItemId: RuntimeItemId | undefined;
  currentModelId: string | undefined;
  stopped: boolean;
}

interface HermesToolProjection {
  readonly name: string | undefined;
  readonly itemType: ToolLifecycleItemType;
  readonly title: string;
  readonly detail: string | undefined;
  readonly data: Readonly<Record<string, unknown>>;
}

interface HermesToolState {
  readonly itemId: RuntimeItemId;
  readonly projection: HermesToolProjection;
}

interface SessionStartResponse {
  readonly session_id: string;
  readonly stored_session_id?: string;
  readonly resumed?: string;
  readonly session_key?: string;
  readonly messages?: ReadonlyArray<unknown>;
  readonly info?: Readonly<Record<string, unknown>>;
}

type HermesCommandDispatch =
  | { readonly type: "exec"; readonly output?: string }
  | { readonly type: "plugin"; readonly output?: string }
  | { readonly type: "alias"; readonly target: string }
  | {
      readonly type: "send" | "prefill";
      readonly message: string;
      readonly notice?: string;
    }
  | {
      readonly type: "skill";
      readonly message?: string;
      readonly name: string;
    };

interface HermesSlashCommand {
  readonly name: string;
  readonly arg: string;
  readonly command: string;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finalAssistantTail(finalText: string, priorSegments: ReadonlyArray<string>): string {
  let tail = finalText.trimStart();
  for (const segment of priorSegments) {
    const trimmed = segment.trim();
    if (trimmed && tail.startsWith(trimmed)) tail = tail.slice(trimmed.length).trimStart();
  }
  return tail;
}

function answerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}

function parseHermesSlashCommand(value: string): HermesSlashCommand | undefined {
  const command = value.trim();
  const match = /^\/([^/\s]+)(?:\s+([\s\S]*))?$/.exec(command);
  if (!match?.[1]) return undefined;
  return {
    name: match[1],
    arg: match[2]?.trim() ?? "",
    command: command.slice(1),
  };
}

function parseHermesCommandDispatch(value: unknown): HermesCommandDispatch | undefined {
  const payload = record(value);
  const type = payload.type;
  if (type === "exec" || type === "plugin") {
    return { type, ...(typeof payload.output === "string" ? { output: payload.output } : {}) };
  }
  if (type === "alias") {
    return typeof payload.target === "string" && payload.target.trim()
      ? { type, target: payload.target.trim() }
      : undefined;
  }
  if ((type === "send" || type === "prefill") && typeof payload.message === "string") {
    return {
      type,
      message: payload.message,
      ...(typeof payload.notice === "string" ? { notice: payload.notice } : {}),
    };
  }
  if (type === "skill" && typeof payload.name === "string") {
    return {
      type,
      name: payload.name,
      ...(typeof payload.message === "string" ? { message: payload.message } : {}),
    };
  }
  return undefined;
}

function gatewayRequestError(
  threadId: ThreadId,
  method: string,
  cause: unknown,
): ProviderAdapterRequestError {
  return new ProviderAdapterRequestError({
    provider: HERMES_DRIVER_KIND,
    method,
    detail: cause instanceof Error ? cause.message : `Hermes gateway request failed: ${method}`,
    cause,
  });
}

function toolItemType(name: string | undefined): ToolLifecycleItemType {
  const normalized = name?.toLowerCase() ?? "";
  if (normalized.startsWith("mcp__") || normalized.startsWith("mcp_")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("delegate") || normalized.includes("subagent")) {
    return "collab_agent_tool_call";
  }
  if (
    normalized.includes("terminal") ||
    normalized.includes("exec") ||
    normalized.includes("shell")
  ) {
    return "command_execution";
  }
  if (normalized.includes("write") || normalized.includes("edit") || normalized.includes("patch")) {
    return "file_change";
  }
  if (normalized === "web_search" || normalized === "x_search" || normalized === "search_files") {
    return "web_search";
  }
  if (normalized === "vision_analyze" || normalized === "image_view") return "image_view";
  return "dynamic_tool_call";
}

function humanizeToolName(name: string): string {
  return name
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function mcpToolIdentity(name: string | undefined) {
  const match = /^mcp__(.+?)__(.+)$/u.exec(name ?? "");
  return match?.[1] && match[2] ? { server: match[1], tool: match[2] } : undefined;
}

function toolTitle(name: string | undefined, itemType: ToolLifecycleItemType): string {
  const normalized = name?.toLowerCase() ?? "";
  const mcp = mcpToolIdentity(name);
  if (mcp) return `${mcp.server} · ${mcp.tool}`;
  if (normalized === "search_files") return "Grep";
  if (normalized === "read_file") return "Read File";
  if (normalized === "web_extract") return "Read Page";
  if (normalized === "session_search") return "Search Sessions";
  if (normalized === "image_generate") return "Generate Image";
  switch (itemType) {
    case "command_execution":
      return "Ran command";
    case "file_change":
      return "File change";
    case "mcp_tool_call":
      return "MCP tool call";
    case "collab_agent_tool_call":
      return "Subagent task";
    case "web_search":
      return "Web search";
    case "image_view":
      return "Image view";
    case "dynamic_tool_call":
      return name ? humanizeToolName(name) : "Tool call";
  }
}

function firstText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return text(value);
  for (const entry of value) {
    const candidate = text(entry);
    if (candidate) return candidate;
  }
  return undefined;
}

function patchFilePaths(value: unknown): ReadonlyArray<string> {
  const patch = text(value);
  if (!patch) return [];
  return [...patch.matchAll(/^\*\*\* (?:Add|Delete|Update) File:\s*(.+)$/gmu)]
    .map((match) => match[1]?.trim())
    .filter((path): path is string => !!path);
}

function toolFilePaths(
  itemType: ToolLifecycleItemType,
  args: Readonly<Record<string, unknown>>,
): ReadonlyArray<string> {
  if (itemType !== "file_change") return [];
  const directPath = text(args.path);
  return [...new Set([...(directPath ? [directPath] : []), ...patchFilePaths(args.patch)])];
}

function toolCommand(
  itemType: ToolLifecycleItemType,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  if (itemType !== "command_execution") return undefined;
  return text(args.command) ?? text(args.cmd) ?? text(args.code);
}

function toolCommandFromContext(
  itemType: ToolLifecycleItemType,
  value: unknown,
): string | undefined {
  if (itemType !== "command_execution") return undefined;
  const context = text(value);
  if (!context) return undefined;
  return /^Running(?: (?:code|command))?:?\s+(.+)$/isu.exec(context)?.[1]?.trim();
}

function toolArgumentDetail(
  name: string | undefined,
  args: Readonly<Record<string, unknown>>,
  filePaths: ReadonlyArray<string>,
): string | undefined {
  switch (name?.toLowerCase()) {
    case "web_search":
    case "x_search":
    case "session_search":
      return text(args.query);
    case "search_files":
      return text(args.pattern);
    case "web_extract":
      return firstText(args.urls) ?? text(args.url);
    case "read_file":
    case "write_file":
    case "patch":
      return filePaths[0] ?? text(args.path);
    case "browser_navigate":
      return text(args.url);
    case "vision_analyze":
      return text(args.question);
    case "image_generate":
    case "video_generate":
      return text(args.prompt);
    default:
      return undefined;
  }
}

function projectHermesTool(
  payload: Readonly<Record<string, unknown>>,
  fallback?: HermesToolProjection,
  status: "inProgress" | "completed" = "inProgress",
): HermesToolProjection {
  const name = text(payload.name) ?? fallback?.name;
  const itemType = name ? toolItemType(name) : (fallback?.itemType ?? "dynamic_tool_call");
  const args = record(payload.args);
  const command =
    toolCommand(itemType, args) ??
    text(fallback?.data.command) ??
    toolCommandFromContext(itemType, payload.context);
  const filePaths = toolFilePaths(itemType, args);
  const semanticDetail = toolArgumentDetail(name, args, filePaths);
  const failure = text(payload.error);
  const detail =
    itemType === "command_execution" && command
      ? (failure ?? text(payload.summary) ?? text(payload.result_text))
      : (failure ??
        semanticDetail ??
        text(payload.context) ??
        fallback?.detail ??
        text(payload.summary) ??
        text(payload.result_text));
  const data: Record<string, unknown> = {
    ...(text(payload.tool_id) ? { toolCallId: text(payload.tool_id) } : {}),
    ...(name ? { toolName: name } : {}),
    ...(command ? { command } : {}),
    ...(filePaths.length > 0 ? { files: filePaths.map((path) => ({ path })) } : {}),
  };
  const mcp = mcpToolIdentity(name);
  if (itemType === "mcp_tool_call") {
    const result = payload.result ?? payload.result_text;
    data.item = {
      type: "mcpToolCall",
      ...(text(payload.tool_id) ? { id: text(payload.tool_id) } : {}),
      ...(mcp ? { server: mcp.server, tool: mcp.tool } : {}),
      ...(Object.keys(args).length > 0 ? { arguments: args } : {}),
      ...(result !== undefined ? { result } : {}),
      status: failure ? "failed" : status,
      ...(failure ? { error: failure } : {}),
    };
  } else {
    const rawOutput = payload.result ?? payload.result_text;
    if (rawOutput !== undefined) data.rawOutput = rawOutput;
  }
  return {
    name,
    itemType,
    title: toolTitle(name, itemType),
    detail,
    data,
  };
}

export const makeHermesAdapter = Effect.fn("makeHermesAdapter")(function* (
  hermesSettings: HermesSettings,
  options: HermesAdapterOptions = {},
): Effect.fn.Return<
  ProviderAdapterShape<ProviderAdapterError>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | ServerConfig | Scope.Scope
> {
  const boundInstanceId = options.instanceId ?? ProviderInstanceId.make("hermes");
  const serverConfig = yield* ServerConfig;
  const crypto = yield* Crypto.Crypto;
  const runtime =
    options.gatewayRuntime ??
    (yield* makeHermesGatewayRuntime(hermesSettings, options.environment ?? process.env));
  const sessions = new Map<ThreadId, HermesSessionContext>();
  const parentScope = yield* Scope.Scope;
  const locks = yield* SynchronizedRef.make(
    new Map<string, { readonly semaphore: Semaphore.Semaphore; readonly users: number }>(),
  );
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const runtimeContext = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(runtimeContext);
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const uuid = crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) => gatewayRequestError(ThreadId.make("hermes"), "crypto", cause)),
  );
  const stamp = () => Effect.all({ eventId: Effect.map(uuid, EventId.make), createdAt: nowIso });
  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);
  const base = (context: HermesSessionContext, event: HermesGatewayEvent) => ({
    provider: HERMES_DRIVER_KIND,
    providerInstanceId: boundInstanceId,
    threadId: context.threadId,
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    raw: {
      source: "hermes.tui-gateway" as const,
      method: event.type,
      payload: event,
    },
  });

  const request = <T>(
    context: HermesSessionContext,
    method: string,
    params: Readonly<Record<string, unknown>>,
  ) =>
    Effect.tryPromise({
      try: () => context.client.request<T>(method, params),
      catch: (cause) => gatewayRequestError(context.threadId, method, cause),
    });

  const getLock = (threadId: ThreadId) =>
    SynchronizedRef.modifyEffect(locks, (current) => {
      const found = current.get(threadId);
      if (found) {
        const next = new Map(current);
        next.set(threadId, { ...found, users: found.users + 1 });
        return Effect.succeed([found.semaphore, next] as const);
      }
      return Semaphore.make(1).pipe(
        Effect.map((semaphore) => {
          const next = new Map(current);
          next.set(threadId, { semaphore, users: 1 });
          return [semaphore, next] as const;
        }),
      );
    });
  const releaseLock = (threadId: ThreadId) =>
    SynchronizedRef.update(locks, (current) => {
      const found = current.get(threadId);
      if (!found) return current;
      const next = new Map(current);
      if (found.users === 1) next.delete(threadId);
      else next.set(threadId, { ...found, users: found.users - 1 });
      return next;
    });
  const withLock = <A, E, R>(threadId: ThreadId, effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(getLock(threadId), (lock) =>
      lock.withPermit(effect).pipe(Effect.ensuring(releaseLock(threadId))),
    );
  const requireSession = (threadId: ThreadId) => {
    const context = sessions.get(threadId);
    return !context || context.stopped
      ? Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: HERMES_DRIVER_KIND, threadId }),
        )
      : Effect.succeed(context);
  };

  const makeItemId = (context: HermesSessionContext, suffix: string) =>
    RuntimeItemId.make(`hermes:${context.liveSessionId}:${suffix}`);

  const ensureAssistantItem = Effect.fn("HermesAdapter.ensureAssistantItem")(function* (
    context: HermesSessionContext,
    event: HermesGatewayEvent,
  ) {
    if (context.assistantItemId) return context.assistantItemId;
    const suffix = context.assistantSegmentIndex === 0 ? "" : `:${context.assistantSegmentIndex}`;
    const itemId = makeItemId(context, `${context.activeTurnId ?? "idle"}:assistant${suffix}`);
    context.assistantItemId = itemId;
    yield* publish({
      type: "item.started",
      ...(yield* stamp()),
      ...base(context, event),
      itemId,
      payload: { itemType: "assistant_message", status: "inProgress" },
    });
    return itemId;
  });

  const abandonPendingInteractions = Effect.fn("HermesAdapter.abandonPendingInteractions")(
    function* (
      context: HermesSessionContext,
      shouldAbandon: (pending: PendingInteraction) => boolean = () => true,
    ) {
      for (const [requestId, pending] of context.pendingInteractions) {
        if (!shouldAbandon(pending)) continue;
        context.pendingInteractions.delete(requestId);
        if (pending.kind === "approval") {
          yield* publish({
            type: "request.resolved",
            ...(yield* stamp()),
            provider: HERMES_DRIVER_KIND,
            providerInstanceId: boundInstanceId,
            threadId: context.threadId,
            ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
            requestId: RuntimeRequestId.make(requestId),
            payload: { requestType: pending.requestType, decision: "cancelled" },
          });
          continue;
        }
        yield* publish({
          type: "user-input.resolved",
          ...(yield* stamp()),
          provider: HERMES_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: context.threadId,
          ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
          requestId: RuntimeRequestId.make(requestId),
          payload: { answers: {} },
        });
      }
    },
  );

  const finishTurn = Effect.fn("HermesAdapter.finishTurn")(function* (
    context: HermesSessionContext,
    state: "completed" | "failed" | "cancelled",
    detail?: string,
  ) {
    const turnId = context.activeTurnId;
    if (!turnId) return;
    yield* abandonPendingInteractions(context);
    context.activeTurnId = undefined;
    context.assistantItemId = undefined;
    context.assistantSegmentIndex = 0;
    context.assistantText = "";
    context.assistantInterimTexts = [];
    context.reasoningItemId = undefined;
    const { activeTurnId: _activeTurnId, ...session } = context.session;
    context.session = { ...session, status: "ready", updatedAt: yield* nowIso };
    yield* publish({
      type: "turn.completed",
      ...(yield* stamp()),
      provider: HERMES_DRIVER_KIND,
      providerInstanceId: boundInstanceId,
      threadId: context.threadId,
      turnId,
      payload: {
        state,
        ...(detail ? { errorMessage: detail } : {}),
      },
    });
  });

  const publishCommandOutput = Effect.fn("HermesAdapter.publishCommandOutput")(function* (
    context: HermesSessionContext,
    output: string,
    completeTurn: boolean,
  ) {
    const detail = output.trim() || "(no output)";
    const event: HermesGatewayEvent = {
      type: "slash.output",
      session_id: context.liveSessionId,
      payload: { text: detail },
    };
    const itemId = makeItemId(context, `${context.activeTurnId ?? "idle"}:slash:${yield* uuid}`);
    yield* publish({
      type: "item.started",
      ...(yield* stamp()),
      ...base(context, event),
      itemId,
      payload: { itemType: "assistant_message", status: "inProgress" },
    });
    yield* publish({
      type: "content.delta",
      ...(yield* stamp()),
      ...base(context, event),
      itemId,
      payload: { streamKind: "assistant_text", delta: detail },
    });
    yield* publish({
      type: "item.completed",
      ...(yield* stamp()),
      ...base(context, event),
      itemId,
      payload: {
        itemType: "assistant_message",
        status: "completed",
        detail,
        data: event.payload,
      },
    });
    if (completeTurn) yield* finishTurn(context, "completed");
  });

  const submitPrompt = (
    context: HermesSessionContext,
    prompt: string,
  ): Effect.Effect<void, ProviderAdapterError> =>
    request<{ readonly status?: string }>(context, "prompt.submit", {
      session_id: context.liveSessionId,
      text: prompt,
    }).pipe(Effect.asVoid);

  const executeSlashCommand = Effect.fn("HermesAdapter.executeSlashCommand")(function* (
    context: HermesSessionContext,
    initialSlash: HermesSlashCommand,
    preparePrompt: (message: string) => string,
  ) {
    let slash = initialSlash;
    const aliases = new Set([slash.name.toLowerCase()]);
    while (true) {
      const slashExec = yield* request<unknown>(context, "slash.exec", {
        session_id: context.liveSessionId,
        command: slash.command,
      }).pipe(Effect.result);
      const response = Result.isSuccess(slashExec)
        ? slashExec.success
        : yield* request<unknown>(context, "command.dispatch", {
            session_id: context.liveSessionId,
            name: slash.name,
            arg: slash.arg,
          });
      const dispatch = parseHermesCommandDispatch(response);

      if (!dispatch) {
        const payload = record(response);
        const body = text(payload.output) ?? `/${slash.name}: no output`;
        const warning = text(payload.warning);
        yield* publishCommandOutput(context, warning ? `warning: ${warning}\n${body}` : body, true);
        return;
      }
      if (dispatch.type === "exec" || dispatch.type === "plugin") {
        yield* publishCommandOutput(context, dispatch.output ?? "(no output)", true);
        return;
      }
      if (dispatch.type === "alias") {
        const target = `${dispatch.target}${slash.arg ? ` ${slash.arg}` : ""}`;
        const aliased = parseHermesSlashCommand(target.startsWith("/") ? target : `/${target}`);
        if (!aliased) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "sendTurn",
            issue: `Hermes returned an invalid slash-command alias: ${dispatch.target}`,
          });
        }
        const alias = aliased.name.toLowerCase();
        if (aliases.has(alias)) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "sendTurn",
            issue: `Hermes returned a recursive slash-command alias: /${aliased.name}.`,
          });
        }
        aliases.add(alias);
        slash = aliased;
        continue;
      }

      const message = dispatch.message?.trim() ?? "";
      if (dispatch.type !== "skill" && dispatch.notice?.trim()) {
        yield* publishCommandOutput(context, dispatch.notice, false);
      }
      if (dispatch.type === "prefill") {
        yield* publishCommandOutput(
          context,
          message
            ? `${message}\n\nHermes returned this text for editing; copy it into the composer to resubmit.`
            : `/${slash.name} completed without editable text.`,
          true,
        );
        return;
      }
      if (!message) {
        return yield* new ProviderAdapterValidationError({
          provider: HERMES_DRIVER_KIND,
          operation: "sendTurn",
          issue: `Hermes returned an empty ${dispatch.type} command payload for /${slash.name}.`,
        });
      }
      yield* submitPrompt(context, preparePrompt(message));
      return;
    }
  });

  const openUserInput = Effect.fn("HermesAdapter.openUserInput")(function* (
    context: HermesSessionContext,
    event: HermesGatewayEvent,
    input: {
      readonly gatewayRequestId: string;
      readonly method: "clarify.respond" | "sudo.respond" | "secret.respond";
      readonly answerKey: "answer" | "password" | "value";
      readonly questionId: string;
      readonly header: string;
      readonly question: string;
      readonly choices?: ReadonlyArray<string>;
    },
  ) {
    const requestId = ApprovalRequestId.make(yield* uuid);
    context.pendingInteractions.set(requestId, {
      kind: "user-input",
      method: input.method,
      gatewayRequestId: input.gatewayRequestId,
      answerKey: input.answerKey,
      questionId: input.questionId,
    });
    yield* publish({
      type: "user-input.requested",
      ...(yield* stamp()),
      ...base(context, event),
      requestId: RuntimeRequestId.make(requestId),
      payload: {
        questions: [
          {
            id: input.questionId,
            header: input.header,
            question: input.question,
            options: (input.choices ?? []).map((choice) => ({
              label: choice,
              description: `Respond with ${choice}.`,
            })),
          },
        ],
      },
    });
  });

  const handleGatewayEvent = Effect.fn("HermesAdapter.handleGatewayEvent")(function* (
    context: HermesSessionContext,
    event: HermesGatewayEvent,
  ) {
    if (context.stopped || (event.session_id && event.session_id !== context.liveSessionId)) return;
    const payload = record(event.payload);
    if (options.nativeEventLogger) {
      const observedAt = yield* nowIso;
      yield* options.nativeEventLogger.write(
        {
          observedAt,
          event: {
            id: yield* uuid,
            kind: "notification",
            provider: HERMES_DRIVER_KIND,
            providerInstanceId: boundInstanceId,
            threadId: context.threadId,
            createdAt: observedAt,
            method: event.type,
            payload: event,
          },
        },
        context.threadId,
      );
    }

    switch (event.type) {
      case "gateway.ready":
        return;
      case "session.info": {
        const model = text(payload.model);
        const provider = text(payload.provider);
        if (model) context.currentModelId = provider ? `${provider}:${model}` : model;
        const contract = number(payload.desktop_contract);
        if (contract !== undefined && contract < HERMES_GATEWAY_MIN_DESKTOP_CONTRACT) {
          yield* publish({
            type: "runtime.warning",
            ...(yield* stamp()),
            ...base(context, event),
            payload: {
              message: `Hermes gateway contract ${contract} is older than T3 Code's supported baseline ${HERMES_GATEWAY_MIN_DESKTOP_CONTRACT}.`,
            },
          });
        }
        return;
      }
      case "message.start": {
        if (!context.activeTurnId) {
          context.activeTurnId = TurnId.make(yield* uuid);
          yield* publish({
            type: "turn.started",
            ...(yield* stamp()),
            ...base(context, event),
            payload: context.currentModelId ? { model: context.currentModelId } : {},
          });
        }
        context.assistantItemId = undefined;
        context.assistantSegmentIndex = 0;
        context.assistantText = "";
        context.assistantInterimTexts = [];
        yield* ensureAssistantItem(context, event);
        return;
      }
      case "message.delta": {
        const delta = typeof payload.text === "string" ? payload.text : "";
        if (!delta) return;
        const itemId = yield* ensureAssistantItem(context, event);
        context.assistantText += delta;
        yield* publish({
          type: "content.delta",
          ...(yield* stamp()),
          ...base(context, event),
          itemId,
          payload: { streamKind: "assistant_text", delta },
        });
        return;
      }
      case "message.interim": {
        const interimText = typeof payload.text === "string" ? payload.text.trimStart() : "";
        if (!interimText) return;
        const itemId = yield* ensureAssistantItem(context, event);
        if (payload.already_streamed !== true) {
          const missingText = interimText.startsWith(context.assistantText)
            ? interimText.slice(context.assistantText.length)
            : "";
          if (missingText) {
            yield* publish({
              type: "content.delta",
              ...(yield* stamp()),
              ...base(context, event),
              itemId,
              payload: { streamKind: "assistant_text", delta: missingText },
            });
          }
        }
        yield* publish({
          type: "item.completed",
          ...(yield* stamp()),
          ...base(context, event),
          itemId,
          payload: {
            itemType: "assistant_message",
            status: "completed",
            detail: interimText,
            data: { ...payload, interim: true },
          },
        });
        context.assistantInterimTexts.push(interimText);
        context.assistantItemId = undefined;
        context.assistantSegmentIndex += 1;
        context.assistantText = "";
        return;
      }
      case "message.complete": {
        const status = text(payload.status) ?? "complete";
        const finalText = typeof payload.text === "string" ? payload.text : "";
        const completionText =
          payload.response_previewed === true
            ? finalAssistantTail(finalText, context.assistantInterimTexts)
            : finalText;
        if (!context.assistantItemId && completionText) {
          yield* ensureAssistantItem(context, event);
        }
        if (context.assistantItemId) {
          yield* publish({
            type: "item.completed",
            ...(yield* stamp()),
            ...base(context, event),
            itemId: context.assistantItemId,
            payload: {
              itemType: "assistant_message",
              status: status === "error" ? "failed" : "completed",
              ...(completionText ? { detail: completionText } : {}),
              data: payload,
            },
          });
        }
        const usage = record(payload.usage);
        const usedTokens = number(usage.total_tokens) ?? number(usage.total);
        if (usedTokens !== undefined) {
          yield* publish({
            type: "thread.token-usage.updated",
            ...(yield* stamp()),
            ...base(context, event),
            payload: { usage: { usedTokens: Math.max(0, Math.trunc(usedTokens)) } },
          });
        }
        yield* finishTurn(
          context,
          status === "error" ? "failed" : status === "interrupted" ? "cancelled" : "completed",
          text(payload.warning),
        );
        return;
      }
      case "thinking.delta":
      case "reasoning.delta":
      case "reasoning.available": {
        const delta = typeof payload.text === "string" ? payload.text : "";
        if (!delta) return;
        context.reasoningItemId ??= makeItemId(
          context,
          `${context.activeTurnId ?? "idle"}:reasoning`,
        );
        yield* publish({
          type: "content.delta",
          ...(yield* stamp()),
          ...base(context, event),
          itemId: context.reasoningItemId,
          payload: { streamKind: "reasoning_text", delta },
        });
        return;
      }
      case "tool.start": {
        const toolId = text(payload.tool_id) ?? (yield* uuid);
        const itemId = makeItemId(context, `tool:${toolId}`);
        const projection = projectHermesTool(payload);
        context.toolItems.set(toolId, { itemId, projection });
        yield* publish({
          type: "item.started",
          ...(yield* stamp()),
          ...base(context, event),
          itemId,
          providerRefs: { providerItemId: ProviderItemId.make(toolId) },
          payload: {
            itemType: projection.itemType,
            status: "inProgress",
            title: projection.title,
          },
        });
        yield* publish({
          type: "item.updated",
          ...(yield* stamp()),
          ...base(context, event),
          itemId,
          providerRefs: { providerItemId: ProviderItemId.make(toolId) },
          payload: {
            itemType: projection.itemType,
            status: "inProgress",
            title: projection.title,
            ...(projection.detail ? { detail: projection.detail } : {}),
            data: projection.data,
          },
        });
        return;
      }
      case "tool.progress": {
        yield* publish({
          type: "tool.progress",
          ...(yield* stamp()),
          ...base(context, event),
          payload: {
            ...(text(payload.name) ? { toolName: text(payload.name) } : {}),
            ...(text(payload.preview) ? { summary: text(payload.preview) } : {}),
          },
        });
        return;
      }
      case "tool.complete": {
        const toolId = text(payload.tool_id);
        const startedTool = toolId ? context.toolItems.get(toolId) : undefined;
        const projection = projectHermesTool(payload, startedTool?.projection, "completed");
        const failure = text(payload.error);
        yield* publish({
          type: "item.completed",
          ...(yield* stamp()),
          ...base(context, event),
          ...(startedTool ? { itemId: startedTool.itemId } : {}),
          payload: {
            itemType: projection.itemType,
            status: failure ? "failed" : "completed",
            title: projection.title,
            ...(projection.detail ? { detail: projection.detail } : {}),
            data: projection.data,
          },
        });
        if (toolId) context.toolItems.delete(toolId);
        return;
      }
      case "approval.request": {
        if (shouldAutoApproveHermes(context.session.runtimeMode)) {
          yield* request(context, "approval.respond", {
            session_id: context.liveSessionId,
            choice: "once",
          }).pipe(Effect.ignore);
          return;
        }
        const requestId = ApprovalRequestId.make(yield* uuid);
        context.pendingInteractions.set(requestId, {
          kind: "approval",
          requestType: "command_execution_approval",
        });
        yield* publish({
          type: "request.opened",
          ...(yield* stamp()),
          ...base(context, event),
          requestId: RuntimeRequestId.make(requestId),
          payload: {
            requestType: "command_execution_approval",
            detail: text(payload.description) ?? "Hermes requested approval to run a command.",
            args: payload,
          },
        });
        return;
      }
      case "clarify.request": {
        const gatewayRequestId = text(payload.request_id);
        if (!gatewayRequestId) return;
        const choices = Array.isArray(payload.choices)
          ? payload.choices.filter(
              (choice): choice is string => typeof choice === "string" && !!choice.trim(),
            )
          : undefined;
        yield* openUserInput(context, event, {
          gatewayRequestId,
          method: "clarify.respond",
          answerKey: "answer",
          questionId: "answer",
          header: "Hermes question",
          question: text(payload.question) ?? "Hermes needs more information.",
          ...(choices ? { choices } : {}),
        });
        return;
      }
      case "sudo.request": {
        const gatewayRequestId = text(payload.request_id);
        if (!gatewayRequestId) return;
        yield* openUserInput(context, event, {
          gatewayRequestId,
          method: "sudo.respond",
          answerKey: "password",
          questionId: "password",
          header: "Administrator access",
          question: "Hermes needs the administrator password to continue.",
        });
        return;
      }
      case "secret.request": {
        const gatewayRequestId = text(payload.request_id);
        if (!gatewayRequestId) return;
        const envVar = text(payload.env_var);
        yield* openUserInput(context, event, {
          gatewayRequestId,
          method: "secret.respond",
          answerKey: "value",
          questionId: envVar ?? "value",
          header: envVar ?? "Secret required",
          question: text(payload.prompt) ?? "Hermes needs a secret value to continue.",
        });
        return;
      }
      case "sudo.expire":
      case "secret.expire": {
        const gatewayRequestId = text(payload.request_id);
        if (!gatewayRequestId) return;
        yield* abandonPendingInteractions(
          context,
          (pending) =>
            pending.kind === "user-input" && pending.gatewayRequestId === gatewayRequestId,
        );
        return;
      }
      case "subagent.spawn_requested":
      case "subagent.start":
      case "subagent.thinking":
      case "subagent.tool":
      case "subagent.progress":
      case "subagent.complete": {
        const subagentId = text(payload.subagent_id);
        if (!subagentId) return;
        const taskId = RuntimeTaskId.make(subagentId);
        const description =
          text(payload.goal) ??
          text(payload.description) ??
          (event.type === "subagent.tool"
            ? `Hermes subagent used ${text(payload.tool_name) ?? "a tool"}`
            : "Hermes subagent");
        const progressSummary =
          text(payload.summary) ?? text(payload.text) ?? text(payload.tool_preview);
        if (event.type === "subagent.complete") {
          yield* publish({
            type: "task.completed",
            ...(yield* stamp()),
            ...base(context, event),
            payload: {
              taskId,
              status:
                text(payload.status) === "failed"
                  ? "failed"
                  : text(payload.status) === "stopped"
                    ? "stopped"
                    : "completed",
              ...(text(payload.summary) ? { summary: text(payload.summary) } : {}),
            },
          });
        } else if (event.type === "subagent.start" || event.type === "subagent.spawn_requested") {
          yield* publish({
            type: "task.started",
            ...(yield* stamp()),
            ...base(context, event),
            payload: {
              taskId,
              description,
              taskType: "hermes-subagent",
            },
          });
        } else {
          yield* publish({
            type: "task.progress",
            ...(yield* stamp()),
            ...base(context, event),
            payload: {
              taskId,
              description,
              ...(progressSummary ? { summary: progressSummary } : {}),
              ...(text(payload.tool_name) ? { lastToolName: text(payload.tool_name) } : {}),
            },
          });
        }
        return;
      }
      case "background.complete": {
        const taskId = RuntimeTaskId.make(text(payload.task_id) ?? (yield* uuid));
        yield* publish({
          type: "task.completed",
          ...(yield* stamp()),
          ...base(context, event),
          payload: {
            taskId,
            status: "completed",
            ...(text(payload.text) ? { summary: text(payload.text) } : {}),
          },
        });
        return;
      }
      case "status.update":
      case "notification.show": {
        const message = text(payload.text) ?? text(payload.message);
        if (message) {
          yield* publish({
            type: "runtime.warning",
            ...(yield* stamp()),
            ...base(context, event),
            payload: { message, detail: payload },
          });
        }
        return;
      }
      case "error": {
        const message = text(payload.message) ?? "Hermes reported an unknown gateway error.";
        yield* publish({
          type: "runtime.error",
          ...(yield* stamp()),
          ...base(context, event),
          payload: { message, class: "provider_error", detail: payload },
        });
        yield* finishTurn(context, "failed", message);
        return;
      }
      default:
        return;
    }
  });

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
    withLock(
      input.threadId,
      Effect.gen(function* () {
        const existing = sessions.get(input.threadId);
        if (existing && !existing.stopped) return existing.session;
        let context: HermesSessionContext | undefined;
        const client = yield* runtime.connect((event) => {
          if (context) runFork(Queue.offer(context.eventQueue, event));
        });
        const cursor = parseHermesGatewayConversationCursor(input.resumeCursor);
        const requestedModel =
          !input.modelSelection || input.modelSelection.instanceId === boundInstanceId
            ? parseHermesModelSelection(input.modelSelection?.model)
            : undefined;
        const cwd = input.cwd ?? process.cwd();
        const response = yield* Effect.tryPromise({
          try: () =>
            cursor
              ? client.request<SessionStartResponse>("session.resume", {
                  session_id: cursor.sessionId,
                  source: "t3-code",
                  close_on_disconnect: true,
                })
              : client.request<SessionStartResponse>("session.create", {
                  cwd,
                  source: "t3-code",
                  close_on_disconnect: true,
                  ...(requestedModel
                    ? {
                        model: requestedModel.model,
                        ...(requestedModel.provider ? { provider: requestedModel.provider } : {}),
                      }
                    : {}),
                }),
          catch: (cause) =>
            gatewayRequestError(
              input.threadId,
              cursor ? "session.resume" : "session.create",
              cause,
            ),
        }).pipe(Effect.onError(() => Effect.sync(() => client.close())));
        const info = record(response.info);
        const contract = number(info.desktop_contract);
        if (contract !== undefined && contract < HERMES_GATEWAY_MIN_DESKTOP_CONTRACT) {
          client.close();
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "startSession",
            issue: `Hermes gateway contract ${contract} is too old; contract ${HERMES_GATEWAY_MIN_DESKTOP_CONTRACT} or newer is required.`,
          });
        }
        const infoModel = text(info.model);
        const infoProvider = text(info.provider);
        const gatewayModel = infoModel
          ? infoProvider
            ? `${infoProvider}:${infoModel}`
            : infoModel
          : undefined;
        const currentModel = requestedModel?.id ?? gatewayModel;
        const storedSessionId =
          response.stored_session_id ??
          response.session_key ??
          response.resumed ??
          cursor?.sessionId;
        if (!storedSessionId) {
          client.close();
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "startSession",
            issue: "Hermes did not return a durable session identifier.",
          });
        }
        const now = yield* nowIso;
        const session: ProviderSession = {
          provider: HERMES_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          ...(currentModel ? { model: currentModel } : {}),
          threadId: input.threadId,
          resumeCursor: {
            schemaVersion: HERMES_GATEWAY_RESUME_SCHEMA_VERSION,
            transport: "tui-gateway",
            sessionId: storedSessionId,
          },
          createdAt: now,
          updatedAt: now,
        };
        context = {
          threadId: input.threadId,
          client,
          liveSessionId: response.session_id,
          pendingInteractions: new Map(),
          toolItems: new Map(),
          eventQueue: yield* Queue.unbounded<HermesGatewayEvent>(),
          session,
          turns: [],
          activeTurnId: undefined,
          assistantItemId: undefined,
          assistantSegmentIndex: 0,
          assistantText: "",
          assistantInterimTexts: [],
          reasoningItemId: undefined,
          currentModelId: currentModel,
          stopped: false,
        };
        sessions.set(input.threadId, context);
        yield* Queue.take(context.eventQueue).pipe(
          Effect.flatMap((event) => handleGatewayEvent(context!, event)),
          Effect.forever,
          Effect.forkIn(parentScope),
        );

        if (cursor && requestedModel && requestedModel.id !== gatewayModel) {
          yield* request(context, "config.set", {
            session_id: context.liveSessionId,
            key: "model",
            value: requestedModel.provider
              ? `${requestedModel.model} --provider ${requestedModel.provider}`
              : requestedModel.model,
          });
        }
        yield* publish({
          type: "session.started",
          ...(yield* stamp()),
          provider: HERMES_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { resume: session.resumeCursor },
        });
        yield* publish({
          type: "thread.started",
          ...(yield* stamp()),
          provider: HERMES_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          payload: { providerThreadId: storedSessionId },
        });
        return session;
      }),
    );

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    withLock(
      input.threadId,
      Effect.gen(function* () {
        const context = yield* requireSession(input.threadId);
        const prompt = input.input?.trim() ?? "";
        const attachments = input.attachments ?? [];
        const genericChatUserInput = extractGenericChatUserInput(prompt);
        const slashCommand = parseHermesSlashCommand(genericChatUserInput ?? prompt);
        const prepareCommandPrompt =
          genericChatUserInput === undefined
            ? (message: string) => message
            : buildGenericChatProviderInput;
        if (!prompt && attachments.length === 0) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "sendTurn",
            issue: "A Hermes turn requires text or an attachment.",
          });
        }
        if (slashCommand && attachments.length > 0) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "sendTurn",
            issue: "Hermes slash commands do not support image attachments.",
          });
        }
        if (context.activeTurnId) {
          if (!prompt || attachments.length > 0) {
            return yield* new ProviderAdapterValidationError({
              provider: HERMES_DRIVER_KIND,
              operation: "sendTurn",
              issue: "Only text can be steered into an active Hermes turn.",
            });
          }
          yield* request(context, "session.steer", {
            session_id: context.liveSessionId,
            text: prompt,
          });
          return {
            threadId: input.threadId,
            turnId: context.activeTurnId,
            resumeCursor: context.session.resumeCursor,
          };
        }

        const requestedModel =
          input.modelSelection?.instanceId === boundInstanceId
            ? parseHermesModelSelection(input.modelSelection.model)
            : undefined;
        if (requestedModel && requestedModel.id !== context.currentModelId) {
          yield* request(context, "config.set", {
            session_id: context.liveSessionId,
            key: "model",
            value: requestedModel.provider
              ? `${requestedModel.model} --provider ${requestedModel.provider}`
              : requestedModel.model,
          });
          context.currentModelId = requestedModel.id;
        }
        for (const attachment of attachments) {
          const attachmentPath = resolveAttachmentPath({
            attachmentsDir: serverConfig.attachmentsDir,
            attachment,
          });
          if (!attachmentPath) {
            return yield* new ProviderAdapterValidationError({
              provider: HERMES_DRIVER_KIND,
              operation: "sendTurn",
              issue: `Attachment is not available: ${attachment.name}`,
            });
          }
          yield* request(context, "image.attach", {
            session_id: context.liveSessionId,
            path: attachmentPath,
          });
        }

        const turnId = TurnId.make(yield* uuid);
        context.activeTurnId = turnId;
        context.turns = [...context.turns, { id: turnId, items: [{ prompt, attachments }] }];
        context.session = {
          ...context.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: yield* nowIso,
          ...(context.currentModelId ? { model: context.currentModelId } : {}),
        };
        yield* publish({
          type: "turn.started",
          ...(yield* stamp()),
          provider: HERMES_DRIVER_KIND,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          turnId,
          payload: context.currentModelId ? { model: context.currentModelId } : {},
        });
        // Hermes keeps prompt.submit and some slash commands pending while they run.
        // Supervise either path in the adapter scope so sendTurn returns immediately
        // and T3 can continue receiving ordered gateway events.
        yield* (
          slashCommand
            ? executeSlashCommand(context, slashCommand, prepareCommandPrompt)
            : submitPrompt(context, prompt || "Please inspect the attached image.")
        ).pipe(
          Effect.tapError((error) => finishTurn(context, "failed", error.message)),
          Effect.ignore,
          Effect.forkIn(parentScope),
        );
        return { threadId: input.threadId, turnId, resumeCursor: context.session.resumeCursor };
      }),
    );

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
    threadId,
    requestedTurnId,
  ) =>
    withLock(
      threadId,
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (requestedTurnId && context.activeTurnId && requestedTurnId !== context.activeTurnId)
          return;
        yield* request(context, "session.interrupt", { session_id: context.liveSessionId }).pipe(
          Effect.ignore,
        );
        yield* finishTurn(context, "cancelled");
      }),
    );

  const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
    threadId,
    requestId,
    decision,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const pending = context.pendingInteractions.get(requestId);
      if (!pending || pending.kind !== "approval") {
        return yield* gatewayRequestError(
          threadId,
          "approval.respond",
          new Error(`Unknown pending approval request: ${requestId}`),
        );
      }
      yield* request(context, "approval.respond", {
        session_id: context.liveSessionId,
        choice: hermesApprovalChoice(decision),
      });
      context.pendingInteractions.delete(requestId);
      yield* publish({
        type: "request.resolved",
        ...(yield* stamp()),
        provider: HERMES_DRIVER_KIND,
        providerInstanceId: boundInstanceId,
        threadId,
        ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
        requestId: RuntimeRequestId.make(requestId),
        payload: { requestType: pending.requestType, decision },
      });
    });

  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
    threadId,
    requestId,
    answers,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const pending = context.pendingInteractions.get(requestId);
      if (!pending || pending.kind !== "user-input") {
        return yield* gatewayRequestError(
          threadId,
          "clarify.respond",
          new Error(`Unknown pending user-input request: ${requestId}`),
        );
      }
      yield* request(context, pending.method, {
        session_id: context.liveSessionId,
        request_id: pending.gatewayRequestId,
        [pending.answerKey]: answerText(answers[pending.questionId]),
      });
      context.pendingInteractions.delete(requestId);
      yield* publish({
        type: "user-input.resolved",
        ...(yield* stamp()),
        provider: HERMES_DRIVER_KIND,
        providerInstanceId: boundInstanceId,
        threadId,
        ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
        requestId: RuntimeRequestId.make(requestId),
        payload: {
          answers:
            pending.method === "clarify.respond" ? answers : { [pending.questionId]: "[redacted]" },
        },
      });
    });

  const stopSessionInternal = Effect.fn("HermesAdapter.stopSessionInternal")(function* (
    context: HermesSessionContext,
  ) {
    if (context.stopped) return;
    yield* abandonPendingInteractions(context);
    context.stopped = true;
    yield* request(context, "session.close", { session_id: context.liveSessionId }).pipe(
      Effect.ignore,
    );
    context.client.close();
    sessions.delete(context.threadId);
    const { activeTurnId: _activeTurnId, ...session } = context.session;
    context.session = { ...session, status: "closed", updatedAt: yield* nowIso };
    yield* publish({
      type: "session.exited",
      ...(yield* stamp()),
      provider: HERMES_DRIVER_KIND,
      providerInstanceId: boundInstanceId,
      threadId: context.threadId,
      payload: { reason: "stopped", exitKind: "graceful" },
    });
  });

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      return { threadId, turns: context.turns };
    });
  const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
    threadId,
    numTurns,
  ) =>
    withLock(
      threadId,
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        if (context.activeTurnId) {
          return yield* new ProviderAdapterValidationError({
            provider: HERMES_DRIVER_KIND,
            operation: "rollbackThread",
            issue: "Interrupt the active Hermes turn before rolling back.",
          });
        }
        for (let index = 0; index < numTurns; index += 1) {
          yield* request(context, "session.undo", { session_id: context.liveSessionId });
        }
        context.turns = context.turns.slice(0, Math.max(0, context.turns.length - numTurns));
        return { threadId, turns: context.turns };
      }),
    );
  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    withLock(threadId, requireSession(threadId).pipe(Effect.flatMap(stopSessionInternal)));
  const listSessions = () =>
    Effect.sync(() => Array.from(sessions.values(), (context) => ({ ...context.session })));
  const hasSession = (threadId: ThreadId) =>
    Effect.sync(() => {
      const context = sessions.get(threadId);
      return !!context && !context.stopped;
    });
  const stopAll = () =>
    Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

  yield* Effect.addFinalizer(() =>
    stopAll().pipe(Effect.ignore, Effect.andThen(PubSub.shutdown(events))),
  );

  return {
    provider: HERMES_DRIVER_KIND,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    streamEvents: Stream.fromPubSub(events),
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
