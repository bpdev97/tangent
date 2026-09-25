/**
 * Tangent(FORK-HOST-001): the project page's Default host row. It appears only
 * for projects on more than one server, and the choice belongs to this client.
 */
import { setProjectDefaultHost } from "@t3tools/shared/projectDefaultHost";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";

const AUTOMATIC = "automatic";

export function ProjectDefaultHostSetting({ group }: { group: SidebarProjectSnapshot }) {
  const hosts = useClientSettings((settings) => settings.projectDefaultHosts);
  const updateClientSettings = useUpdateClientSettings();
  const environments = new Map<string, string>(
    group.memberProjects.map((member) => [
      member.environmentId,
      member.environmentLabel ?? member.environmentId,
    ]),
  );
  if (environments.size < 2) return null;

  const selected = hosts[group.projectKey];
  // A host that no longer has this project still shows, so the choice is visible and clearable.
  const value = selected ?? AUTOMATIC;
  const labelFor = (environmentId: string) =>
    environmentId === AUTOMATIC
      ? "Automatic"
      : (environments.get(environmentId) ?? "Unavailable host");

  return (
    <SettingsRow
      title="Default host"
      description="Where new threads in this project start on this device. If that host is offline, the usual choice applies."
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            void updateClientSettings({
              projectDefaultHosts: setProjectDefaultHost(
                hosts,
                group.projectKey,
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
