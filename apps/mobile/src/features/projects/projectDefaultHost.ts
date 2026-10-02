/**
 * Tangent(FORK-HOST-001): the mobile side of each device's default host for a
 * project. The choice lives in device preferences, keyed by the logical project
 * key the home list and project picker already use. See
 * docs/fork/project-default-host.md.
 */
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveProjectDefaultHostMember,
  setProjectDefaultHost,
  type ProjectDefaultHosts,
} from "@t3tools/shared/projectDefaultHost";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { scopedProjectKey } from "../../lib/scopedEntities";
import { useProjects } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { buildHomeProjectScopes, type HomeProjectScope } from "../home/homeThreadList";

const NO_DEFAULT_HOSTS: ProjectDefaultHosts = {};

export function useProjectDefaultHosts(): ProjectDefaultHosts {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences)
    ? (preferences.value.projectDefaultHosts ?? NO_DEFAULT_HOSTS)
    : NO_DEFAULT_HOSTS;
}

/** Sets or, with null, clears a project's default host on this device. */
export function useSetProjectDefaultHost() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  return useCallback(
    (projectKey: string, environmentId: string | null) =>
      savePreferences({
        transform: (current) => ({
          projectDefaultHosts: setProjectDefaultHost(
            current.projectDefaultHosts ?? NO_DEFAULT_HOSTS,
            projectKey,
            environmentId,
          ),
        }),
      }),
    [savePreferences],
  );
}

/**
 * Maps a project to the member a new thread in it starts on: the member on its
 * default host when that host is connected, otherwise the project itself.
 */
export function useResolveProjectDefaultHost() {
  const projects = useProjects();
  const groupingSettings = useMobileProjectGroupingSettings();
  const hosts = useProjectDefaultHosts();
  const environments = useWorkspaceEnvironments();
  const scopeByProjectKey = useMemo(() => {
    const scopes = new Map<string, HomeProjectScope>();
    for (const scope of buildHomeProjectScopes({
      projects,
      environmentId: null,
      projectGroupingMode: groupingSettings.sidebarProjectGroupingMode,
    })) {
      for (const project of scope.projects) {
        scopes.set(scopedProjectKey(project.environmentId, project.id), scope);
      }
    }
    return scopes;
  }, [groupingSettings.sidebarProjectGroupingMode, projects]);

  return useCallback(
    (project: EnvironmentProject): EnvironmentProject => {
      const scope = scopeByProjectKey.get(scopedProjectKey(project.environmentId, project.id));
      if (!scope) return project;
      return (
        resolveProjectDefaultHostMember({
          members: scope.projects,
          defaultEnvironmentId: hosts[scope.key],
          isEnvironmentConnected: (environmentId) =>
            environments.some(
              (environment) =>
                environment.environmentId === environmentId &&
                environment.connectionState === "connected",
            ),
          preferred: project,
        }) ?? project
      );
    },
    [environments, hosts, scopeByProjectKey],
  );
}
