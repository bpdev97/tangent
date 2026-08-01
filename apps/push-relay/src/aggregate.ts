import type {
  RelayAgentActivityAggregateRow,
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
} from "@t3tools/contracts/relay";

const MAX_ROWS = 5;
const RUNNING_TTL_MS = 2 * 60 * 60 * 1_000;
const WAITING_TTL_MS = 24 * 60 * 60 * 1_000;
const TERMINAL_TTL_MS = 15 * 60 * 1_000;

export function isTerminal(state: RelayAgentActivityState): boolean {
  return state.phase === "completed" || state.phase === "failed";
}

export function activityExpiresAtMs(state: RelayAgentActivityState): number {
  const updatedAt = Date.parse(state.updatedAt);
  if (!Number.isFinite(updatedAt)) return 0;
  if (isTerminal(state)) return updatedAt + TERMINAL_TTL_MS;
  const ttl =
    state.phase === "starting" || state.phase === "running" ? RUNNING_TTL_MS : WAITING_TTL_MS;
  return updatedAt + ttl;
}

function isFresh(state: RelayAgentActivityState, nowMs: number): boolean {
  return activityExpiresAtMs(state) >= nowMs;
}

function statusForPhase(phase: RelayAgentActivityState["phase"]): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval";
    case "waiting_for_input":
      return "Input";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "starting":
      return "Connecting";
    case "running":
      return "Working";
    case "stale":
      return "Waiting";
  }
}

function row(state: RelayAgentActivityState): RelayAgentActivityAggregateRow {
  return {
    environmentId: state.environmentId,
    threadId: state.threadId,
    projectTitle: state.projectTitle.slice(0, 120),
    threadTitle: state.threadTitle.slice(0, 120),
    modelTitle: state.modelTitle.slice(0, 120),
    phase: state.phase,
    status: statusForPhase(state.phase),
    updatedAt: state.updatedAt,
    deepLink:
      state.deepLink.startsWith("/") && !state.deepLink.startsWith("//")
        ? state.deepLink.slice(0, 512)
        : "/",
  };
}

export function makeAggregate(
  states: ReadonlyArray<RelayAgentActivityState>,
  nowMs = Date.now(),
): RelayAgentActivityAggregateState | null {
  const fresh = states.filter((state) => isFresh(state, nowMs));
  const active = fresh
    .filter((state) => !isTerminal(state))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const terminal = fresh.filter(isTerminal).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const displayed = [...active, ...terminal].slice(0, MAX_ROWS);
  const newest = displayed[0];
  if (!newest) return null;

  const onlyTerminal = active.length === 0;
  return {
    title: "Tangent",
    subtitle: onlyTerminal
      ? newest.phase === "failed"
        ? "Agent work failed"
        : "Agent work completed"
      : "Agent work in progress",
    activeCount: active.length,
    updatedAt: displayed.reduce(
      (latest, state) => (state.updatedAt.localeCompare(latest) > 0 ? state.updatedAt : latest),
      newest.updatedAt,
    ),
    activities: displayed.map(row),
  };
}
