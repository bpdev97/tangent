import { useEffect } from "react";

import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { syncAgentAwarenessConnections } from "./remoteRegistration";

/**
 * Tangent(FORK-PUSH-001): registers this device with every directly paired
 * server's personal push relay as saved environments come and go.
 */
export function AgentAwarenessConnectionBridge() {
  const { isLoadingSavedConnection, savedConnectionsById } = useSavedRemoteConnections();

  useEffect(() => {
    if (isLoadingSavedConnection) return;
    syncAgentAwarenessConnections(Object.values(savedConnectionsById));
  }, [isLoadingSavedConnection, savedConnectionsById]);

  return null;
}
