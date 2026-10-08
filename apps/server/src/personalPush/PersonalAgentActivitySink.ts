import type { ClientActivityLease, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
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
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
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
const TOMBSTONE_CONFIRMATION_MS = 5_000;
const COMPLETION_HOLD_MS = 10_000;

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
 * How long a state must keep holding before it is published; 0 publishes at
 * once. A tombstone replacing live state can be transient while projections
 * settle. "Done" is held longer because an agent that wakes itself, or takes
 * a queued message, is working again within seconds and the alert would be
 * untrue by the time it arrived. Approvals, input requests, and failures are
 * never held.
 */
export function confirmationDelayMs(
  state: RelayAgentActivityState | null,
  previousIdentity: string | undefined,
): number {
  if (state === null) {
    return previousIdentity === publishIdentity(null) ? 0 : TOMBSTONE_CONFIRMATION_MS;
  }
  return state.phase === "completed" ? COMPLETION_HOLD_MS : 0;
}

const TOMBSTONE_HOLD_KEY = "tombstone";

/**
 * Names what a held publish is waiting on. A completion is named by its run,
 * not just its phase: this worker handles one thread at a time, so a thread
 * can resume and finish a second run before its first hold is looked at
 * again, and the second "Done" must wait its own ten seconds. A rename keeps
 * the same key and so keeps its deadline.
 */
function holdKey(
  phase: RelayAgentActivityState["phase"],
  thread: Pick<OrchestrationV2ThreadShell, "latestRunId" | "latestRunCompletedAt">,
): string {
  const completedAt =
    thread.latestRunCompletedAt == null ? "" : DateTime.toEpochMillis(thread.latestRunCompletedAt);
  return `${phase}:${thread.latestRunId ?? ""}:${completedAt}`;
}

/**
 * When a desktop or web client last reported the user interacting, from the
 * leases the background policy currently holds. Clients report a boolean
 * covering their last 45 seconds, so the result trails the real interaction
 * by up to about a minute.
 */
export function latestDesktopInteractionMs(
  leases: ReadonlyArray<
    Pick<ClientActivityLease, "clientKind" | "recentlyInteracted" | "updatedAt">
  >,
): number | null {
  let latest: number | null = null;
  for (const lease of leases) {
    if (lease.clientKind !== "web" && lease.clientKind !== "desktop-renderer") continue;
    if (!lease.recentlyInteracted) continue;
    const updatedAtMs = DateTime.toEpochMillis(lease.updatedAt);
    if (latest === null || updatedAtMs > latest) latest = updatedAtMs;
  }
  return latest;
}

/**
 * Whether a publication should update the Live Activity without alerting the
 * phone: the user was at the desktop within the configured window and the
 * thread only finished or failed. Requests that block the agent always alert.
 */
function isQuietedByDesktopActivity(input: {
  readonly phase: RelayAgentActivityState["phase"] | undefined;
  readonly quietMinutes: number;
  readonly lastDesktopInteractionMs: number | null;
  readonly nowMs: number;
}): boolean {
  if (input.phase !== "completed" && input.phase !== "failed") return false;
  if (input.quietMinutes <= 0 || input.lastDesktopInteractionMs === null) return false;
  return input.nowMs - input.lastDesktopInteractionMs <= input.quietMinutes * 60_000;
}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const scope = yield* Effect.scope;

  const published = new Map<ThreadId, string>();
  // What a pending publish is waiting on (see `holdKey`) and when it may go
  // out. A different key restarts the wait; the same one keeps its deadline.
  const confirmDeadlines = new Map<
    ThreadId,
    { readonly key: string; readonly deadlineMs: number }
  >();
  // Leases only say whether a client is interacting now, so the last time one
  // did is remembered here for the quiet window. This is best effort: the
  // policy keeps only its newest snapshot for a slow reader, so a report is
  // missed if its client disconnects in the same instant. Clients report
  // every 25 seconds while in use, so that usually costs one interval of the
  // window; a first report after a long idle can lose the window entirely.
  // Either way the result is an extra "Done", never a silenced approval,
  // which does not justify a hook in upstream's report path.
  let lastDesktopInteractionMs: number | null = null;
  yield* Stream.runForEach(backgroundPolicy.streamChanges, (snapshot) =>
    Effect.sync(() => {
      const latest = latestDesktopInteractionMs(snapshot.leases);
      if (
        latest !== null &&
        (lastDesktopInteractionMs === null || lastDesktopInteractionMs < latest)
      ) {
        lastDesktopInteractionMs = latest;
      }
    }),
  ).pipe(Effect.forkIn(scope));
  let publishedRelayUrl: string | null = null;
  const queued = new Set<ThreadId>();

  const readState = Effect.fnUntraced(function* (threadId: ThreadId) {
    const environmentId = yield* serverEnvironment.getEnvironmentId;
    const shell = yield* threads.getThreadShell(threadId);
    if (shell === null || shell.archivedAt !== null) {
      return { environmentId, state: null, holdKey: TOMBSTONE_HOLD_KEY };
    }
    const project = yield* projects.getById(shell.projectId);
    if (Option.isNone(project)) return { environmentId, state: null, holdKey: TOMBSTONE_HOLD_KEY };
    const state = projectThreadAwarenessV2({
      environmentId,
      project: project.value,
      thread: shell,
    });
    return {
      environmentId,
      state: sanitizeState(state),
      holdKey: state === null ? TOMBSTONE_HOLD_KEY : holdKey(state.phase, shell),
    };
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

    const { environmentId, state, holdKey: key } = yield* readState(threadId);
    const identity = publishIdentity(state);
    const previous = published.get(threadId);
    if (previous === identity) {
      confirmDeadlines.delete(threadId);
      return;
    }
    const nowMs = (yield* DateTime.now).epochMilliseconds;
    const delayMs = confirmationDelayMs(state, previous);
    if (delayMs > 0) {
      const pending = confirmDeadlines.get(threadId);
      if (pending === undefined || pending.key !== key) {
        confirmDeadlines.set(threadId, { key, deadlineMs: nowMs + delayMs });
        yield* Effect.sleep(delayMs).pipe(
          Effect.andThen(Effect.suspend(() => enqueue(threadId))),
          Effect.forkIn(scope),
        );
        return;
      }
      if (nowMs < pending.deadlineMs) return;
    }
    confirmDeadlines.delete(threadId);

    const quietMinutes = yield* settings.getSettings.pipe(
      Effect.map((current) => current.personalPushRelay.quietAfterDesktopActivityMinutes),
      Effect.orElseSucceed(() => 0),
    );
    const silent = isQuietedByDesktopActivity({
      phase: state?.phase,
      quietMinutes,
      lastDesktopInteractionMs,
      nowMs,
    });
    yield* client
      .publish({ environmentId, threadId, state, ...(silent ? { silent } : {}) })
      .pipe(Effect.retry({ times: 4, schedule: Schedule.exponential("1 second") }));
    published.set(threadId, identity);
    yield* Effect.logDebug("personal agent activity published", {
      threadId,
      statePhase: state?.phase ?? null,
      silent,
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
