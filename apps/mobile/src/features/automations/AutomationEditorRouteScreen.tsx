import {
  buildHermesAutomationUpsert,
  draftForHermesAutomation,
  type HermesAutomationDraft,
  validateHermesAutomationDraft,
} from "@t3tools/client-runtime/operations/hermes-automations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { hermesAutomationEnvironment } from "../../state/hermesAutomations";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

type AutomationEditorRouteParams = {
  readonly environmentId: string;
  readonly instanceId: string;
  readonly automationId?: string;
};

function Field(props: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string;
}) {
  return (
    <View className="gap-1.5">
      <Text className="px-1 text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
        {props.label}
      </Text>
      {props.children}
      {props.hint ? (
        <Text className="px-1 text-xs leading-normal text-foreground-muted">{props.hint}</Text>
      ) : null}
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Hermes automation request failed.";
}

export function AutomationEditorRouteScreen({
  route,
}: StaticScreenProps<AutomationEditorRouteParams>) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const query = useEnvironmentQuery(hermesAutomationEnvironment.list({ environmentId, input: {} }));
  const mutate = useAtomCommand(hermesAutomationEnvironment.mutate, {
    label: "Save Hermes automation",
    reportFailure: false,
  });
  const [draft, setDraft] = useState<HermesAutomationDraft>(() => draftForHermesAutomation(null));
  const [saving, setSaving] = useState(false);
  const initializedKey = useRef<string | null>(null);
  const host = query.data?.hosts.find(
    (candidate) => candidate.instanceId === route.params.instanceId,
  );
  const automation = route.params.automationId
    ? host?.automations.find((candidate) => candidate.id === route.params.automationId)
    : null;
  const editorKey = `${route.params.instanceId}:${route.params.automationId ?? "new"}`;
  const validation = useMemo(() => validateHermesAutomationDraft(draft), [draft]);

  useEffect(() => {
    if (
      !host ||
      (route.params.automationId && !automation) ||
      initializedKey.current === editorKey
    ) {
      return;
    }
    initializedKey.current = editorKey;
    setDraft(draftForHermesAutomation(automation ?? null));
  }, [automation, editorKey, host, route.params.automationId]);

  const update = <K extends keyof HermesAutomationDraft>(key: K, value: HermesAutomationDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!host) return;
    const built = buildHermesAutomationUpsert({
      instanceId: host.instanceId,
      ...(automation ? { automationId: automation.id } : {}),
      draft,
    });
    if (!built.ok) {
      Alert.alert("Check automation", built.message);
      return;
    }

    setSaving(true);
    const outcome = await mutate({ environmentId, input: built.input });
    setSaving(false);
    if (outcome._tag === "Failure") {
      if (!isAtomCommandInterrupted(outcome)) {
        Alert.alert("Hermes automation failed", errorMessage(squashAtomCommandFailure(outcome)));
      }
      return;
    }
    navigation.goBack();
  };

  const loading = query.isPending && !query.data;
  const missingAutomation = Boolean(route.params.automationId && host && !automation);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          gap: 18,
        }}
      >
        {query.error ? (
          <ErrorBanner message={query.error} />
        ) : loading ? (
          <View className="min-h-48 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : !host ? (
          <ErrorBanner message="This Hermes profile is no longer available on the environment." />
        ) : missingAutomation ? (
          <ErrorBanner message="This Hermes automation no longer exists." />
        ) : (
          <>
            <View className="rounded-[20px] bg-card px-4 py-3">
              <Text className="text-sm font-t3-bold">{host.displayName}</Text>
              <Text className="text-xs text-foreground-muted">Profile: {host.profile}</Text>
            </View>

            <View className="gap-4 rounded-[24px] bg-card p-4">
              <Field label="Name">
                <TextInput
                  placeholder="Morning briefing"
                  value={draft.name}
                  onChangeText={(value) => update("name", value)}
                />
              </Field>
              <Field label="Schedule" hint="Examples: 0 9 * * * or every 2h">
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="every 2h"
                  value={draft.schedule}
                  onChangeText={(value) => update("schedule", value)}
                />
              </Field>
              <Field label="Prompt">
                <TextInput
                  multiline
                  placeholder="Describe what Hermes should do on each run."
                  textAlignVertical="top"
                  value={draft.prompt}
                  onChangeText={(value) => update("prompt", value)}
                  className="min-h-28"
                />
              </Field>
              <Field label="Delivery target" hint="For example: local, telegram, or discord">
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="local"
                  value={draft.delivery}
                  onChangeText={(value) => update("delivery", value)}
                />
              </Field>
              <Field label="Repeat limit" hint="Leave blank to use the schedule default.">
                <TextInput
                  keyboardType="number-pad"
                  placeholder="Unlimited"
                  value={draft.repeat}
                  onChangeText={(value) => update("repeat", value)}
                />
              </Field>
              <Field label="Skills" hint="Separate skill names with commas.">
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="github, summary"
                  value={draft.skills}
                  onChangeText={(value) => update("skills", value)}
                />
              </Field>
              <Field label="Script" hint="Path under ~/.hermes/scripts.">
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="daily-report.py"
                  value={draft.script}
                  onChangeText={(value) => update("script", value)}
                />
              </Field>
              <Field label="Working directory">
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="/path/to/project"
                  value={draft.workdir}
                  onChangeText={(value) => update("workdir", value)}
                />
              </Field>
              <View className="flex-row items-center gap-3 rounded-[18px] bg-subtle px-4 py-3">
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-sm font-t3-bold">Script-only mode</Text>
                  <Text className="text-xs leading-normal text-foreground-muted">
                    Skip the model and deliver script output directly.
                  </Text>
                </View>
                <Switch value={draft.noAgent} onValueChange={(value) => update("noAgent", value)} />
              </View>
            </View>

            {!validation.ok ? <ErrorBanner message={validation.message} /> : null}

            <Pressable
              accessibilityRole="button"
              disabled={!validation.ok || saving}
              onPress={() => void submit()}
              className="min-h-12 items-center justify-center rounded-full bg-primary px-5 active:opacity-70 disabled:opacity-45"
            >
              {saving ? (
                <ActivityIndicator colorClassName="accent-primary-foreground" />
              ) : (
                <Text className="text-base font-t3-bold text-primary-foreground">
                  {automation ? "Save changes" : "Create automation"}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}
