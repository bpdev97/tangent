import { describe, expect, it } from "vite-plus/test";

import type { WorkspaceEnvironment, WorkspaceState } from "../../state/workspaceModel";
import { quietConnectionIndicator } from "./quiet-connection-indicator";

const sleepingLaptop: WorkspaceEnvironment = {
  environmentId: "environment-1" as never,
  environmentLabel: "bpdev-work-studio",
  displayUrl: "",
  isRelayManaged: false,
  isEnabled: true,
  connectionState: "reconnecting",
  connectionError: null,
  connectionErrorTraceId: null,
};

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: true,
    hasPendingShellSnapshot: false,
    hasReadyEnvironment: true,
    hasConnectingEnvironment: false,
    connectingEnvironments: [],
    connectionState: "connected",
    connectionError: null,
    shellSnapshotError: null,
    networkStatus: "online",
    ...overrides,
  };
}

describe("quiet connection indicator", () => {
  it("leaves first launch to upstream's title", () => {
    expect(quietConnectionIndicator(workspaceState({ hasLoadedShellSnapshot: false }))).toBe(
      undefined,
    );
  });

  it("shows nothing while every environment is connected", () => {
    expect(quietConnectionIndicator(workspaceState())).toBe("none");
  });

  it("marks a sleeping machine beside a connected one as partial", () => {
    const state = workspaceState({
      hasConnectingEnvironment: true,
      connectingEnvironments: [sleepingLaptop],
    });
    expect(quietConnectionIndicator(state)).toBe("partial");
    expect(quietConnectionIndicator(workspaceState({ connectionError: "refused" }))).toBe(
      "partial",
    );
  });

  it("marks disconnected when nothing is reachable or the phone is offline", () => {
    const state = workspaceState({
      hasReadyEnvironment: false,
      hasConnectingEnvironment: true,
      connectingEnvironments: [sleepingLaptop],
    });
    expect(quietConnectionIndicator(state)).toBe("disconnected");
    expect(quietConnectionIndicator(workspaceState({ networkStatus: "offline" }))).toBe(
      "disconnected",
    );
  });
});
