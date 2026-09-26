// Tangent(FORK-STATUS-001): see docs/fork/quiet-connection-status.md.
import type { WorkspaceState } from "../../state/workspaceModel";

/** What the thread-list header shows beside the brand. */
export type QuietConnectionIndicator = "none" | "partial" | "disconnected";

/**
 * Undefined until threads have loaded once: upstream's title covers first launch, when the list
 * has nothing else to show. After that, an environment that is asleep or unreachable is a normal
 * state, so it earns a mark beside the brand rather than replacing it.
 */
export function quietConnectionIndicator(
  state: WorkspaceState,
): QuietConnectionIndicator | undefined {
  if (!state.hasLoadedShellSnapshot) return undefined;
  if (state.networkStatus === "offline" || !state.hasReadyEnvironment) return "disconnected";
  if (state.hasConnectingEnvironment || state.connectionError !== null) return "partial";
  return "none";
}
