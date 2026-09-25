/**
 * Tangent(FORK-HOST-001): Project overview's Default host choice. It appears
 * only for projects on more than one server, and the choice belongs to this
 * device.
 */
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useProjectDefaultHosts, useSetProjectDefaultHost } from "../projects/projectDefaultHost";
import { SettingsChoiceRow } from "./components/SettingsChoiceRow";
import { SettingsSection } from "./components/SettingsSection";

export function ProjectDefaultHostSection(props: {
  readonly projectKey: string;
  readonly members: ReadonlyArray<EnvironmentProject>;
}) {
  const environments = useWorkspaceEnvironments();
  const hosts = useProjectDefaultHosts();
  const setDefaultHost = useSetProjectDefaultHost();
  const environmentIds = [...new Set(props.members.map((member) => member.environmentId))];
  if (environmentIds.length < 2) return null;

  // A stale host falls back to Automatic, so Automatic shows as the choice in effect.
  const stored = hosts[props.projectKey];
  const selected = environmentIds.find((environmentId) => environmentId === stored) ?? null;
  const choices = [
    {
      environmentId: null,
      label: "Automatic",
      description: "Start on the usual host.",
    },
    ...environmentIds.map((environmentId) => {
      const environment = environments.find((entry) => entry.environmentId === environmentId);
      return {
        environmentId,
        label: environment?.environmentLabel ?? environmentId,
        description:
          environment?.connectionState === "connected"
            ? "New threads start here."
            : "Offline. New threads use Automatic until it reconnects.",
      };
    }),
  ];

  return (
    <View className="gap-3">
      <SettingsSection title="Default host">
        {choices.map((choice, index) => (
          <SettingsChoiceRow
            key={choice.environmentId ?? "automatic"}
            label={choice.label}
            description={choice.description}
            selected={selected === choice.environmentId}
            separated={index > 0}
            disabled={false}
            onPress={() => setDefaultHost(props.projectKey, choice.environmentId)}
          />
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Where new threads in this project start on this device. You can still switch hosts in a
        draft.
      </Text>
    </View>
  );
}
