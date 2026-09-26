// Tangent(FORK-STATUS-001): see docs/fork/quiet-connection-status.md.
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { useEffect, useState } from "react";

/** Phone reconnects usually finish within a second or two; only longer ones reach the pill. */
export const CONNECTION_PILL_GRACE_MS = 2000;

/**
 * The phase the thread pill reports. A connect or reconnect that has not outlasted the grace
 * period reads as connected, so the pill keeps showing work or sync state. Offline, error, and
 * other phases that will not clear on their own show immediately.
 */
export function connectionPillPhase(
  phase: EnvironmentConnectionPhase,
  graceElapsed: boolean,
): EnvironmentConnectionPhase {
  if (graceElapsed) return phase;
  return phase === "connecting" || phase === "reconnecting" ? "connected" : phase;
}

/**
 * The grace period starts when the environment leaves `connected` and resets only when it comes
 * back, so a reconnect loop that passes through `error` does not restart the wait.
 */
export function useConnectionPillPhase(
  phase: EnvironmentConnectionPhase,
): EnvironmentConnectionPhase {
  const disconnected = phase !== "connected";
  const [graceElapsed, setGraceElapsed] = useState(false);
  if (!disconnected && graceElapsed) setGraceElapsed(false);

  useEffect(() => {
    if (!disconnected) return;
    const timer = setTimeout(() => setGraceElapsed(true), CONNECTION_PILL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [disconnected]);

  return connectionPillPhase(phase, graceElapsed);
}
