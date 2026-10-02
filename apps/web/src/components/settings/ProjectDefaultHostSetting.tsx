/**
 * Tangent(FORK-HOST-001): the project page's Default host row. The choice
 * belongs to this client and covers the whole project, so the row ignores the
 * page's environment scope. It appears only when there is more than one server
 * to choose from. On a No project page it sets No project's default host,
 * chosen among the servers that offer No project.
 */
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import {
  NO_PROJECT_DEFAULT_HOST_KEY,
  setProjectDefaultHost,
} from "@t3tools/shared/projectDefaultHost";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useEnvironments } from "../../state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { useSettingsProjectGroups } from "./useSettingsProjectGroups";

const AUTOMATIC = "automatic";

export function ProjectDefaultHostSetting({ group }: { group: SidebarProjectSnapshot }) {
  const hosts = useClientSettings((settings) => settings.projectDefaultHosts);
  const updateClientSettings = useUpdateClientSettings();
  const { environments: allEnvironments } = useEnvironments();
  const wholeGroup =
    useSettingsProjectGroups().find((entry) => entry.projectKey === group.projectKey) ?? group;
  const scratchRoots = new Map(
    allEnvironments.map((environment) => [
      environment.environmentId,
      environment.serverConfig?.scratchWorkspaceRoot,
    ]),
  );
  const noProject = wholeGroup.memberProjects.some((member) =>
    isScratchProject(member, scratchRoots.get(member.environmentId)),
  );
  const hostKey = noProject ? NO_PROJECT_DEFAULT_HOST_KEY : wholeGroup.projectKey;
  const environments = new Map<string, string>(
    noProject
      ? allEnvironments
          .filter((environment) => environment.serverConfig?.scratchWorkspaceRoot)
          .map((environment) => [environment.environmentId, environment.label])
      : wholeGroup.memberProjects.map((member) => [
          member.environmentId,
          member.environmentLabel ?? member.environmentId,
        ]),
  );
  if (environments.size < 2) return null;

  const selected = hosts[hostKey];
  // A host that no longer has this project still shows, so the choice is visible and clearable.
  const value = selected ?? AUTOMATIC;
  const labelFor = (environmentId: string) =>
    environmentId === AUTOMATIC
      ? "Automatic"
      : (environments.get(environmentId) ?? "Unavailable host");

  return (
    <SettingsRow
      title="Default host"
      description={
        noProject
          ? "Where new threads without a project start on this device. If that host is offline, the usual choice applies."
          : "Where new threads in this project start on this device. If that host is offline, the usual choice applies."
      }
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            void updateClientSettings({
              projectDefaultHosts: setProjectDefaultHost(
                hosts,
                hostKey,
                next === AUTOMATIC ? null : next,
              ),
            });
          }}
        >
          <SelectTrigger size="sm" aria-label="Default host">
            <SelectValue>{(current: string | null) => labelFor(current ?? AUTOMATIC)}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
            {[...environments].map(([environmentId, label]) => (
              <SelectItem key={environmentId} value={environmentId}>
                {label}
              </SelectItem>
            ))}
            {selected && !environments.has(selected) ? (
              <SelectItem value={selected}>Unavailable host</SelectItem>
            ) : null}
          </SelectPopup>
        </Select>
      }
    />
  );
}
