import type { ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PersonalPushRelay from "./PersonalPushRelayClient.ts";

// Tangent(FORK-PUSH-001): the personal relay is a second agent-activity sink,
// independent of the managed T3 Connect relay. AgentAwarenessRelay hands every
// activity-relevant thread to `publishThread`; this sink projects, dedupes, and
// publishes on its own queue so a slow relay never delays the managed one.

const DETAIL_MAX_LENGTH = 160;
const REDACTED_FAILURE_DETAIL = "The agent run failed.";
const CONFIRMATION_DELAY = "5 seconds";

export class PersonalAgentActivitySink extends Context.Service<
  PersonalAgentActivitySink,
  {
    readonly publishThread: (threadId: ThreadId) => Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/personalPush/PersonalAgentActivitySink") {}

/** Queues a personal publish when the sink is in context. Never fails or waits on the relay. */
export const publishThread = (threadId: ThreadId): Effect.Effect<void> =>
  Effect.serviceOption(PersonalAgentActivitySink).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (sink) => sink.publishThread(threadId),
      }),
    ),
  );

export function sanitizeState(
  state: RelayAgentActivityState | null,
): RelayAgentActivityState | null {
  if (state === null) return null;
  const { detail: _detail, ...rest } = state;
  const detail = (state.phase === "failed" ? REDACTED_FAILURE_DETAIL : state.detail)
    ?.trim()
    .slice(0, DETAIL_MAX_LENGTH)
    .trim();
  return detail ? { ...rest, detail } : rest;
}

export function publishIdentity(state: RelayAgentActivityState | null): string {
  if (state === null) return "null";
  const { updatedAt: _updatedAt, ...meaningful } = state;
  return JSON.stringify(meaningful);
}

/**
 * Tombstones replacing live state and a first-ever "completed" can both be
 * transient while projections settle, so they are published only if they
 * still hold after a short delay.
 */
export function requiresConfirmation(
  state: RelayAgentActivityState | null,
  previousIdentity: string | undefined,
): boolean {
  if (state === null) return previousIdentity !== publishIdentity(null);
  return state.phase === "completed" && previousIdentity === undefined;
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const scope = yield* Effect.scope;

  const published = new Map<ThreadId, string>();
  const confirmDeadlines = new Map<ThreadId, number>();
  let publishedRelayUrl: string | null = null;
  const queued = new Set<ThreadId>();

  const readState = Effect.fnUntraced(function* (threadId: ThreadId) {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null || shell.archivedAt !== null) return { environmentId, state: null };
    const project = yield* projects.getById(shell.projectId);
    if (Option.isNone(project)) return { environmentId, state: null };
    const state = projectThreadAwarenessV2({
      environmentId,
      project: project.value,
      thread: shell,
    });
    return { environmentId, state: sanitizeState(state) };
  });

  let enqueue: (threadId: ThreadId) => Effect.Effect<void> = () => Effect.void;

  const process = Effect.fnUntraced(function* (threadId: ThreadId) {
    const client = yield* PersonalPushRelay.makeFromRuntime(config, settings);
    if (!client.configured) {
      published.clear();
      confirmDeadlines.clear();
      publishedRelayUrl = null;
      return;
    }
    if (client.relayUrl !== publishedRelayUrl) {
      published.clear();
      confirmDeadlines.clear();
      publishedRelayUrl = client.relayUrl;
    }

    const { environmentId, state } = yield* readState(threadId);
    const identity = publishIdentity(state);
    const previous = published.get(threadId);
    if (previous === identity) {
      confirmDeadlines.delete(threadId);
      return;
    }
    if (requiresConfirmation(state, previous)) {
      const nowMs = (yield* DateTime.now).epochMilliseconds;
      const deadline = confirmDeadlines.get(threadId);
      if (deadline === undefined) {
        confirmDeadlines.set(threadId, nowMs + 5_000);
        yield* Effect.sleep(CONFIRMATION_DELAY).pipe(
          Effect.andThen(Effect.suspend(() => enqueue(threadId))),
          Effect.forkIn(scope),
        );
        return;
      }
      if (nowMs < deadline) return;
    }
    confirmDeadlines.delete(threadId);

    yield* client
      .publish({ environmentId, threadId, state })
      .pipe(Effect.retry({ times: 4, schedule: Schedule.exponential("1 second") }));
    published.set(threadId, identity);
    yield* Effect.logDebug("personal agent activity published", {
      threadId,
      statePhase: state?.phase ?? null,
    });
  });

  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    Effect.sync(() => queued.delete(threadId)).pipe(
      Effect.andThen(process(threadId)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("personal agent activity publish failed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    ),
  );

  enqueue = (threadId) =>
    Effect.suspend(() => {
      if (queued.has(threadId)) return Effect.void;
      queued.add(threadId);
      return worker.enqueue(threadId);
    }).pipe(Effect.uninterruptible);

  return PersonalAgentActivitySink.of({ publishThread: enqueue, drain: worker.drain });
});

export const layer = Layer.effect(PersonalAgentActivitySink, make);
