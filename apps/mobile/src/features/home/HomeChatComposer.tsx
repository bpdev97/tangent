import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { DEFAULT_PROVIDER_INTERACTION_MODE } from "@t3tools/contracts";
import {
  findGenericChatProject,
  findGenericChatProjectInEnvironment,
  GENERIC_CHAT_RUNTIME_MODE,
} from "@t3tools/shared/genericChat";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Platform, useColorScheme, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { ComposerAttachmentStrip } from "../../components/ComposerAttachmentStrip";
import { ComposerEditor, type ComposerEditorHandle } from "../../components/ComposerEditor";
import {
  ComposerToolbarButton,
  ComposerToolbarRow,
  ComposerToolbarScroller,
  ComposerToolbarTrigger,
} from "../../components/ComposerToolbarTrigger";
import { ControlPill } from "../../components/ControlPill";
import { ProviderIcon } from "../../components/ProviderIcon";
import { makeTurnCommandMetadata } from "../../lib/commandMetadata";
import { convertPastedImagesToAttachments, pickComposerImages } from "../../lib/composerImages";
import {
  buildModelOptions,
  groupByProvider,
  resolveDefaultableModelSelection,
  resolveSelectableModelSelection,
} from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { useFontFamily } from "../../lib/useFontFamily";
import { useThemeColor } from "../../lib/useThemeColor";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { mobilePreferencesAtom } from "../../state/preferences";
import {
  appendComposerDraftAttachments,
  clearComposerDraftContent,
  removeComposerDraftAttachment,
  setComposerDraftText,
  updateComposerDraftSettings,
  useComposerDraft,
} from "../../state/use-composer-drafts";
import { enqueueThreadOutboxMessage } from "../../state/thread-outbox";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import { ComposerSurface } from "../threads/ThreadComposer";
import { ThreadSettingsSheet, threadSettingsSummaryLabel } from "../threads/ThreadSettingsSheet";
import { useCreateProjectThread } from "../threads/use-project-actions";
import { useThreadSettingsSheetPresentation } from "../threads/use-thread-settings-sheet-presentation";
import { buildHomeChatOutboxMessage, homeChatDraftKey } from "./homeChat";

export const HOME_CHAT_COMPOSER_CLEARANCE = 104;

export function HomeChatComposer() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const projects = useProjects();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferredEnvironmentId = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value.preferredGenericChatEnvironmentId
    : undefined;
  const project = useMemo(
    () =>
      preferredEnvironmentId
        ? findGenericChatProjectInEnvironment(projects, preferredEnvironmentId)
        : findGenericChatProject(projects),
    [preferredEnvironmentId, projects],
  );
  const draftKey = homeChatDraftKey(preferredEnvironmentId);
  const draft = useComposerDraft(draftKey);
  const serverConfig = useEnvironmentServerConfig(project?.environmentId ?? null);
  const explicitModel = resolveSelectableModelSelection(serverConfig, draft.modelSelection ?? null);
  const projectDefault = resolveDefaultableModelSelection(
    serverConfig,
    project?.defaultModelSelection ?? null,
  );
  const modelOptions = useMemo(
    () => buildModelOptions(serverConfig, explicitModel ?? projectDefault),
    [explicitModel, projectDefault, serverConfig],
  );
  const modelSelection =
    explicitModel ??
    projectDefault ??
    modelOptions.find((option) => option.isDefault)?.selection ??
    modelOptions[0]?.selection ??
    null;
  const selectedModelOption =
    modelOptions.find(
      (option) =>
        modelSelection !== null &&
        option.selection.instanceId === modelSelection.instanceId &&
        option.selection.model === modelSelection.model,
    ) ?? null;
  const providerGroups = useMemo(() => groupByProvider(modelOptions), [modelOptions]);
  const providerOptionDescriptors = useMemo(
    () =>
      resolveProviderOptionDescriptors({
        capabilities: selectedModelOption?.capabilities,
        selections: modelSelection?.options,
      }),
    [modelSelection?.options, selectedModelOption?.capabilities],
  );
  const skills = useMemo(
    () =>
      serverConfig?.providers.find((provider) => provider.instanceId === modelSelection?.instanceId)
        ?.skills ?? [],
    [modelSelection?.instanceId, serverConfig?.providers],
  );
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const connected =
    project !== null &&
    connectedEnvironments.some(
      (environment) =>
        environment.environmentId === project.environmentId &&
        environment.connectionState === "connected",
    );
  const { savedConnectionsById } = useSavedRemoteConnections();
  const savedConnections = Object.values(savedConnectionsById);
  const hostLabel = project
    ? (savedConnections.find((connection) => connection.environmentId === project.environmentId)
        ?.environmentLabel ?? "Chat host")
    : preferredEnvironmentId
      ? (savedConnections.find((connection) => connection.environmentId === preferredEnvironmentId)
          ?.environmentLabel ?? "Unavailable host")
      : "Chat host";
  const createProjectThread = useCreateProjectThread();
  const editorRef = useRef<ComposerEditorHandle>(null);
  const [focused, setFocused] = useState(false);
  const settingsSheetPresentation = useThreadSettingsSheetPresentation({
    editorRef,
    isEditorFocused: focused,
  });
  const [submitting, setSubmitting] = useState(false);
  const foregroundColor = useThemeColor("--color-foreground");
  const bodyText = useScaledTextRole("body");
  const regularFontFamily = useFontFamily("regular");
  const isDarkMode = useColorScheme() === "dark";
  const expanded = focused || settingsSheetPresentation.isActive;
  const toolbarFadeOpaque = isDarkMode ? "rgba(14,14,14,0.98)" : "rgba(242,242,247,0.98)";
  const toolbarFadeTransparent = isDarkMode ? "rgba(14,14,14,0)" : "rgba(242,242,247,0)";
  const canSend =
    project !== null && modelSelection !== null && draft.text.trim().length > 0 && !submitting;
  const settingsSummaryLabel = threadSettingsSummaryLabel({
    modelLabel: selectedModelOption?.label ?? modelSelection?.model ?? "Model",
    optionDescriptors: providerOptionDescriptors,
    runtimeMode: GENERIC_CHAT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  });

  const pickImages = useCallback(async () => {
    const result = await pickComposerImages({ existingCount: draft.attachments.length });
    if (result.images.length > 0) {
      appendComposerDraftAttachments(draftKey, result.images);
    }
    if (result.error) {
      Alert.alert("Could not add image", result.error);
    }
  }, [draft.attachments.length, draftKey]);

  const pasteImages = useCallback(
    async (uris: ReadonlyArray<string>) => {
      const attachments = await convertPastedImagesToAttachments({
        uris,
        existingCount: draft.attachments.length,
      });
      appendComposerDraftAttachments(draftKey, attachments);
    },
    [draft.attachments.length, draftKey],
  );

  const send = useCallback(async () => {
    if (!project || !modelSelection || !draft.text.trim() || submitting) return;
    const text = draft.text.trim();
    setSubmitting(true);
    try {
      if (!connected) {
        await enqueueThreadOutboxMessage(
          buildHomeChatOutboxMessage({
            project,
            text,
            attachments: draft.attachments,
            modelSelection,
            metadata: makeTurnCommandMetadata(),
          }),
        );
        clearComposerDraftContent(draftKey);
        editorRef.current?.blur();
        Alert.alert("Chat queued", `${hostLabel} will start it when it reconnects.`);
        return;
      }

      const result = await createProjectThread({
        project,
        modelSelection,
        envMode: "local",
        branch: null,
        worktreePath: null,
        startFromOrigin: false,
        runtimeMode: GENERIC_CHAT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        initialMessageText: text,
        initialAttachments: draft.attachments,
      });
      if (result._tag === "Failure") {
        Alert.alert("Could not start chat", "Your draft is still here. Try again in a moment.");
        return;
      }
      clearComposerDraftContent(draftKey);
      navigation.navigate("Thread", {
        environmentId: String(result.value.environmentId),
        threadId: String(result.value.threadId),
      });
    } catch (error) {
      Alert.alert(
        connected ? "Could not start chat" : "Could not queue chat",
        error instanceof Error ? error.message : "Your draft is still here.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    connected,
    createProjectThread,
    draft.text,
    draft.attachments,
    draftKey,
    hostLabel,
    modelSelection,
    navigation,
    project,
    submitting,
  ]);

  if (Platform.OS !== "ios") return null;

  return (
    <KeyboardStickyView
      pointerEvents="box-none"
      style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
      offset={{ closed: 0, opened: 0 }}
    >
      <View
        pointerEvents="box-none"
        className="w-full px-3 pt-2"
        style={{ paddingBottom: focused ? 8 : Math.max(insets.bottom, 10) }}
      >
        <View className="mb-1.5 flex-row items-center px-3">
          <Text className="min-w-0 flex-1 text-xs font-t3-medium text-foreground-muted">
            New chat on {hostLabel}
          </Text>
          {!project ? (
            <Text className="text-xs font-t3-medium text-danger">Host unavailable</Text>
          ) : !connected ? (
            <Text className="text-xs font-t3-medium text-foreground-muted">Will queue</Text>
          ) : null}
        </View>
        <View className="w-full max-w-[720px] self-center">
          <ComposerSurface
            isDarkMode={isDarkMode}
            style={
              expanded
                ? {
                    borderRadius: 20,
                    overflow: "hidden",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }
                : {
                    borderRadius: 999,
                    overflow: "hidden",
                    flexDirection: "row",
                    alignItems: "center",
                    paddingLeft: 18,
                    paddingRight: 5,
                    paddingVertical: 5,
                  }
            }
          >
            {expanded && draft.attachments.length > 0 ? (
              <View className="pb-2.5">
                <ComposerAttachmentStrip
                  attachments={draft.attachments}
                  onRemove={(imageId) => removeComposerDraftAttachment(draftKey, imageId)}
                />
              </View>
            ) : null}
            <View className={expanded ? undefined : "min-w-0 flex-1"}>
              <ComposerEditor
                ref={editorRef}
                value={draft.text}
                skills={skills}
                multiline
                scrollEnabled={focused}
                placeholder="Ask anything…"
                onChangeText={(value) => setComposerDraftText(draftKey, value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onPasteImages={(uris) => void pasteImages(uris)}
                onSubmit={() => void send()}
                singleLineCentered={!expanded}
                contentInsetVertical={expanded ? 0 : 6}
                style={
                  expanded
                    ? {
                        minHeight: 80,
                        maxHeight: 160,
                        paddingHorizontal: 4,
                        paddingVertical: 4,
                      }
                    : { height: 36 }
                }
                textStyle={{ ...bodyText, color: foregroundColor, fontFamily: regularFontFamily }}
              />
            </View>
            {!expanded ? (
              <ControlPill
                accessibilityLabel={connected ? "Start chat" : "Queue chat"}
                icon="arrow.up"
                variant="primary"
                disabled={!canSend}
                onPress={() => void send()}
              />
            ) : null}
          </ComposerSurface>
          {expanded ? (
            <ComposerToolbarRow paddingBottom={8} paddingHorizontal={0} paddingTop={8}>
              <ComposerToolbarScroller
                fadeOpaque={toolbarFadeOpaque}
                fadeTransparent={toolbarFadeTransparent}
              >
                <ComposerToolbarButton
                  accessibilityLabel="Add attachment"
                  icon="plus"
                  onPress={() => void pickImages()}
                  showChevron={false}
                />
                <ComposerToolbarTrigger
                  accessibilityLabel="Chat settings"
                  iconNode={
                    <ProviderIcon provider={selectedModelOption?.providerDriver} size={16} />
                  }
                  label={settingsSummaryLabel}
                  maxWidth={280}
                  onPress={settingsSheetPresentation.open}
                />
              </ComposerToolbarScroller>
              <ComposerToolbarButton
                accessibilityLabel={connected ? "Start chat" : "Queue chat"}
                icon={connected ? "arrow.up" : "tray.and.arrow.up"}
                variant="primary"
                disabled={!canSend}
                onPress={() => void send()}
                showChevron={false}
              />
            </ComposerToolbarRow>
          ) : null}
        </View>
      </View>
      <ThreadSettingsSheet
        visible={settingsSheetPresentation.isVisible}
        onClose={settingsSheetPresentation.close}
        onDismissed={settingsSheetPresentation.onDismissed}
        providerGroups={providerGroups}
        selectedModel={modelSelection}
        onSelectModel={(option) =>
          updateComposerDraftSettings(draftKey, { modelSelection: option.selection })
        }
        optionDescriptors={providerOptionDescriptors}
        onUpdateOptionSelections={(options) => {
          if (modelSelection) {
            updateComposerDraftSettings(draftKey, {
              modelSelection: { ...modelSelection, options },
            });
          }
        }}
        runtimeMode={GENERIC_CHAT_RUNTIME_MODE}
        onUpdateRuntimeMode={() => undefined}
        runtimeModeLocked
      />
    </KeyboardStickyView>
  );
}
