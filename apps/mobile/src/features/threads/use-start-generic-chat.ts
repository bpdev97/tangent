import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { findGenericChatProject, GENERIC_CHAT_PROJECT_TITLE } from "@t3tools/shared/genericChat";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { useProjects } from "../../state/entities";
import { mobilePreferencesAtom } from "../../state/preferences";

export function useGenericChatProject() {
  const projects = useProjects();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const preferredEnvironmentId = AsyncResult.isSuccess(preferences)
    ? preferences.value.preferredGenericChatEnvironmentId
    : undefined;
  const genericChatProject = useMemo(
    () => findGenericChatProject(projects, preferredEnvironmentId),
    [preferredEnvironmentId, projects],
  );

  return {
    genericChatProject,
    genericChatEnvironmentId: genericChatProject?.environmentId ?? preferredEnvironmentId ?? null,
  };
}

export function useStartGenericChat() {
  const navigation = useNavigation();
  const { genericChatProject, genericChatEnvironmentId } = useGenericChatProject();

  const startGenericChat = useCallback(() => {
    if (genericChatProject === null) {
      return;
    }
    navigation.navigate("NewTaskSheet", {
      screen: "NewTaskDraft",
      params: {
        environmentId: String(genericChatProject.environmentId),
        projectId: String(genericChatProject.id),
        title: GENERIC_CHAT_PROJECT_TITLE,
      },
    });
  }, [genericChatProject, navigation]);

  return {
    genericChatAvailable: genericChatProject !== null,
    genericChatEnvironmentId,
    startGenericChat,
  };
}
