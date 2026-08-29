import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  HermesAutomation,
  HermesAutomationHost,
  HermesAutomationListResult,
  HermesAutomationMutationInput,
} from "@t3tools/contracts";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ErrorBanner } from "../../components/ErrorBanner";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { hermesAutomationEnvironment } from "../../state/hermesAutomations";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { sortEnvironmentsByLabel } from "./automationsPresentation";

type LifecycleAction = "pause" | "resume" | "run" | "remove";

function mutationMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Hermes automation request failed.";
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ActionButton(props: {
  readonly icon: "play" | "stop.fill" | "square.and.pencil" | "trash";
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "min-h-10 flex-row items-center justify-center gap-2 rounded-full bg-subtle px-3.5 active:opacity-70",
        props.disabled && "opacity-45",
      )}
    >
      <SymbolView
        name={props.icon}
        size={14}
        tintColorClassName={props.destructive ? "accent-danger-foreground" : "accent-icon"}
        type="monochrome"
      />
      <Text
        className={cn(
          "text-xs font-t3-bold",
          props.destructive ? "text-danger-foreground" : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function AutomationCard(props: {
  readonly automation: HermesAutomation;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onEdit: () => void;
  readonly onAction: (action: LifecycleAction) => void;
}) {
  const repeat = props.automation.repeat.times
    ? `${props.automation.repeat.completed}/${props.automation.repeat.times} runs`
    : `${props.automation.repeat.completed} runs`;

  return (
    <View className="gap-4 rounded-[20px] border border-border bg-card p-4">
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="shrink text-base font-t3-bold" numberOfLines={2}>
              {props.automation.name}
            </Text>
            <View
              className={cn(
                "rounded-full px-2.5 py-1",
                props.automation.enabled ? "bg-subtle-strong" : "bg-subtle",
              )}
            >
              <Text
                className={cn(
                  "text-2xs font-t3-bold",
                  props.automation.enabled ? "text-foreground" : "text-foreground-muted",
                )}
              >
                {props.automation.state}
              </Text>
            </View>
          </View>
          <Text className="font-mono text-xs text-foreground-muted">
            {props.automation.schedule}
          </Text>
        </View>
        {props.busy ? <ActivityIndicator size="small" /> : null}
      </View>

      {props.automation.prompt ? (
        <Text className="text-sm leading-normal text-foreground-secondary" numberOfLines={4}>
          {props.automation.prompt}
        </Text>
      ) : null}

      <View className="gap-1.5">
        <Text className="text-xs text-foreground-muted">
          Next: {formatTimestamp(props.automation.nextRunAt)}
        </Text>
        <Text className="text-xs text-foreground-muted">
          Delivery: {props.automation.delivery.join(", ") || "default"} · {repeat}
        </Text>
        {props.automation.skills.length > 0 ? (
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            Skills: {props.automation.skills.join(", ")}
          </Text>
        ) : null}
        {props.automation.lastStatus ? (
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            Last status: {props.automation.lastStatus}
          </Text>
        ) : null}
      </View>

      <View className="flex-row flex-wrap gap-2">
        <ActionButton
          icon="square.and.pencil"
          label="Edit"
          disabled={props.disabled}
          onPress={props.onEdit}
        />
        <ActionButton
          icon="play"
          label="Run now"
          disabled={props.disabled}
          onPress={() => props.onAction("run")}
        />
        <ActionButton
          icon={props.automation.enabled ? "stop.fill" : "play"}
          label={props.automation.enabled ? "Pause" : "Resume"}
          disabled={props.disabled}
          onPress={() => props.onAction(props.automation.enabled ? "pause" : "resume")}
        />
        <ActionButton
          destructive
          icon="trash"
          label="Delete"
          disabled={props.disabled}
          onPress={() => props.onAction("remove")}
        />
      </View>
    </View>
  );
}

function HostCard(props: {
  readonly environmentId: EnvironmentId;
  readonly host: HermesAutomationHost;
  readonly busyKey: string | null;
  readonly onAction: (automation: HermesAutomation, action: LifecycleAction) => void;
}) {
  const navigation = useNavigation();
  const hostBusyPrefix = `${props.host.instanceId}:`;
  const hostBusy = props.busyKey?.startsWith(hostBusyPrefix) === true;
  const openEditor = useCallback(
    (automationId?: string) => {
      navigation.navigate("SettingsSheet", {
        screen: "SettingsContent",
        params: {
          screen: "SettingsAutomationEditor",
          params: {
            environmentId: String(props.environmentId),
            instanceId: String(props.host.instanceId),
            ...(automationId ? { automationId } : {}),
          },
        },
      });
    },
    [navigation, props.environmentId, props.host.instanceId],
  );

  return (
    <View className="gap-4 rounded-[24px] bg-card p-4">
      <View className="flex-row items-center gap-3">
        <View className="size-10 items-center justify-center rounded-[14px] bg-subtle">
          <SymbolView
            name="bolt.horizontal.circle"
            size={19}
            tintColorClassName="accent-icon"
            type="monochrome"
          />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-t3-bold" numberOfLines={1}>
            {props.host.displayName}
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            Profile: {props.host.profile}
          </Text>
        </View>
        <View
          className={cn(
            "rounded-full px-2.5 py-1",
            props.host.status === "available" ? "bg-subtle-strong" : "bg-danger",
          )}
        >
          <Text
            className={cn(
              "text-2xs font-t3-bold",
              props.host.status === "available" ? "text-foreground" : "text-danger-foreground",
            )}
          >
            {props.host.status}
          </Text>
        </View>
      </View>

      {props.host.statusMessage ? <ErrorBanner message={props.host.statusMessage} /> : null}

      <Pressable
        accessibilityRole="button"
        disabled={props.host.status !== "available" || hostBusy}
        onPress={() => openEditor()}
        className="min-h-11 flex-row items-center justify-center gap-2 rounded-full bg-primary px-4 active:opacity-70 disabled:opacity-45"
      >
        <SymbolView
          name="plus"
          size={15}
          tintColorClassName="accent-primary-foreground"
          type="monochrome"
        />
        <Text className="text-sm font-t3-bold text-primary-foreground">New automation</Text>
      </Pressable>

      {props.host.automations.length === 0 ? (
        <View className="rounded-[18px] border border-dashed border-border px-5 py-6">
          <Text className="text-center text-sm text-foreground-muted">
            No automations are configured for this profile.
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {props.host.automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              busy={props.busyKey === `${props.host.instanceId}:${automation.id}`}
              disabled={hostBusy}
              onEdit={() => openEditor(automation.id)}
              onAction={(action) => props.onAction(automation, action)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function EnvironmentSection(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly displayUrl: string | null;
}) {
  const query = useEnvironmentQuery(
    hermesAutomationEnvironment.list({ environmentId: props.environmentId, input: {} }),
  );
  const mutate = useAtomCommand(hermesAutomationEnvironment.mutate, {
    label: "Manage Hermes automation",
    reportFailure: false,
  });
  const [localResult, setLocalResult] = useState<HermesAutomationListResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const result = localResult ?? query.data;
  const refresh = query.refresh;

  useEffect(() => setLocalResult(null), [query.data]);
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const performMutation = useCallback(
    async (input: HermesAutomationMutationInput) => {
      setBusyKey(`${input.instanceId}:${"automationId" in input ? input.automationId : "create"}`);
      const outcome = await mutate({ environmentId: props.environmentId, input });
      setBusyKey(null);
      if (outcome._tag === "Failure") {
        if (!isAtomCommandInterrupted(outcome)) {
          Alert.alert(
            "Hermes automation failed",
            mutationMessage(squashAtomCommandFailure(outcome)),
          );
        }
        return false;
      }
      setLocalResult(outcome.value);
      refresh();
      return true;
    },
    [mutate, props.environmentId, refresh],
  );

  const performLifecycle = useCallback(
    (host: HermesAutomationHost, automation: HermesAutomation, action: LifecycleAction) => {
      const run = () => {
        void performMutation({
          action,
          instanceId: host.instanceId,
          automationId: automation.id,
        });
      };
      if (action !== "remove") {
        run();
        return;
      }
      Alert.alert(
        "Delete automation?",
        `“${automation.name}” will be permanently removed from Hermes.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: run },
        ],
      );
    },
    [performMutation],
  );

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3 px-1">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-t3-bold" numberOfLines={1}>
            {props.label}
          </Text>
          {props.displayUrl ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {props.displayUrl}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={query.isPending}
          onPress={refresh}
          className="min-h-10 flex-row items-center gap-2 rounded-full bg-subtle px-3.5 active:opacity-70 disabled:opacity-45"
        >
          <SymbolView
            name="arrow.clockwise"
            size={14}
            tintColorClassName="accent-icon"
            type="monochrome"
          />
          <Text className="text-xs font-t3-bold">Refresh</Text>
        </Pressable>
      </View>

      {query.error ? (
        <ErrorBanner message={query.error} />
      ) : !result ? (
        <View className="min-h-28 items-center justify-center rounded-[24px] bg-card">
          <ActivityIndicator />
        </View>
      ) : result.hosts.length === 0 ? (
        <View className="rounded-[24px] border border-dashed border-border px-5 py-7">
          <Text className="text-center text-sm leading-normal text-foreground-muted">
            No enabled Hermes profiles are configured on this environment.
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          {result.hosts.map((host) => (
            <HostCard
              key={host.instanceId}
              environmentId={props.environmentId}
              host={host}
              busyKey={busyKey}
              onAction={(automation, action) => performLifecycle(host, automation, action)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export function AutomationsRouteScreen() {
  const { environments, isReady } = useEnvironments();
  const insets = useSafeAreaInsets();
  const sortedEnvironments = useMemo(() => sortEnvironmentsByLabel(environments), [environments]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          gap: 28,
        }}
      >
        {!isReady ? (
          <View className="min-h-48 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : sortedEnvironments.length === 0 ? (
          <EmptyState
            title="No environments connected"
            detail="Connect a Hermes host to manage its automations here."
          />
        ) : (
          sortedEnvironments.map((environment) => (
            <EnvironmentSection
              key={environment.environmentId}
              environmentId={environment.environmentId}
              label={environment.label}
              displayUrl={environment.displayUrl}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
