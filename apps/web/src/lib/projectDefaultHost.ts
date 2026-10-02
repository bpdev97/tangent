/**
 * Tangent(FORK-HOST-001): the web and desktop side of each client's default
 * host for a project. The setting lives in client settings, keyed by the
 * logical project key. See docs/fork/project-default-host.md.
 */
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { resolveProjectDefaultHostMember } from "@t3tools/shared/projectDefaultHost";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects } from "../state/entities";
import { useConnectedEnvironmentIds } from "../state/environments";
import { environmentSummaries } from "../state/presentation";

/**
 * Where a new thread in `projectRef`'s project starts: the member on the
 * project's default host when that host is connected, else `projectRef`.
 * Reads current state rather than subscribing, because it runs on click.
 */
export function resolveNewThreadProjectRef(projectRef: ScopedProjectRef): ScopedProjectRef {
  const settings = getClientSettings();
  const projects = readProjects();
  const project = projects.find(
    (candidate) =>
      candidate.environmentId === projectRef.environmentId && candidate.id === projectRef.projectId,
  );
  if (!project) return projectRef;
  const grouping = selectProjectGroupingSettings(settings);
  const projectKey = deriveLogicalProjectKeyFromSettings(project, grouping);
  const defaultEnvironmentId = settings.projectDefaultHosts[projectKey];
  if (!defaultEnvironmentId) return projectRef;
  const connected = appAtomRegistry.get(environmentSummaries.connectedEnvironmentIdsAtom);
  const member = resolveProjectDefaultHostMember({
    members: projects.filter(
      (candidate) => deriveLogicalProjectKeyFromSettings(candidate, grouping) === projectKey,
    ),
    defaultEnvironmentId,
    isEnvironmentConnected: (environmentId) =>
      connected.some((connectedId) => connectedId === environmentId),
    preferred: project,
  });
  return member ? scopeProjectRef(member.environmentId, member.id) : projectRef;
}

/**
 * Whether the project's default host decides where its drafts start. Load
 * balancing stands aside while it does, unless the user picks Auto.
 */
export function useProjectDefaultHostActive(
  project: Parameters<typeof deriveLogicalProjectKeyFromSettings>[0] | null | undefined,
  environments: ReadonlyArray<{ readonly environmentId: string }>,
): boolean {
  const defaultEnvironmentId = useClientSettings((settings) =>
    project
      ? settings.projectDefaultHosts[
          deriveLogicalProjectKeyFromSettings(project, selectProjectGroupingSettings(settings))
        ]
      : undefined,
  );
  const connected = useConnectedEnvironmentIds();
  return (
    resolveProjectDefaultHostMember({
      members: environments,
      defaultEnvironmentId,
      isEnvironmentConnected: (environmentId) =>
        connected.some((connectedId) => connectedId === environmentId),
    }) !== null
  );
}
