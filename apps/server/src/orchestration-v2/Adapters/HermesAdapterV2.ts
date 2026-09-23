/**
 * HermesAdapterV2 — orchestrator-v2 adapter for Hermes Agent over its TUI
 * gateway (JSON-RPC on an authenticated loopback WebSocket, contract 7).
 *
 * Tangent fork feature FORK-HERMES-001; the record is `docs/fork/hermes.md`.
 *
 * One provider session is one WebSocket connection and one live Hermes
 * session. Hermes owns the transcript; the provider thread's native id is the
 * durable Hermes session key (`stored_session_id`), never the short live id.
 *
 * Ordering: every gateway frame (event or server→client request) and every
 * synthetic completion from a supervised RPC enters one inbox and is handled
 * by one pump fiber under the session permit. Adapter calls that change turn
 * state take the same permit, so a terminal event can never overtake the
 * updates that precede it. The session manager already opens one runtime per
 * provider session, so no further per-thread locking is needed.
 *
 * Turn lifecycle: `prompt.submit` returns as soon as Hermes starts its run
 * thread; it is supervised in the session scope so `startTurn` returns at
 * once and steering and interrupts stay available. `message.complete` ends the
 * turn. Slash commands use `slash.exec`, falling back to `command.dispatch`;
 * a command that only prints output completes its turn with that output.
 *
 * Background turns: Hermes starts a turn itself when background work
 * finishes. With no T3 run active, its frames are buffered and one
 * adapter-buffered provider continuation is offered; the resulting
 * provider-created run replays the buffer and follows the turn live instead of
 * prompting (the same path ClaudeAdapterV2 uses for wake turns).
 */
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import {
  HermesSettings,
  type ModelSelection,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ProviderRef,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2ProviderTurnTokenUsage,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2Subagent,
  type OrchestrationV2TurnItem,
  type OrchestrationV2UserInputQuestion,
  type ProviderApprovalDecision,
  type ProviderInstanceId,
  type ProviderUserInputAnswers,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import {
  bufferHermesBackgroundItem,
  type HermesBackgroundBuffer,
} from "../../provider/hermes/HermesBackgroundTurns.ts";
import type {
  HermesGatewayConnection,
  HermesGatewayEvent,
  HermesServerRequest,
} from "../../provider/hermes/HermesGatewayClient.ts";
import {
  makeHermesGatewayRuntime,
  type HermesGatewayRuntime,
} from "../../provider/hermes/HermesGatewayRuntime.ts";
import {
  finiteNumber,
  HERMES_DRIVER_KIND,
  HERMES_MIN_GATEWAY_CONTRACT,
  hermesApprovalChoice,
  HermesGatewayError,
  hermesModelSwitchValue,
  hermesQualifiedModel,
  nonNegativeInteger,
  parseHermesModelSelection,
  record,
  shouldAutoApproveHermes,
  text,
} from "../../provider/hermes/HermesGatewaySupport.ts";
import {
  consumeHermesMediaText,
  renderHermesMediaText,
} from "../../provider/hermes/HermesMedia.ts";
import { projectHermesTool } from "../../provider/hermes/HermesTools.ts";
import { IdAllocatorV2 } from "../IdAllocator.ts";
import {
  ProviderAdapterEnsureThreadError,
  ProviderAdapterEventStreamError,
  ProviderAdapterForkThreadError,
  ProviderAdapterInterruptError,
  ProviderAdapterOpenSessionError,
  ProviderAdapterProtocolError,
  ProviderAdapterReadThreadSnapshotError,
  ProviderAdapterResumeThreadError,
  ProviderAdapterRollbackThreadError,
  ProviderAdapterRuntimeRequestResponseError,
  ProviderAdapterSteerRunError,
  ProviderAdapterTurnStartError,
  ProviderAdapterV2,
  type ProviderAdapterV2EnsureThreadInput,
  type ProviderAdapterV2Error,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2OpenSessionInput,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2Shape,
  type ProviderAdapterV2ThreadSnapshot,
  type ProviderAdapterV2TurnInput,
} from "../ProviderAdapter.ts";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "../ProviderAdapterDriver.ts";
import {
  type ProviderContinuationRequest,
  ProviderContinuationRequests,
} from "../ProviderContinuationRequests.ts";
import { makeProviderFailure, makeProviderFailureTurnItem } from "../ProviderFailure.ts";
import { turnScopedSelectionTransition } from "../ProviderSelectionTransition.ts";

const HERMES_PROVIDER = HERMES_DRIVER_KIND;
const DEFAULT_HERMES_SETTINGS = Schema.decodeSync(HermesSettings)({});

const STREAM_FLUSH_MS = 50;
const HERMES_REQUEST_TIMEOUT_MS = 120_000;
const HERMES_CLOSE_TIMEOUT_MS = 5_000;
const RECOMMENDED_CHOICE_SUFFIX = "(Recommended)";

const HermesProviderCapabilitiesV2 = {
  // Hermes enforces its own approval policy; T3 only mediates the prompts it raises.
  runtimePolicy: { enforcement: "client-boundary" },
  sessions: {
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: true,
    supportsProviderSwitchingViaHandoff: true,
    // Auto-approval reads each turn's runtime mode, so a mode change needs no restart.
    supportsRuntimeModeSwitchInSession: true,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: true,
    canReadThreadSnapshot: true,
    canRollbackThread: true,
    // `session.branch` has no documented durable result; forks use portable handoff.
    canForkThread: false,
    canForkFromTurn: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: true,
  },
  turns: {
    exposesNativeTurnId: false,
    emitsTurnStarted: true,
    emitsTurnCompleted: true,
    supportsInterrupt: true,
    supportsActiveSteering: true,
    supportsSteeringByInterruptRestart: false,
    supportsQueuedMessages: true,
    terminalStatusQuality: "strong",
  },
  streaming: {
    streamsAssistantText: true,
    streamsReasoning: true,
    streamsToolOutput: false,
    streamsPlanText: false,
    emitsMessageCompleted: true,
  },
  tools: {
    exposesToolItemIds: true,
    emitsToolStarted: true,
    emitsToolCompleted: true,
    emitsToolOutput: true,
    supportsMcpTools: true,
    supportsDynamicToolCallbacks: false,
  },
  approvals: {
    supportsCommandApproval: true,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
    supportsApplyPatchApproval: false,
    approvalsHaveNativeRequestIds: true,
    approvalCallbacksAreLiveOnly: true,
    approvalsCanOriginateFromSubagents: true,
  },
  planning: {
    emitsPlanUpdated: false,
    emitsTodoList: false,
    emitsProposedPlan: false,
    supportsStructuredQuestions: true,
    planDeltasHaveItemIds: false,
  },
  subagents: {
    supportsSubagents: true,
    exposesSubagentThreadIds: false,
    emitsSubagentLifecycle: true,
    canWaitForSubagents: false,
    canCloseSubagents: false,
    canForkSubagentThread: false,
  },
  context: {
    acceptsSystemContext: false,
    acceptsDeveloperContext: false,
    acceptsSyntheticUserContext: true,
    canGenerateSummaries: false,
    canConsumeHandoffSummaries: true,
    supportsDeltaHandoff: true,
    supportsFullThreadHandoff: true,
    maxRecommendedHandoffChars: null,
  },
  checkpointing: {
    appCanCheckpointFilesystem: true,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: true,
    providerRollbackReturnsSnapshot: true,
    providerCanReadConversationSnapshot: true,
  },
  identity: {
    nativeThreadIds: "strong",
    nativeTurnIds: "weak",
    nativeItemIds: "strong",
    nativeRequestIds: "strong",
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface HermesAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly runtime: HermesGatewayRuntime;
  /** Expands a leading `~/` in `MEDIA:` paths; the Hermes host is this server. */
  readonly homeDirectory: string | undefined;
  readonly idAllocator: IdAllocatorV2["Service"];
  readonly serverConfig: ServerConfig["Service"];
  /** Sink for background-turn continuation requests; defaults to dropping them. */
  readonly continuationRequests?: {
    readonly offer: (request: ProviderContinuationRequest) => Effect.Effect<void>;
  };
}

function providerRef(
  nativeId: string,
  strength: "strong" | "weak" = "strong",
): OrchestrationV2ProviderRef {
  return { driver: HERMES_PROVIDER, nativeId, strength };
}

// ── pure mapping helpers ──────────────────────────────────────

/** A final response marked `response_previewed` repeats the sealed interim segments. */
export function hermesFinalTail(finalText: string, interimTexts: ReadonlyArray<string>): string {
  let tail = finalText.trimStart();
  for (const segment of interimTexts) {
    const trimmed = segment.trim();
    if (trimmed && tail.startsWith(trimmed)) tail = tail.slice(trimmed.length).trimStart();
  }
  return tail;
}

function bareChoice(value: string): string {
  return value.endsWith(RECOMMENDED_CHOICE_SUFFIX)
    ? value.slice(0, -RECOMMENDED_CHOICE_SUFFIX.length).trim()
    : value;
}

function answerText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}

/** Multi-select answers use Hermes's JSON-array wire format. */
export function hermesClarifyAnswer(
  value: unknown,
  question: { readonly multiSelect: boolean; readonly choices: ReadonlyArray<string> },
): string {
  if (question.multiSelect) {
    const values = Array.isArray(value)
      ? value.map(String)
      : value === undefined
        ? []
        : [String(value)];
    return JSON.stringify(values.map(bareChoice));
  }
  const answer = answerText(value);
  return question.choices.includes(answer) ? bareChoice(answer) : answer;
}

function choices(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((choice): choice is string => typeof choice === "string" && choice.trim().length > 0)
    .map((choice) => choice.trim());
}

interface PendingQuestion {
  readonly id: string;
  /** Hermes `qid` for batched clarifications. */
  readonly qid?: string;
  readonly multiSelect: boolean;
  readonly choices: ReadonlyArray<string>;
  readonly question: OrchestrationV2UserInputQuestion;
}

function userQuestion(input: {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly choices: ReadonlyArray<string>;
  readonly multiSelect: boolean;
}): OrchestrationV2UserInputQuestion {
  return {
    id: input.id,
    header: input.header,
    question: input.question,
    // A question without options is a valid open-ended prompt.
    options: input.choices.map((choice) => ({
      label: choice,
      description: `Respond with ${choice}.`,
      value: choice,
    })),
    ...(input.multiSelect ? { multiSelect: true } : {}),
    allowCustomAnswer: true,
  };
}

/** Hermes clarify params → one question per `qid`, or a single question. */
function hermesClarifyQuestions(params: Readonly<Record<string, unknown>>): {
  readonly batch: boolean;
  readonly questions: ReadonlyArray<PendingQuestion>;
} {
  const batch: Array<PendingQuestion> = [];
  const seen = new Set<string>();
  if (Array.isArray(params.questions)) {
    for (const entry of params.questions) {
      const question = record(entry);
      const qid = text(question.qid);
      const prompt = text(question.question);
      if (!qid || !prompt || seen.has(qid)) continue;
      seen.add(qid);
      const options = choices(question.choices);
      const multiSelect = question.multi_select === true && options.length > 0;
      batch.push({
        id: qid,
        qid,
        multiSelect,
        choices: options,
        question: userQuestion({
          id: qid,
          header: `Hermes question ${batch.length + 1}`,
          question: prompt,
          choices: options,
          multiSelect,
        }),
      });
    }
  }
  if (batch.length > 0) return { batch: true, questions: batch };
  const options = choices(params.choices);
  const multiSelect = params.multi_select === true && options.length > 0;
  return {
    batch: false,
    questions: [
      {
        id: "answer",
        multiSelect,
        choices: options,
        question: userQuestion({
          id: "answer",
          header: "Hermes question",
          question: text(params.question) ?? "Hermes needs more information.",
          choices: options,
          multiSelect,
        }),
      },
    ],
  };
}

interface SlashCommand {
  readonly name: string;
  readonly arg: string;
  readonly command: string;
}

function parseHermesSlashCommand(value: string): SlashCommand | undefined {
  const command = value.trim();
  const match = /^\/([^/\s]+)(?:\s+([\s\S]*))?$/u.exec(command);
  if (!match?.[1]) return undefined;
  return { name: match[1], arg: match[2]?.trim() ?? "", command: command.slice(1) };
}

type CommandOutcome =
  | { readonly type: "output"; readonly output: string }
  | { readonly type: "alias"; readonly target: string }
  | { readonly type: "prompt"; readonly message: string; readonly notice?: string }
  | { readonly type: "prefill"; readonly message: string; readonly notice?: string };

/** `slash.exec` / `command.dispatch` results. */
export function parseHermesCommandOutcome(value: unknown): CommandOutcome {
  const payload = record(value);
  const type = payload.type;
  const notice = text(payload.notice);
  if (type === "alias" && text(payload.target)) {
    return { type: "alias", target: text(payload.target)!.trim() };
  }
  if ((type === "send" || type === "skill") && text(payload.message)) {
    return { type: "prompt", message: payload.message as string, ...(notice ? { notice } : {}) };
  }
  if (type === "prefill") {
    return {
      type: "prefill",
      message: typeof payload.message === "string" ? payload.message : "",
      ...(notice ? { notice } : {}),
    };
  }
  const output = text(payload.output) ?? notice ?? "(no output)";
  const warning = text(payload.warning);
  return { type: "output", output: warning ? `warning: ${warning}\n${output}` : output };
}

function tokenUsage(
  value: unknown,
  updatedAt: DateTime.Utc,
): OrchestrationV2ProviderTurnTokenUsage | undefined {
  const usage = record(value);
  const usedTokens = nonNegativeInteger(usage.context_used);
  if (usedTokens === undefined) return undefined;
  const maxTokens = nonNegativeInteger(usage.context_max);
  const inputTokens = nonNegativeInteger(usage.input);
  const cachedInputTokens = nonNegativeInteger(usage.cache_read);
  const outputTokens = nonNegativeInteger(usage.output);
  const reasoningOutputTokens = nonNegativeInteger(usage.reasoning);
  return {
    usedTokens,
    ...(maxTokens !== undefined && maxTokens > 0 ? { maxTokens } : {}),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(reasoningOutputTokens === undefined ? {} : { reasoningOutputTokens }),
    updatedAt: DateTime.formatIso(updatedAt),
  };
}

function subagentStatus(
  type: string,
  status: string | undefined,
): OrchestrationV2Subagent["status"] {
  if (type === "subagent.spawn_requested") return "pending";
  if (type !== "subagent.complete") return status === "queued" ? "pending" : "running";
  switch (status) {
    case "failed":
    case "error":
    case "timeout":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "completed";
  }
}

function errorDetail(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  return fallback;
}

// ── per-session state ─────────────────────────────────────────

interface StreamItem {
  readonly nativeItemId: string;
  readonly kind: "assistant_message" | "reasoning";
  readonly startedAt: DateTime.Utc;
  /** Rendered text (MEDIA directives already turned into links). */
  text: string;
  /** Raw text that may still be a partial `MEDIA:` directive. */
  mediaBuffer: string;
  completed: boolean;
  flushScheduled: boolean;
}

interface ActiveTurn {
  readonly turnInput: ProviderAdapterV2TurnInput;
  readonly providerTurn: OrchestrationV2ProviderTurn;
  readonly itemOrdinals: Map<string, number>;
  nextItemOrdinal: number;
  assistant: StreamItem | null;
  assistantSegment: number;
  interimTexts: Array<string>;
  reasoning: StreamItem | null;
  reasoningSegment: number;
  readonly toolStarts: Map<
    string,
    { payload: Readonly<Record<string, unknown>>; at: DateTime.Utc }
  >;
  readonly subagentStarts: Map<string, DateTime.Utc>;
  interrupted: boolean;
  failure: OrchestrationV2ProviderFailure | null;
  lastError: string | null;
  lastUsage: OrchestrationV2ProviderTurnTokenUsage | undefined;
  /** A slash command is running with no Hermes agent turn behind it. */
  commandOnly: boolean;
  /** Hermes has started this turn's agent run (`message.start` arrived). */
  hermesStarted: boolean;
  /** Submitted while Hermes was running its own background turn. */
  queuedBehindBackground: boolean;
  /** A slash command held until the background turn ends. */
  deferredStart: Effect.Effect<void> | null;
  /** Replayed deltas were shed, so sealed segments take Hermes's final text. */
  preferFinalText: boolean;
  readonly release: Effect.Effect<void>;
}

/**
 * A turn Hermes started itself with no T3 run behind it. Its frames are
 * buffered until the provider continuation run it offered attaches.
 */
interface BackgroundTurn extends HermesBackgroundBuffer {
  /** Hermes has not reported `message.complete` for it yet. */
  running: boolean;
  /** The continuation was dropped or the session closed; frames are discarded. */
  dropped: boolean;
  readonly release: Effect.Effect<void>;
}

/** Status kinds Hermes emits just before it runs a notification turn. */
const BACKGROUND_NOTICE_KINDS: ReadonlySet<string> = new Set([
  "process",
  "loop",
  "heartbeat",
  "goal",
]);
const BACKGROUND_NOTICE_MAX_CHARS = 2_000;

/** A continuation run the adapter-buffered wake created (see ProviderContinuationService). */
function isProviderContinuationTurn(input: ProviderAdapterV2TurnInput): boolean {
  return input.message.createdBy === "agent" && input.message.creationSource === "provider";
}

interface PendingRequest {
  readonly srqId: string;
  readonly method: "approval" | "clarify" | "sudo" | "secret";
  readonly batch: boolean;
  readonly questions: ReadonlyArray<PendingQuestion>;
  runtimeRequest: OrchestrationV2RuntimeRequest;
  readonly node: OrchestrationV2ExecutionNode;
  readonly turnItem: OrchestrationV2TurnItem;
}

interface ThreadState {
  providerThread: OrchestrationV2ProviderThread;
  readonly liveSessionId: string;
  activeTurn: ActiveTurn | null;
}

type InboxItem =
  | { readonly kind: "event"; readonly event: HermesGatewayEvent }
  | { readonly kind: "request"; readonly request: HermesServerRequest }
  | { readonly kind: "closed" }
  | {
      readonly kind: "command_output";
      readonly providerTurnId: OrchestrationV2ProviderTurn["id"];
      readonly output: string;
      readonly complete: boolean;
    }
  | {
      readonly kind: "turn_failed";
      readonly providerTurnId: OrchestrationV2ProviderTurn["id"];
      readonly message: string;
    }
  | { readonly kind: "prompt_started"; readonly providerTurnId: OrchestrationV2ProviderTurn["id"] }
  | {
      readonly kind: "interrupt_settled";
      readonly providerTurnId: OrchestrationV2ProviderTurn["id"];
    };

// ── adapter ───────────────────────────────────────────────────

export function makeHermesAdapterV2(options: HermesAdapterV2Options): ProviderAdapterV2Shape {
  const { idAllocator, runtime } = options;
  const continuationRequests = options.continuationRequests ?? { offer: () => Effect.void };

  const protocolError = (detail: string, payload?: unknown) =>
    new ProviderAdapterProtocolError({
      driver: HERMES_PROVIDER,
      detail,
      ...(payload === undefined ? {} : { payload }),
    });

  return ProviderAdapterV2.of({
    instanceId: options.instanceId,
    driver: HERMES_PROVIDER,
    getCapabilities: () => Effect.succeed(HermesProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed(turnScopedSelectionTransition()),
    openSession: Effect.fn("HermesAdapterV2.openSession")(function* (
      input: ProviderAdapterV2OpenSessionInput,
    ) {
      const scope = yield* Effect.scope;
      const cwd = input.runtimePolicy.cwd ?? options.serverConfig.cwd;
      const inbox = yield* Queue.unbounded<InboxItem>();
      const events = yield* Queue.unbounded<
        ProviderAdapterV2Event,
        ProviderAdapterV2Error | Cause.Done
      >();
      const permit = yield* Semaphore.make(1);
      const pendingRequests = new Map<string, PendingRequest>();
      let threadState: ThreadState | null = null;
      let stopRequested = false;
      /** Last model applied with `config.set`, or the model the session was created with. */
      let appliedModel: string | null = null;
      /** The profile's model, restored when the selection returns to "default". */
      let baselineModel: string | null = null;
      let contextWindow: number | null = null;
      /** Self-started Hermes turns waiting for their continuation run, oldest first. */
      const backgrounds: Array<BackgroundTurn> = [];
      /** Latest background-work notice, used as the continuation's detail. */
      let backgroundNotice: string | null = null;

      const connection: HermesGatewayConnection = yield* runtime
        .connect(
          {
            onEvent: (event) => Queue.offerUnsafe(inbox, { kind: "event", event }),
            onServerRequest: (request) => Queue.offerUnsafe(inbox, { kind: "request", request }),
            onClose: () => Queue.offerUnsafe(inbox, { kind: "closed" }),
          },
          { answersServerRequests: true },
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterOpenSessionError({
                driver: HERMES_PROVIDER,
                providerSessionId: input.providerSessionId,
                cause,
              }),
          ),
        );

      const rpc = <T = unknown>(
        method: string,
        params: Readonly<Record<string, unknown>> = {},
        timeoutMs = HERMES_REQUEST_TIMEOUT_MS,
      ) =>
        Effect.tryPromise({
          try: (signal) => connection.request<T>(method, params, { signal, timeoutMs }),
          catch: (cause) =>
            new HermesGatewayError({
              method,
              detail: errorDetail(cause, `Hermes gateway request failed: ${method}`),
              ...(typeof (cause as { code?: unknown })?.code === "number"
                ? { code: (cause as { code: number }).code }
                : {}),
              cause,
            }),
        });

      const reply = (id: string, result: Readonly<Record<string, unknown>>) =>
        Effect.try({
          try: () => connection.respond(id, result),
          catch: (cause) =>
            new HermesGatewayError({
              detail: errorDetail(cause, "Hermes gateway reply failed."),
              cause,
            }),
        });
      const refuse = (id: string, message: string) =>
        Effect.sync(() => {
          try {
            connection.respondError(id, -32601, message);
          } catch {
            // The socket is gone; Hermes withdraws the request itself.
          }
        });

      const now = yield* DateTime.now;
      let sessionEntity: OrchestrationV2ProviderSession = {
        id: input.providerSessionId,
        driver: HERMES_PROVIDER,
        providerInstanceId: options.instanceId,
        status: "ready",
        cwd,
        model: input.modelSelection.model,
        capabilities: HermesProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };

      const emit = (event: ProviderAdapterV2Event) =>
        Queue.offer(events, event).pipe(Effect.asVoid);

      const updateProviderSession = (
        status: OrchestrationV2ProviderSession["status"],
        lastError: string | null = sessionEntity.lastError,
      ) =>
        Effect.gen(function* () {
          sessionEntity = { ...sessionEntity, status, lastError, updatedAt: yield* DateTime.now };
          yield* emit({
            type: "provider_session.updated",
            driver: HERMES_PROVIDER,
            providerSession: sessionEntity,
          });
        });

      const updateProviderThread = (
        state: ThreadState,
        patch: Partial<OrchestrationV2ProviderThread>,
      ) =>
        Effect.gen(function* () {
          state.providerThread = {
            ...state.providerThread,
            ...patch,
            updatedAt: yield* DateTime.now,
          };
          yield* emit({
            type: "provider_thread.updated",
            driver: HERMES_PROVIDER,
            providerThread: state.providerThread,
          });
        });

      const itemOrdinal = (turn: ActiveTurn, nativeItemId: string): number => {
        const existing = turn.itemOrdinals.get(nativeItemId);
        if (existing !== undefined) return existing;
        const ordinal = turn.nextItemOrdinal++;
        turn.itemOrdinals.set(nativeItemId, ordinal);
        return ordinal;
      };

      const baseItemFields = (
        turn: ActiveTurn,
        nativeItemId: string,
        startedAt: DateTime.Utc,
        updatedAt: DateTime.Utc,
      ) => ({
        id: idAllocator.derive.turnItemFromProviderItem({ driver: HERMES_PROVIDER, nativeItemId }),
        threadId: turn.turnInput.threadId,
        runId: turn.turnInput.runId,
        nodeId: idAllocator.derive.nodeFromProviderItem({ driver: HERMES_PROVIDER, nativeItemId }),
        providerThreadId: turn.turnInput.providerThread.id,
        providerTurnId: turn.providerTurn.id,
        nativeItemRef: providerRef(nativeItemId),
        parentItemId: null,
        ordinal: itemOrdinal(turn, nativeItemId),
        startedAt,
        updatedAt,
      });

      const emitItemNode = (
        turn: ActiveTurn,
        nativeItemId: string,
        kind: OrchestrationV2ExecutionNode["kind"],
        status: OrchestrationV2ExecutionNode["status"],
        startedAt: DateTime.Utc,
        completedAt: DateTime.Utc | null,
      ) =>
        emit({
          type: "node.updated",
          driver: HERMES_PROVIDER,
          node: {
            id: idAllocator.derive.nodeFromProviderItem({ driver: HERMES_PROVIDER, nativeItemId }),
            threadId: turn.turnInput.threadId,
            runId: turn.turnInput.runId,
            parentNodeId: turn.turnInput.rootNodeId,
            rootNodeId: turn.turnInput.rootNodeId,
            kind,
            status,
            countsForRun: false,
            providerThreadId: turn.turnInput.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            nativeItemRef: providerRef(nativeItemId),
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt,
            completedAt,
          },
        });

      // ── streaming text / reasoning ────────────────────────

      const emitStreamItem = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        item: StreamItem,
        streaming: boolean,
      ) {
        const emittedAt = yield* DateTime.now;
        const base = baseItemFields(turn, item.nativeItemId, item.startedAt, emittedAt);
        const status = streaming ? "running" : "completed";
        const completedAt = streaming ? null : emittedAt;
        yield* emitItemNode(
          turn,
          item.nativeItemId,
          item.kind,
          status,
          item.startedAt,
          completedAt,
        );
        if (item.kind === "reasoning") {
          yield* emit({
            type: "turn_item.updated",
            driver: HERMES_PROVIDER,
            turnItem: {
              ...base,
              status,
              title: null,
              completedAt,
              type: "reasoning",
              text: item.text,
              streaming,
            },
          });
          return;
        }
        const messageId = idAllocator.derive.messageFromProviderItem({
          driver: HERMES_PROVIDER,
          nativeItemId: item.nativeItemId,
        });
        yield* emit({
          type: "turn_item.updated",
          driver: HERMES_PROVIDER,
          turnItem: {
            ...base,
            status,
            title: null,
            completedAt,
            type: "assistant_message",
            messageId,
            text: item.text,
            streaming,
          },
        });
        yield* emit({
          type: "message.updated",
          driver: HERMES_PROVIDER,
          message: {
            id: messageId,
            threadId: turn.turnInput.threadId,
            runId: turn.turnInput.runId,
            nodeId: base.nodeId,
            role: "assistant",
            text: item.text,
            attachments: [],
            streaming,
            createdBy: "agent",
            creationSource: "provider",
            createdAt: item.startedAt,
            updatedAt: emittedAt,
          },
        });
      });

      const scheduleFlush = (turn: ActiveTurn, item: StreamItem) =>
        Effect.suspend(() => {
          if (item.flushScheduled || item.completed) return Effect.void;
          item.flushScheduled = true;
          return Effect.sleep(Duration.millis(STREAM_FLUSH_MS)).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                item.flushScheduled = false;
                return item.completed ? Effect.void : emitStreamItem(turn, item, true);
              }),
            ),
            Effect.forkIn(scope),
            Effect.asVoid,
          );
        });

      const newStreamItem = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        kind: StreamItem["kind"],
      ) {
        const nativeItemId =
          kind === "assistant_message"
            ? `${turn.providerTurn.id}:assistant:${turn.assistantSegment}`
            : `${turn.providerTurn.id}:reasoning:${turn.reasoningSegment}`;
        const item: StreamItem = {
          nativeItemId,
          kind,
          startedAt: yield* DateTime.now,
          text: "",
          mediaBuffer: "",
          completed: false,
          flushScheduled: false,
        };
        itemOrdinal(turn, nativeItemId);
        return item;
      });

      const appendAssistant = Effect.fnUntraced(function* (turn: ActiveTurn, delta: string) {
        if (!delta) return;
        const item = turn.assistant ?? (yield* newStreamItem(turn, "assistant_message"));
        turn.assistant = item;
        const consumed = consumeHermesMediaText(
          `${item.mediaBuffer}${delta}`,
          false,
          options.homeDirectory,
        );
        item.mediaBuffer = consumed.pending;
        item.text += consumed.output;
        yield* scheduleFlush(turn, item);
      });

      /**
       * Seal the current assistant segment. `finalText` is Hermes's full text
       * for the segment; the streamed prefix is kept and only the remainder
       * appended, so a reconnecting client sees the same text either way.
       */
      const sealAssistant = Effect.fnUntraced(function* (turn: ActiveTurn, finalText?: string) {
        const item = turn.assistant;
        const rendered =
          finalText === undefined
            ? undefined
            : renderHermesMediaText(finalText, options.homeDirectory);
        if (item === null) {
          turn.assistant = null;
          if (!rendered?.trim()) return;
          const created = yield* newStreamItem(turn, "assistant_message");
          created.text = rendered;
          created.completed = true;
          yield* emitStreamItem(turn, created, false);
          turn.assistantSegment += 1;
          return;
        }
        item.text += consumeHermesMediaText(item.mediaBuffer, true, options.homeDirectory).output;
        item.mediaBuffer = "";
        if (rendered !== undefined) {
          if (rendered.startsWith(item.text) || (turn.preferFinalText && rendered.trim())) {
            item.text = rendered;
          } else if (!item.text) item.text = rendered;
        }
        item.completed = true;
        turn.assistant = null;
        turn.assistantSegment += 1;
        if (item.text.length > 0) yield* emitStreamItem(turn, item, false);
      });

      const sealReasoning = Effect.fnUntraced(function* (turn: ActiveTurn) {
        const item = turn.reasoning;
        if (item === null) return;
        item.completed = true;
        turn.reasoning = null;
        turn.reasoningSegment += 1;
        if (item.text.length > 0) yield* emitStreamItem(turn, item, false);
      });

      // ── tools and subagents ───────────────────────────────

      const emitTool = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        payload: Readonly<Record<string, unknown>>,
        phase: "start" | "complete",
      ) {
        const toolId = text(payload.tool_id);
        if (!toolId) return;
        const emittedAt = yield* DateTime.now;
        const started = turn.toolStarts.get(toolId);
        if (phase === "start") turn.toolStarts.set(toolId, { payload, at: emittedAt });
        const startedAt = started?.at ?? emittedAt;
        const projection = projectHermesTool(payload, started?.payload);
        const completed = phase === "complete";
        const status = !completed
          ? "running"
          : projection.failed
            ? turn.interrupted
              ? "interrupted"
              : "failed"
            : "completed";
        const nativeItemId = `tool:${toolId}`;
        yield* emitItemNode(
          turn,
          nativeItemId,
          "tool_call",
          status,
          startedAt,
          completed ? emittedAt : null,
        );
        yield* emit({
          type: "turn_item.updated",
          driver: HERMES_PROVIDER,
          turnItem: {
            ...baseItemFields(turn, nativeItemId, startedAt, emittedAt),
            status,
            title: projection.title,
            completedAt: completed ? emittedAt : null,
            ...projection.item,
          } as OrchestrationV2TurnItem,
        });
        if (completed) turn.toolStarts.delete(toolId);
      });

      const emitSubagent = Effect.fnUntraced(function* (
        turn: ActiveTurn,
        type: string,
        payload: Readonly<Record<string, unknown>>,
      ) {
        const subagentId = text(payload.subagent_id);
        if (!subagentId) return;
        const emittedAt = yield* DateTime.now;
        const nativeTaskId = `subagent:${subagentId}`;
        const startedAt = turn.subagentStarts.get(subagentId) ?? emittedAt;
        turn.subagentStarts.set(subagentId, startedAt);
        const status = subagentStatus(type, text(payload.status));
        const finished = type === "subagent.complete";
        const goal = text(payload.goal) ?? "Hermes subagent";
        const progressText =
          type === "subagent.tool"
            ? `Using ${text(payload.tool_name) ?? "a tool"}`
            : (text(payload.text) ?? text(payload.tool_preview));
        const progress = !finished && progressText ? { progress: progressText.slice(0, 200) } : {};
        const result = finished ? (text(payload.summary)?.slice(0, 10_000) ?? null) : null;
        const id = idAllocator.derive.nodeFromProviderItem({
          driver: HERMES_PROVIDER,
          nativeItemId: nativeTaskId,
        });
        yield* emit({
          type: "subagent.updated",
          driver: HERMES_PROVIDER,
          subagent: {
            id,
            threadId: turn.turnInput.threadId,
            runId: turn.turnInput.runId,
            parentNodeId: turn.turnInput.rootNodeId,
            origin: "provider_native",
            createdBy: "agent",
            driver: HERMES_PROVIDER,
            providerInstanceId: options.instanceId,
            providerThreadId: turn.turnInput.providerThread.id,
            childThreadId: null,
            nativeTaskRef: providerRef(subagentId),
            prompt: goal,
            title: goal.slice(0, 120),
            model: text(payload.model) ?? null,
            status,
            ...progress,
            result,
            startedAt,
            completedAt: finished ? emittedAt : null,
            updatedAt: emittedAt,
          },
        });
        yield* emit({
          type: "turn_item.updated",
          driver: HERMES_PROVIDER,
          turnItem: {
            ...baseItemFields(turn, nativeTaskId, startedAt, emittedAt),
            status,
            title: goal.slice(0, 120),
            completedAt: finished ? emittedAt : null,
            type: "subagent",
            subagentId: id,
            origin: "provider_native",
            driver: HERMES_PROVIDER,
            providerInstanceId: options.instanceId,
            childThreadId: null,
            prompt: goal,
            ...progress,
            result,
          },
        });
      });

      const reportUsage = Effect.fnUntraced(function* (turn: ActiveTurn, value: unknown) {
        const usage = tokenUsage(value, yield* DateTime.now);
        if (usage === undefined) return;
        if (usage.maxTokens !== undefined && usage.maxTokens !== null)
          contextWindow = usage.maxTokens;
        turn.lastUsage = usage;
        yield* emit({
          type: "provider_turn.updated",
          driver: HERMES_PROVIDER,
          threadId: turn.turnInput.threadId,
          providerTurn: { ...turn.providerTurn, tokenUsage: usage },
        });
      });

      // ── runtime requests ──────────────────────────────────

      const settleRequest = (
        pending: PendingRequest,
        status: "resolved" | "cancelled",
        resolvedAt: DateTime.Utc,
        extra: Partial<OrchestrationV2RuntimeRequest> = {},
      ) =>
        Effect.gen(function* () {
          pendingRequests.delete(pending.srqId);
          pending.runtimeRequest = { ...pending.runtimeRequest, ...extra, status, resolvedAt };
          const itemStatus = status === "resolved" ? "completed" : "cancelled";
          yield* emit({
            type: "runtime_request.updated",
            driver: HERMES_PROVIDER,
            threadId: pending.node.threadId,
            runtimeRequest: pending.runtimeRequest,
          });
          yield* emit({
            type: "node.updated",
            driver: HERMES_PROVIDER,
            node: { ...pending.node, status: itemStatus, completedAt: resolvedAt },
          });
          yield* emit({
            type: "turn_item.updated",
            driver: HERMES_PROVIDER,
            turnItem: {
              ...pending.turnItem,
              status: itemStatus,
              completedAt: resolvedAt,
              updatedAt: resolvedAt,
            },
          });
        });

      /** A "waiting on you" state must not outlive the Hermes callback it represents. */
      const cancelPendingRequests = (resolvedAt: DateTime.Utc) =>
        Effect.forEach(
          Array.from(pendingRequests.values()),
          (pending) =>
            refuse(pending.srqId, "The turn ended.").pipe(
              Effect.andThen(settleRequest(pending, "cancelled", resolvedAt)),
            ),
          { discard: true },
        );

      // ── background turns ──────────────────────────────────

      /** The self-started Hermes turn still running, if any. Hermes runs one turn at a time. */
      const runningBackground = () => {
        const newest = backgrounds.at(-1);
        return newest?.running === true ? newest : undefined;
      };

      /** Stop keeping a background turn; its continuation will find nothing to replay. */
      const dropBackground = (background: BackgroundTurn) =>
        Effect.gen(function* () {
          if (background.dropped) return;
          background.dropped = true;
          for (const item of background.items) {
            if (item.kind === "request") yield* refuse(item.request.id, "The turn ended.");
          }
          background.items.length = 0;
          yield* background.release;
          // A running turn stays listed so its remaining frames are swallowed, not re-offered.
          if (!background.running) backgrounds.splice(backgrounds.indexOf(background), 1);
        });

      const dropAllBackgrounds = Effect.suspend(() =>
        Effect.forEach([...backgrounds], dropBackground, { discard: true }).pipe(
          Effect.andThen(Effect.sync(() => (backgrounds.length = 0))),
        ),
      );

      /**
       * Hermes started a turn with no T3 run. Buffer it and offer one
       * adapter-buffered continuation so the orchestrator starts a run that
       * ingests it, exactly as ClaudeAdapterV2 does for background-task wakes.
       */
      const startBackground = Effect.fnUntraced(function* (state: ThreadState) {
        const background: BackgroundTurn = {
          items: [],
          deltasDropped: false,
          running: true,
          dropped: false,
          release: yield* runtime.trackTurn,
        };
        backgrounds.push(background);
        const notice = backgroundNotice;
        backgroundNotice = null;
        const drop = permit.withPermits(1)(dropBackground(background));
        yield* continuationRequests.offer({
          threadId: state.providerThread.appThreadId ?? input.threadId,
          providerThreadId: state.providerThread.id,
          driver: HERMES_PROVIDER,
          detail: notice,
          delivery: "adapter_buffered",
          notification: {
            source: { kind: "background_task" },
            outcome: "completed",
            summary: "Hermes background work finished",
            ...(notice === null ? {} : { detail: notice }),
          },
          clearIfCurrent: () => drop,
          dispatchIfCurrent: (dispatch) =>
            Effect.gen(function* () {
              if (background.dropped) return Option.none();
              const exit = yield* Effect.exit(dispatch);
              if (Exit.isFailure(exit)) {
                // No continuation run will arrive to claim the buffer.
                yield* drop;
                return yield* Effect.failCause(exit.cause);
              }
              return Option.some(exit.value);
            }),
        });
        return background;
      });

      const completeBackground = Effect.fnUntraced(function* (background: BackgroundTurn) {
        background.running = false;
        yield* background.release;
        if (background.dropped) backgrounds.splice(backgrounds.indexOf(background), 1);
        // A slash command sent during the background turn runs now that Hermes is idle.
        const waiting = threadState?.activeTurn ?? null;
        if (waiting?.deferredStart != null) {
          const start = waiting.deferredStart;
          waiting.deferredStart = null;
          yield* start;
        }
      });

      const handleServerRequest = Effect.fnUntraced(function* (request: HermesServerRequest) {
        const state = threadState;
        const sessionId = text(request.params.session_id);
        if (state !== null && sessionId !== undefined && sessionId !== state.liveSessionId) {
          return;
        }
        const method = request.method;
        if (
          method !== "approval" &&
          method !== "clarify" &&
          method !== "sudo" &&
          method !== "secret"
        ) {
          // Desktop-only bridges (terminal/preview/window reads, vault prompts, tours) have no T3 surface.
          yield* refuse(request.id, `T3 Code does not handle Hermes ${method} requests.`);
          return;
        }
        const turn = state?.activeTurn ?? null;
        const params = request.params;
        const runtimeMode =
          turn?.turnInput.runtimePolicy.runtimeMode ?? input.runtimePolicy.runtimeMode;
        if (method === "approval" && shouldAutoApproveHermes(runtimeMode)) {
          yield* reply(request.id, { choice: "once" }).pipe(Effect.ignore);
          return;
        }
        // A background turn's question joins its buffer and surfaces in the
        // continuation run. With a T3 run waiting behind it, it surfaces now so
        // the waiting run cannot deadlock on an unanswerable request.
        const background = runningBackground();
        if (background !== undefined && turn === null) {
          if (background.dropped) yield* refuse(request.id, "The turn ended.");
          else bufferHermesBackgroundItem(background, { kind: "request", request });
          return;
        }

        const nativeRequestId = text(params.request_id) ?? request.id;
        const createdAt = yield* DateTime.now;
        const requestId = yield* idAllocator.allocate.runtimeRequest({
          driver: HERMES_PROVIDER,
          ...(turn === null ? {} : { providerTurnId: turn.providerTurn.id }),
          nativeRequestId: request.id,
        });
        const nodeId = idAllocator.derive.approvalNode({ requestId });
        const threadId =
          turn?.turnInput.threadId ?? state?.providerThread.appThreadId ?? input.threadId;
        const providerThreadId = state?.providerThread.id ?? null;
        const providerTurnId = turn?.providerTurn.id ?? null;
        const isApproval = method === "approval";
        const runtimeRequest: OrchestrationV2RuntimeRequest = {
          id: requestId,
          nodeId,
          providerTurnId,
          nativeRequestRef: providerRef(nativeRequestId),
          kind: isApproval ? "command" : "user_input",
          status: "pending",
          responseCapability: { type: "live", providerSessionId: input.providerSessionId },
          createdAt,
          resolvedAt: null,
        };
        const node: OrchestrationV2ExecutionNode = {
          id: nodeId,
          threadId,
          runId: turn?.turnInput.runId ?? null,
          parentNodeId: turn?.turnInput.rootNodeId ?? null,
          rootNodeId: turn?.turnInput.rootNodeId ?? nodeId,
          kind: isApproval ? "approval_request" : "user_input_request",
          status: "waiting",
          countsForRun: false,
          providerThreadId,
          providerTurnId,
          nativeItemRef: providerRef(nativeRequestId),
          runtimeRequestId: requestId,
          checkpointScopeId: null,
          startedAt: createdAt,
          completedAt: null,
        };
        const itemBase = {
          id: idAllocator.derive.approvalTurnItem({ requestId }),
          threadId,
          runId: turn?.turnInput.runId ?? null,
          nodeId,
          providerThreadId,
          providerTurnId,
          nativeItemRef: providerRef(nativeRequestId),
          parentItemId: null,
          ordinal: turn === null ? 0 : itemOrdinal(turn, `request:${request.id}`),
          status: "waiting" as const,
          startedAt: createdAt,
          completedAt: null,
          updatedAt: createdAt,
        };

        let questions: ReadonlyArray<PendingQuestion> = [];
        let batch = false;
        let turnItem: OrchestrationV2TurnItem;
        if (isApproval) {
          const command = text(params.command);
          const description = text(params.description);
          turnItem = {
            ...itemBase,
            title: text(params.tool_name) ?? "Hermes approval",
            type: "approval_request",
            requestId,
            requestKind: "command",
            prompt:
              [description, command].filter(Boolean).join("\n\n") ||
              "Hermes requested approval to run a command.",
            options: [
              { decision: "accept", label: "Allow once" },
              ...(params.allow_session === false
                ? []
                : [{ decision: "acceptForSession" as const, label: "Allow for this session" }]),
              { decision: "decline", label: "Deny" },
            ],
          };
        } else {
          if (method === "clarify") {
            ({ batch, questions } = hermesClarifyQuestions(params));
          } else if (method === "sudo") {
            questions = [
              {
                id: "password",
                multiSelect: false,
                choices: [],
                question: userQuestion({
                  id: "password",
                  header: "Administrator access",
                  question: text(params.command)
                    ? `Hermes needs the administrator password to run:\n${text(params.command)}`
                    : "Hermes needs the administrator password to continue.",
                  choices: [],
                  multiSelect: false,
                }),
              },
            ];
          } else {
            const envVar = text(params.env_var) ?? "value";
            questions = [
              {
                id: envVar,
                multiSelect: false,
                choices: [],
                question: userQuestion({
                  id: envVar,
                  header: text(params.env_var) ?? "Secret required",
                  question: text(params.prompt) ?? "Hermes needs a secret value to continue.",
                  choices: [],
                  multiSelect: false,
                }),
              },
            ];
          }
          turnItem = {
            ...itemBase,
            title: method === "clarify" ? "Hermes question" : "Hermes needs input",
            type: "user_input_request",
            requestId,
            questions: questions.map((question) => question.question),
          };
        }

        pendingRequests.set(request.id, {
          srqId: request.id,
          method,
          batch,
          questions,
          runtimeRequest,
          node,
          turnItem,
        });
        yield* emit({
          type: "runtime_request.updated",
          driver: HERMES_PROVIDER,
          threadId,
          runtimeRequest,
        });
        yield* emit({ type: "node.updated", driver: HERMES_PROVIDER, node });
        yield* emit({ type: "turn_item.updated", driver: HERMES_PROVIDER, turnItem });
      });

      const answerRequest = Effect.fnUntraced(function* (
        pending: PendingRequest,
        decision: ProviderApprovalDecision | undefined,
        answers: ProviderUserInputAnswers | undefined,
      ) {
        if (pending.method === "approval") {
          yield* reply(pending.srqId, { choice: hermesApprovalChoice(decision ?? "cancel") });
          return;
        }
        const hasAnswers =
          answers !== undefined && pending.questions.some((question) => question.id in answers);
        if (!hasAnswers || decision === "decline" || decision === "cancel") {
          if (pending.batch) yield* reply(pending.srqId, {});
          else yield* refuse(pending.srqId, "The user dismissed the question.");
          return;
        }
        if (pending.method === "clarify" && pending.batch) {
          // Batched questions are locked one at a time; the last lock resolves the request.
          for (const question of pending.questions) {
            yield* rpc("clarify.lock", {
              request_id: pending.srqId,
              question_id: question.qid ?? question.id,
              answer: hermesClarifyAnswer(answers[question.id], question),
            });
          }
          return;
        }
        const question = pending.questions[0]!;
        yield* reply(
          pending.srqId,
          pending.method === "clarify"
            ? { answer: hermesClarifyAnswer(answers[question.id], question) }
            : { value: answerText(answers[question.id]) },
        );
      });

      // ── turn lifecycle ────────────────────────────────────

      const finalizeTurn = Effect.fnUntraced(function* (state: ThreadState) {
        const turn = state.activeTurn;
        if (turn === null) return;
        state.activeTurn = null;
        yield* sealReasoning(turn);
        yield* sealAssistant(turn);
        const completedAt = yield* DateTime.now;
        yield* cancelPendingRequests(completedAt);
        const failure = turn.interrupted ? null : turn.failure;
        const status = turn.interrupted ? "interrupted" : failure !== null ? "failed" : "completed";
        yield* emit({
          type: "provider_turn.updated",
          driver: HERMES_PROVIDER,
          threadId: turn.turnInput.threadId,
          providerTurn: {
            ...turn.providerTurn,
            status,
            completedAt,
            ...(turn.lastUsage === undefined ? {} : { tokenUsage: turn.lastUsage }),
          },
        });
        yield* updateProviderThread(state, { status: "idle" });
        yield* updateProviderSession(
          failure !== null ? "error" : "ready",
          failure?.message ?? null,
        );
        yield* turn.release;
        if (failure !== null) {
          const failureItemOrdinal = itemOrdinal(turn, `terminal-failure:${turn.providerTurn.id}`);
          yield* emit({
            type: "turn_item.updated",
            driver: HERMES_PROVIDER,
            turnItem: makeProviderFailureTurnItem({
              idAllocator,
              driver: HERMES_PROVIDER,
              threadId: turn.turnInput.threadId,
              runId: turn.turnInput.runId,
              nodeId: turn.turnInput.rootNodeId,
              providerThreadId: state.providerThread.id,
              providerTurnId: turn.providerTurn.id,
              itemOrdinal: failureItemOrdinal,
              failure,
              occurredAt: completedAt,
            }),
          });
          yield* emit({
            type: "turn.terminal",
            driver: HERMES_PROVIDER,
            providerThreadId: state.providerThread.id,
            providerTurnId: turn.providerTurn.id,
            runOrdinal: turn.turnInput.runOrdinal,
            failureItemOrdinal,
            status: "failed",
            failure,
            threadDisposition: "reusable",
          });
          return;
        }
        yield* emit({
          type: "turn.terminal",
          driver: HERMES_PROVIDER,
          providerThreadId: state.providerThread.id,
          providerTurnId: turn.providerTurn.id,
          runOrdinal: turn.turnInput.runOrdinal,
          status: turn.interrupted ? "interrupted" : "completed",
          failure: null,
          threadDisposition: "reusable",
        });
      });

      const activeTurnFor = (providerTurnId: OrchestrationV2ProviderTurn["id"]) => {
        const turn = threadState?.activeTurn ?? null;
        return turn !== null && turn.providerTurn.id === providerTurnId ? turn : null;
      };

      const handleEvent = Effect.fnUntraced(function* (event: HermesGatewayEvent) {
        const state = threadState;
        if (state === null) return;
        if (event.session_id && event.session_id !== state.liveSessionId) return;
        const payload = record(event.payload);

        switch (event.type) {
          case "session.info": {
            yield* runtime.noteInfo(payload);
            const model = hermesQualifiedModel(text(payload.model), text(payload.provider));
            if (model) appliedModel = model;
            // Compression can rotate the durable key; keep resume pointed at the live transcript.
            const stored = text(payload.stored_session_id);
            if (stored && stored !== state.providerThread.nativeThreadRef?.nativeId) {
              yield* updateProviderThread(state, { nativeThreadRef: providerRef(stored) });
            }
            const usage = record(payload.usage);
            const max = nonNegativeInteger(usage.context_max);
            if (max !== undefined && max > 0) contextWindow = max;
            return;
          }
          case "request.cancel": {
            const id = text(payload.id) ?? "";
            const pending = pendingRequests.get(id);
            if (pending) yield* settleRequest(pending, "cancelled", yield* DateTime.now);
            for (const background of backgrounds) {
              const index = background.items.findIndex(
                (item) => item.kind === "request" && item.request.id === id,
              );
              if (index !== -1) background.items.splice(index, 1);
            }
            return;
          }
          case "status.update": {
            const notice = text(payload.text)?.trim();
            if (notice && BACKGROUND_NOTICE_KINDS.has(text(payload.kind) ?? "")) {
              backgroundNotice = notice.slice(0, BACKGROUND_NOTICE_MAX_CHARS);
            }
            return;
          }
          default:
            break;
        }

        // Frames of a self-started turn belong to it until its `message.complete`,
        // even when a T3 run is already waiting behind it.
        const background = runningBackground();
        if (background !== undefined) {
          if (!background.dropped) {
            bufferHermesBackgroundItem(background, { kind: "event", event });
          }
          if (event.type === "message.complete") yield* completeBackground(background);
          return;
        }

        const turn = state.activeTurn;
        if (turn === null) {
          if (event.type === "error") {
            yield* updateProviderSession(
              sessionEntity.status,
              text(payload.message) ?? "Hermes reported an error.",
            );
            return;
          }
          // Hermes started a turn on its own (a background completion). Muted
          // diagnostic turns send no `message.start` and stay Hermes-only.
          if (event.type === "message.start") {
            const started = yield* startBackground(state);
            bufferHermesBackgroundItem(started, { kind: "event", event });
          }
          return;
        }
        yield* applyTurnEvent(state, turn, event);
      });

      const applyTurnEvent = Effect.fnUntraced(function* (
        state: ThreadState,
        turn: ActiveTurn,
        event: HermesGatewayEvent,
      ) {
        const payload = record(event.payload);
        switch (event.type) {
          case "error":
            turn.lastError = text(payload.message) ?? "Hermes reported an error.";
            return;
          case "message.start":
            turn.commandOnly = false;
            turn.hermesStarted = true;
            return;
          case "message.delta":
            if (typeof payload.text === "string") yield* appendAssistant(turn, payload.text);
            return;
          case "message.interim": {
            const interim = typeof payload.text === "string" ? payload.text.trimStart() : "";
            if (!interim) return;
            yield* sealReasoning(turn);
            yield* sealAssistant(turn, interim);
            turn.interimTexts.push(interim);
            return;
          }
          case "thinking.delta":
          case "reasoning.delta":
          case "reasoning.available": {
            const delta = typeof payload.text === "string" ? payload.text : "";
            if (!delta) return;
            if (event.type === "reasoning.available" && (turn.reasoning?.text.length ?? 0) > 0)
              return;
            const item = turn.reasoning ?? (yield* newStreamItem(turn, "reasoning"));
            turn.reasoning = item;
            item.text += delta;
            if (event.type === "reasoning.available") yield* sealReasoning(turn);
            else yield* scheduleFlush(turn, item);
            return;
          }
          case "tool.start":
            yield* sealReasoning(turn);
            yield* emitTool(turn, payload, "start");
            return;
          case "tool.complete":
            yield* emitTool(turn, payload, "complete");
            return;
          case "subagent.spawn_requested":
          case "subagent.start":
          case "subagent.thinking":
          case "subagent.tool":
          case "subagent.progress":
          case "subagent.complete":
            yield* emitSubagent(turn, event.type, payload);
            return;
          case "session.usage":
            yield* reportUsage(turn, payload.usage);
            return;
          case "message.complete": {
            const status = text(payload.status) ?? "complete";
            const finalText = typeof payload.text === "string" ? payload.text : "";
            yield* sealReasoning(turn);
            if (status !== "error") {
              yield* sealAssistant(
                turn,
                payload.response_previewed === true
                  ? hermesFinalTail(finalText, turn.interimTexts)
                  : finalText,
              );
            }
            yield* reportUsage(turn, payload.usage);
            if (status === "interrupted") turn.interrupted = true;
            if (status === "error" && turn.failure === null) {
              turn.failure = makeProviderFailure({
                message:
                  text(payload.error) ??
                  turn.lastError ??
                  text(payload.warning) ??
                  "Hermes turn failed.",
                class: "provider_error",
                retryable: payload.recoverable === true ? true : null,
              });
            }
            yield* finalizeTurn(state);
            return;
          }
          default:
            return;
        }
      });

      const publishCommandOutput = Effect.fnUntraced(function* (turn: ActiveTurn, output: string) {
        yield* sealAssistant(turn);
        yield* sealAssistant(turn, output.trim() || "(no output)");
      });

      const handleInbox = Effect.fnUntraced(function* (item: InboxItem) {
        switch (item.kind) {
          case "event":
            return yield* handleEvent(item.event);
          case "request":
            return yield* handleServerRequest(item.request);
          case "prompt_started": {
            const turn = activeTurnFor(item.providerTurnId);
            if (turn !== null) turn.commandOnly = false;
            return;
          }
          case "command_output": {
            const turn = activeTurnFor(item.providerTurnId);
            if (turn === null || threadState === null) return;
            yield* publishCommandOutput(turn, item.output);
            if (item.complete) yield* finalizeTurn(threadState);
            return;
          }
          case "turn_failed": {
            const turn = activeTurnFor(item.providerTurnId);
            if (turn === null || threadState === null) return;
            if (!turn.interrupted) {
              turn.failure = makeProviderFailure({
                message: item.message,
                class: "provider_error",
              });
            }
            yield* finalizeTurn(threadState);
            return;
          }
          case "interrupt_settled": {
            // `session.interrupt` also clears Hermes's queued prompts, so a turn
            // still queued behind a background turn will never start.
            const turn = activeTurnFor(item.providerTurnId);
            if (turn === null || threadState === null || turn.hermesStarted) return;
            yield* finalizeTurn(threadState);
            return;
          }
          case "closed":
            return;
        }
      });

      yield* Effect.gen(function* () {
        while (true) {
          const item = yield* Queue.take(inbox);
          if (item.kind === "closed") break;
          yield* permit.withPermits(1)(handleInbox(item));
        }
        yield* permit.withPermits(1)(
          Effect.gen(function* () {
            yield* dropAllBackgrounds;
            const state = threadState;
            const turn = state?.activeTurn ?? null;
            if (state !== null && turn !== null) {
              if (!stopRequested && !turn.interrupted) {
                turn.failure = makeProviderFailure({
                  message: "The Hermes gateway connection closed.",
                  class: "transport_error",
                  retryable: true,
                });
              }
              yield* finalizeTurn(state);
            }
            if (stopRequested) {
              yield* updateProviderSession("stopped", null);
              yield* Queue.end(events);
              return;
            }
            yield* updateProviderSession("error", "The Hermes gateway connection closed.");
            yield* Queue.fail(
              events,
              new ProviderAdapterEventStreamError({
                driver: HERMES_PROVIDER,
                providerSessionId: input.providerSessionId,
                cause: "The Hermes gateway connection closed.",
              }),
            );
          }),
        );
      }).pipe(Effect.forkIn(scope));

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          stopRequested = true;
          const state = threadState;
          if (state !== null) {
            yield* rpc(
              "session.close",
              { session_id: state.liveSessionId },
              HERMES_CLOSE_TIMEOUT_MS,
            ).pipe(Effect.ignore);
          }
          yield* Effect.sync(() => connection.close());
          yield* state?.activeTurn?.release ?? Effect.void;
          yield* dropAllBackgrounds;
          yield* Queue.end(events);
        }),
      );

      // ── session runtime ───────────────────────────────────

      const registerThread = Effect.fnUntraced(function* (
        threadInput: ProviderAdapterV2EnsureThreadInput,
        publish = true,
      ) {
        if (threadState?.activeTurn != null) {
          return yield* protocolError("Cannot switch Hermes sessions while a turn is active");
        }
        const existing = threadInput.existingProviderThread;
        const resumeId = existing?.nativeThreadRef?.nativeId ?? undefined;
        if (threadState !== null && resumeId !== undefined) {
          if (threadState.providerThread.nativeThreadRef?.nativeId === resumeId) {
            threadState.providerThread = {
              ...existing!,
              providerSessionId: input.providerSessionId,
              nativeThreadRef: threadState.providerThread.nativeThreadRef,
              status: "idle",
            };
            return threadState.providerThread;
          }
        }
        if (threadState !== null) {
          const previous = threadState;
          threadState = null;
          yield* dropAllBackgrounds;
          yield* rpc("session.close", { session_id: previous.liveSessionId }).pipe(Effect.ignore);
        }

        const requested = parseHermesModelSelection(threadInput.modelSelection.model);
        const result = record(
          resumeId !== undefined
            ? yield* rpc("session.resume", {
                session_id: resumeId,
                source: "t3-code",
                close_on_disconnect: true,
              })
            : yield* rpc("session.create", {
                cwd: threadInput.runtimePolicy.cwd ?? cwd,
                source: "t3-code",
                close_on_disconnect: true,
                ...(requested
                  ? {
                      model: requested.model,
                      ...(requested.provider ? { provider: requested.provider } : {}),
                    }
                  : {}),
              }),
        );
        const liveSessionId = text(result.session_id);
        const info = record(result.info);
        const contract = finiteNumber(info.desktop_contract);
        const durableId =
          text(result.stored_session_id) ??
          text(result.session_key) ??
          text(result.resumed) ??
          resumeId;
        if (!liveSessionId || !durableId) {
          if (liveSessionId) {
            yield* rpc("session.close", { session_id: liveSessionId }).pipe(Effect.ignore);
          }
          return yield* protocolError("Hermes did not return a durable session id", result);
        }
        if (contract !== undefined && contract < HERMES_MIN_GATEWAY_CONTRACT) {
          yield* rpc("session.close", { session_id: liveSessionId }).pipe(Effect.ignore);
          return yield* protocolError(
            `Hermes gateway contract ${contract} is older than the required ${HERMES_MIN_GATEWAY_CONTRACT}. Update Hermes.`,
          );
        }
        yield* runtime.noteInfo(info);
        const gatewayModel = hermesQualifiedModel(text(info.model), text(info.provider));
        baselineModel = resumeId === undefined && requested ? null : (gatewayModel ?? null);
        appliedModel = resumeId === undefined && requested ? requested.id : (gatewayModel ?? null);
        const createdAt = yield* DateTime.now;
        const providerThread: OrchestrationV2ProviderThread =
          existing !== undefined
            ? {
                ...existing,
                providerSessionId: input.providerSessionId,
                nativeThreadRef: providerRef(durableId),
                status: "idle",
                updatedAt: createdAt,
              }
            : {
                id: idAllocator.derive.providerThread({
                  driver: HERMES_PROVIDER,
                  nativeThreadId: durableId,
                }),
                driver: HERMES_PROVIDER,
                providerInstanceId: options.instanceId,
                providerSessionId: input.providerSessionId,
                appThreadId: threadInput.threadId,
                ownerNodeId: null,
                nativeThreadRef: providerRef(durableId),
                nativeConversationHeadRef: null,
                status: "idle",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                pendingBackgroundTasks: [],
                createdAt,
                updatedAt: createdAt,
              };
        threadState = { providerThread, liveSessionId, activeTurn: null };
        if (publish) {
          yield* emit({ type: "provider_thread.updated", driver: HERMES_PROVIDER, providerThread });
        }
        // A reconnect re-delivers questions Hermes is still waiting on.
        if (Array.isArray(result.open_requests)) {
          for (const entry of result.open_requests) {
            const open = record(entry);
            const id = text(open.id);
            const method = text(open.method);
            if (id && method) {
              Queue.offerUnsafe(inbox, {
                kind: "request",
                request: { id, method, params: record(open.params) },
              });
            }
          }
        }
        return providerThread;
      });

      const applySelection = Effect.fnUntraced(function* (
        state: ThreadState,
        selection: ModelSelection,
      ) {
        if (selection.instanceId !== options.instanceId) return;
        const requested = parseHermesModelSelection(selection.model);
        const target = requested?.id ?? (appliedModel !== null ? baselineModel : null);
        if (target === null || target === appliedModel) return;
        const parsed = parseHermesModelSelection(target);
        if (parsed === undefined) return;
        // The user chose this model in T3, which is the confirmation Hermes asks for.
        yield* rpc("config.set", {
          session_id: state.liveSessionId,
          key: "model",
          value: hermesModelSwitchValue(parsed),
          confirm_expensive_model: true,
        });
        appliedModel = parsed.id;
        sessionEntity = {
          ...sessionEntity,
          model: selection.model,
          updatedAt: yield* DateTime.now,
        };
        yield* emit({
          type: "provider_session.updated",
          driver: HERMES_PROVIDER,
          providerSession: sessionEntity,
        });
      });

      /** Stage attachments; files return `@file:` references for the prompt text. */
      const stageAttachments = Effect.fnUntraced(function* (
        state: ThreadState,
        attachments: ProviderAdapterV2TurnInput["message"]["attachments"],
      ) {
        const references: Array<string> = [];
        for (const attachment of attachments) {
          const path = resolveAttachmentPath({
            attachmentsDir: options.serverConfig.attachmentsDir,
            attachment,
          });
          if (path === null) {
            return yield* protocolError(`Attachment is not available: ${attachment.name}`);
          }
          if (attachment.mimeType.startsWith("image/")) {
            yield* rpc("image.attach", { session_id: state.liveSessionId, path });
          } else {
            const attached = record(
              yield* rpc("file.attach", { session_id: state.liveSessionId, path }),
            );
            const reference = text(attached.ref_text);
            if (reference) references.push(reference);
          }
        }
        return references;
      });

      /**
       * Runs outside the permit; results re-enter through the inbox. `queued`
       * asks Hermes to run the prompt after its own background turn instead of
       * redirecting that turn, which is Hermes's default for a busy session.
       */
      const superviseSubmit = (
        state: ThreadState,
        turn: ActiveTurn,
        slash: SlashCommand | undefined,
        prompt: string,
        queued = false,
      ) => {
        const providerTurnId = turn.providerTurn.id;
        const offer = (item: InboxItem) => Effect.sync(() => Queue.offerUnsafe(inbox, item));
        const submit = (textToSend: string) =>
          offer({ kind: "prompt_started", providerTurnId }).pipe(
            Effect.andThen(
              rpc("prompt.submit", {
                session_id: state.liveSessionId,
                text: textToSend,
                ...(queued ? { queued: true } : {}),
              }),
            ),
            Effect.asVoid,
          );
        const runSlash = Effect.fnUntraced(function* (initial: SlashCommand) {
          let command = initial;
          const seen = new Set([command.name.toLowerCase()]);
          while (true) {
            const outcome = parseHermesCommandOutcome(
              yield* rpc("slash.exec", {
                session_id: state.liveSessionId,
                command: command.command,
              }).pipe(
                Effect.catch(() =>
                  rpc("command.dispatch", {
                    session_id: state.liveSessionId,
                    name: command.name,
                    arg: command.arg,
                  }),
                ),
              ),
            );
            switch (outcome.type) {
              case "output":
                return yield* offer({
                  kind: "command_output",
                  providerTurnId,
                  output: outcome.output,
                  complete: true,
                });
              case "alias": {
                const target = `${outcome.target.replace(/^\/+/u, "")}${command.arg ? ` ${command.arg}` : ""}`;
                const next = parseHermesSlashCommand(`/${target}`);
                if (next === undefined || seen.has(next.name.toLowerCase())) {
                  return yield* new HermesGatewayError({
                    detail: `Hermes returned a recursive or invalid alias for /${command.name}.`,
                  });
                }
                seen.add(next.name.toLowerCase());
                command = next;
                continue;
              }
              case "prefill":
                return yield* offer({
                  kind: "command_output",
                  providerTurnId,
                  output: outcome.message
                    ? `${outcome.notice ? `${outcome.notice}\n\n` : ""}${outcome.message}`
                    : (outcome.notice ?? `/${command.name} completed.`),
                  complete: true,
                });
              case "prompt":
                if (outcome.notice) {
                  yield* offer({
                    kind: "command_output",
                    providerTurnId,
                    output: outcome.notice,
                    complete: false,
                  });
                }
                return yield* submit(outcome.message);
            }
          }
        });
        return (slash === undefined ? submit(prompt) : runSlash(slash)).pipe(
          Effect.catch((error) =>
            offer({ kind: "turn_failed", providerTurnId, message: error.message }),
          ),
          Effect.forkIn(scope),
          Effect.asVoid,
        );
      };

      const beginTurn = Effect.fnUntraced(function* (
        turnInput: ProviderAdapterV2TurnInput,
        overrideText?: string,
      ) {
        const state = threadState;
        if (state === null) return yield* protocolError("Hermes session has no registered thread");
        if (state.activeTurn !== null) {
          return yield* protocolError("Hermes provider thread already has an active turn");
        }
        if (
          state.providerThread.nativeThreadRef?.nativeId !==
          turnInput.providerThread.nativeThreadRef?.nativeId
        ) {
          return yield* protocolError("Hermes turn requested for a different native session");
        }
        state.providerThread = {
          ...turnInput.providerThread,
          nativeThreadRef: state.providerThread.nativeThreadRef,
        };
        // A continuation run attaches to a turn Hermes already ran; its message
        // text is a placeholder that never reaches Hermes.
        const continuation = overrideText === undefined && isProviderContinuationTurn(turnInput);
        if (!continuation) yield* applySelection(state, turnInput.modelSelection);

        const messageText = overrideText ?? turnInput.message.text;
        const slash =
          !continuation && turnInput.message.attachments.length === 0
            ? parseHermesSlashCommand(messageText)
            : undefined;
        const references =
          continuation || slash !== undefined
            ? []
            : yield* stageAttachments(state, turnInput.message.attachments);
        const prompt = [
          messageText.trim() ||
            (references.length === 0 ? "Please inspect the attached image." : ""),
          ...references,
        ]
          .filter(Boolean)
          .join("\n\n");

        const startedAt = yield* DateTime.now;
        const nativeTurnId = `${state.providerThread.id}:attempt:${turnInput.attemptId}`;
        const providerTurn: OrchestrationV2ProviderTurn = {
          id: idAllocator.derive.providerTurn({ driver: HERMES_PROVIDER, nativeTurnId }),
          providerThreadId: turnInput.providerThread.id,
          nodeId: turnInput.rootNodeId,
          runAttemptId: turnInput.attemptId,
          nativeTurnRef: providerRef(nativeTurnId, "weak"),
          ordinal: turnInput.providerTurnOrdinal,
          status: "running",
          startedAt,
          completedAt: null,
        };
        const turn: ActiveTurn = {
          turnInput,
          providerTurn,
          itemOrdinals: new Map(),
          nextItemOrdinal: turnInput.providerTurnOrdinal * 100 + 1,
          assistant: null,
          assistantSegment: 0,
          interimTexts: [],
          reasoning: null,
          reasoningSegment: 0,
          toolStarts: new Map(),
          subagentStarts: new Map(),
          interrupted: false,
          failure: null,
          lastError: null,
          lastUsage: undefined,
          commandOnly: slash !== undefined,
          hermesStarted: continuation,
          queuedBehindBackground: false,
          deferredStart: null,
          preferFinalText: false,
          release: yield* runtime.trackTurn,
        };
        yield* permit.withPermits(1)(
          Effect.gen(function* () {
            state.activeTurn = turn;
            yield* emit({
              type: "provider_turn.updated",
              driver: HERMES_PROVIDER,
              threadId: turnInput.threadId,
              providerTurn,
            });
            yield* updateProviderThread(state, {
              status: "active",
              firstRunOrdinal: state.providerThread.firstRunOrdinal ?? turnInput.runOrdinal,
              lastRunOrdinal: turnInput.runOrdinal,
            });
            yield* updateProviderSession("running", null);
            if (continuation) return yield* attachBackground(state, turn);
            // Hermes runs one turn at a time. Behind its own background turn a
            // prompt is queued in Hermes, and a slash command waits here.
            turn.queuedBehindBackground = runningBackground() !== undefined;
            if (turn.queuedBehindBackground && slash !== undefined) {
              turn.deferredStart = superviseSubmit(state, turn, slash, prompt);
              return;
            }
            yield* superviseSubmit(state, turn, slash, prompt, turn.queuedBehindBackground);
          }),
        );
      });

      /**
       * Binds a continuation run to the oldest buffered background turn:
       * replays its frames, then keeps streaming live frames if Hermes is still
       * running it. A run with nothing to attach (the buffer went with a
       * restarted session) settles at once instead of waiting on nothing.
       */
      const attachBackground = Effect.fnUntraced(function* (state: ThreadState, turn: ActiveTurn) {
        const background = backgrounds.find((candidate) => !candidate.dropped);
        if (background === undefined) return yield* finalizeTurn(state);
        backgrounds.splice(backgrounds.indexOf(background), 1);
        // The run's own turn tracking takes over.
        yield* background.release;
        turn.preferFinalText = background.deltasDropped;
        for (const item of background.items) {
          if (state.activeTurn !== turn) return;
          if (item.kind === "event") yield* applyTurnEvent(state, turn, item.event);
          else yield* handleServerRequest(item.request);
        }
        if (!background.running && state.activeTurn === turn) yield* finalizeTurn(state);
      });

      const runtimeSession: ProviderAdapterV2SessionRuntime = {
        instanceId: options.instanceId,
        driver: HERMES_PROVIDER,
        providerSessionId: input.providerSessionId,
        get providerSession() {
          return sessionEntity;
        },
        events: Stream.fromQueue(events),
        getModelContextWindow: (selection) =>
          selection.instanceId === options.instanceId && contextWindow !== null
            ? contextWindow
            : undefined,
        ensureThread: (threadInput) =>
          registerThread(threadInput).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterEnsureThreadError({
                  driver: HERMES_PROVIDER,
                  threadId: threadInput.threadId,
                  cause,
                }),
            ),
          ),
        resumeThread: (threadInput) =>
          registerThread({
            threadId:
              threadInput.threadId ?? threadInput.providerThread.appThreadId ?? input.threadId,
            modelSelection: threadInput.modelSelection ?? input.modelSelection,
            runtimePolicy: threadInput.runtimePolicy ?? input.runtimePolicy,
            existingProviderThread: threadInput.providerThread,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterResumeThreadError({
                  driver: HERMES_PROVIDER,
                  providerSessionId: input.providerSessionId,
                  providerThreadId: threadInput.providerThread.id,
                  cause,
                }),
            ),
          ),
        // A bare `/compact` from the composer runs Hermes's own `/compress`.
        compactThread: (turnInput) =>
          beginTurn(turnInput, "/compress").pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterTurnStartError({
                  driver: HERMES_PROVIDER,
                  threadId: turnInput.threadId,
                  providerThreadId: turnInput.providerThread.id,
                  runId: turnInput.runId,
                  cause,
                }),
            ),
          ),
        startTurn: (turnInput) =>
          beginTurn(turnInput).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterTurnStartError({
                  driver: HERMES_PROVIDER,
                  threadId: turnInput.threadId,
                  providerThreadId: turnInput.providerThread.id,
                  runId: turnInput.runId,
                  cause,
                }),
            ),
          ),
        steerTurn: (steerInput) =>
          Effect.gen(function* () {
            const state = threadState;
            const turn = state?.activeTurn ?? null;
            if (
              state === null ||
              turn === null ||
              turn.providerTurn.id !== steerInput.providerTurnId
            ) {
              return yield* protocolError(`Hermes turn ${steerInput.providerTurnId} is not active`);
            }
            if (steerInput.message.attachments.length > 0) {
              return yield* protocolError("Only text can be steered into an active Hermes turn");
            }
            // `session.steer` would land in the background turn Hermes is running instead.
            if (turn.queuedBehindBackground && !turn.hermesStarted) {
              return yield* protocolError(
                "Hermes is finishing background work; send the message after this turn starts",
              );
            }
            const result = record(
              yield* rpc("session.steer", {
                session_id: state.liveSessionId,
                text: steerInput.message.text,
              }),
            );
            if (result.status === "rejected") {
              return yield* protocolError("Hermes rejected the steering message");
            }
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterSteerRunError({
                  driver: HERMES_PROVIDER,
                  providerThreadId: steerInput.providerThread.id,
                  providerTurnId: steerInput.providerTurnId,
                  cause,
                }),
            ),
          ),
        interruptTurn: (interruptInput) =>
          Effect.gen(function* () {
            const state = threadState;
            const turn = state?.activeTurn ?? null;
            if (
              state === null ||
              turn === null ||
              turn.providerTurn.id !== interruptInput.providerTurnId
            ) {
              return yield* protocolError(
                `Hermes turn ${interruptInput.providerTurnId} is not active`,
              );
            }
            turn.interrupted = true;
            // Held behind a background turn, the stop covers that turn too.
            const deferredStart = turn.deferredStart;
            turn.deferredStart = null;
            yield* rpc("session.interrupt", { session_id: state.liveSessionId }).pipe(
              Effect.tapError(() =>
                Effect.sync(() => {
                  turn.interrupted = false;
                  turn.deferredStart = deferredStart;
                }),
              ),
            );
            // A slash command has no Hermes run to report `message.complete`.
            if (turn.commandOnly) yield* permit.withPermits(1)(finalizeTurn(state));
            // Settle through the inbox so any `message.start` Hermes sent before
            // its reply is seen first.
            else if (turn.queuedBehindBackground) {
              yield* Effect.sync(() =>
                Queue.offerUnsafe(inbox, {
                  kind: "interrupt_settled",
                  providerTurnId: turn.providerTurn.id,
                }),
              );
            }
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterInterruptError({
                  driver: HERMES_PROVIDER,
                  providerThreadId: interruptInput.providerThread.id,
                  providerTurnId: interruptInput.providerTurnId,
                  cause,
                }),
            ),
          ),
        respondToRuntimeRequest: (requestInput) =>
          Effect.gen(function* () {
            const pending = Array.from(pendingRequests.values()).find(
              (candidate) => candidate.runtimeRequest.id === requestInput.requestId,
            );
            if (pending === undefined) {
              return yield* protocolError(`No pending Hermes request ${requestInput.requestId}`);
            }
            yield* answerRequest(pending, requestInput.decision, requestInput.answers);
            const resolvedAt = yield* DateTime.now;
            yield* permit.withPermits(1)(
              settleRequest(pending, "resolved", resolvedAt, {
                ...(requestInput.decision === undefined ? {} : { decision: requestInput.decision }),
                // Passwords and secrets are never stored in T3 events.
                ...(pending.method === "clarify" && requestInput.answers !== undefined
                  ? { answers: requestInput.answers }
                  : {}),
              }),
            );
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRuntimeRequestResponseError({
                  driver: HERMES_PROVIDER,
                  requestId: requestInput.requestId,
                  cause,
                }),
            ),
          ),
        readThreadSnapshot: (snapshotInput) =>
          Effect.gen(function* () {
            const state = threadState;
            const wanted = snapshotInput.providerThread.nativeThreadRef?.nativeId;
            if (
              state === null ||
              wanted == null ||
              state.providerThread.nativeThreadRef?.nativeId !== wanted
            ) {
              return yield* protocolError(
                "Hermes snapshot requested for a thread this session does not host",
              );
            }
            const history = record(
              yield* rpc("session.history", { session_id: state.liveSessionId }),
            );
            const threadId = state.providerThread.appThreadId ?? input.threadId;
            const rows = Array.isArray(history.messages) ? history.messages : [];
            const messages = rows.flatMap((row, index) => {
              const message = record(row);
              const role = message.role;
              const body = text(message.text) ?? text(message.content);
              if ((role !== "user" && role !== "assistant") || body === undefined) return [];
              const at = Option.getOrElse(
                DateTime.make(Math.trunc((finiteNumber(message.timestamp) ?? Number.NaN) * 1000)),
                () => state.providerThread.createdAt,
              );
              return [
                {
                  id: idAllocator.derive.messageFromProviderItem({
                    driver: HERMES_PROVIDER,
                    nativeItemId: `${wanted}:snapshot-message:${index}`,
                  }),
                  threadId,
                  runId: null,
                  nodeId: null,
                  role: role as "user" | "assistant",
                  text: body,
                  attachments: [],
                  streaming: false,
                  createdBy: role === "user" ? ("user" as const) : ("agent" as const),
                  creationSource: "provider" as const,
                  createdAt: at,
                  updatedAt: at,
                },
              ];
            });
            return {
              providerThread: state.providerThread,
              providerTurns: [],
              messages,
              runtimeRequests: [],
            } satisfies ProviderAdapterV2ThreadSnapshot;
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterReadThreadSnapshotError({
                  driver: HERMES_PROVIDER,
                  providerThreadId: snapshotInput.providerThread.id,
                  cause,
                }),
            ),
          ),
        rollbackThread: (rollbackInput) =>
          Effect.gen(function* () {
            const state = threadState;
            if (state === null || state.providerThread.id !== rollbackInput.providerThread.id) {
              return yield* protocolError(
                "Hermes rollback requested for a thread this session does not host",
              );
            }
            if (state.activeTurn !== null || runningBackground() !== undefined) {
              return yield* protocolError("Interrupt the active Hermes turn before rolling back");
            }
            const boundary =
              rollbackInput.target.type === "thread_start"
                ? 0
                : rollbackInput.target.providerTurn.ordinal;
            const discarded = rollbackInput.providerThreadTurns.filter(
              (turn) =>
                turn.providerThreadId === state.providerThread.id && turn.ordinal > boundary,
            ).length;
            // `session.undo` removes the last user turn and everything after it.
            for (let index = 0; index < discarded; index += 1) {
              yield* rpc("session.undo", { session_id: state.liveSessionId });
            }
            return {
              providerThread: state.providerThread,
              providerTurns: [],
              messages: [],
              runtimeRequests: [],
            } satisfies ProviderAdapterV2ThreadSnapshot;
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRollbackThreadError({
                  driver: HERMES_PROVIDER,
                  providerThreadId: rollbackInput.providerThread.id,
                  checkpointId: rollbackInput.target.checkpointId,
                  cause,
                }),
            ),
          ),
        forkThread: (forkInput) =>
          Effect.fail(
            new ProviderAdapterForkThreadError({
              driver: HERMES_PROVIDER,
              providerThreadId: forkInput.sourceProviderThread.id,
              cause: "Hermes forks use T3's portable handoff.",
            }),
          ),
      };
      return runtimeSession;
    }),
  });
}

// ── driver ────────────────────────────────────────────────────

export type HermesAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | IdAllocatorV2
  | ServerConfig;

/**
 * Standalone adapter driver. The provider driver (`HermesDriver`) builds the
 * adapter itself so the adapter, model discovery, and text generation share
 * the instance's single gateway process.
 */
export const HermesAdapterV2Driver: ProviderAdapterDriver<
  HermesSettings,
  HermesAdapterV2DriverEnv
> = {
  driverKind: HERMES_PROVIDER,
  configSchema: HermesSettings,
  defaultConfig: (): HermesSettings => DEFAULT_HERMES_SETTINGS,
  create: Effect.fn("HermesAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<HermesSettings>) {
      const hostEnvironment = yield* HostProcessEnvironment;
      const environment = mergeProviderInstanceEnvironment(input.environment, hostEnvironment);
      const runtime = yield* makeHermesGatewayRuntime({
        binaryPath: input.config.binaryPath,
        profile: input.config.profile,
        environment,
      });
      return makeHermesAdapterV2({
        instanceId: input.instanceId,
        runtime,
        homeDirectory: environment.HOME ?? environment.USERPROFILE,
        idAllocator: yield* IdAllocatorV2,
        serverConfig: yield* ServerConfig,
        continuationRequests: yield* ProviderContinuationRequests,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: HERMES_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create Hermes adapter.",
              cause,
            }),
        ),
      ),
  ),
};
