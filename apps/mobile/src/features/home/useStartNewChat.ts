/**
 * Tangent(FORK-CHAT-001): Home's compose button starts a chat.
 *
 * It opens the new-task sheet on a draft in the managed Chats project, with the
 * project picker beneath it, so going back or tapping the project name picks a
 * different project. Before any server reports Chats it opens the picker.
 */
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { findGenericChatProject } from "@t3tools/shared/genericChat";
import { useCallback } from "react";

import { useProjects } from "../../state/entities";
import { useResolveProjectDefaultHost } from "../projects/projectDefaultHost";

export function useStartNewChat(preferredEnvironmentId: EnvironmentId | null) {
  const navigation = useNavigation();
  const projects = useProjects();
  const resolveDefaultHost = useResolveProjectDefaultHost(); // Tangent(FORK-HOST-001)

  return useCallback(() => {
    const chats = findGenericChatProject(projects, preferredEnvironmentId);
    if (chats === null) {
      navigation.navigate("NewTaskSheet", { screen: "NewTask" });
      return;
    }
    const project = resolveDefaultHost(chats);
    navigation.navigate("NewTaskSheet", {
      screen: "NewTaskDraft",
      initial: false,
      params: {
        environmentId: String(project.environmentId),
        projectId: String(project.id),
        title: project.title,
      },
    });
  }, [navigation, preferredEnvironmentId, projects, resolveDefaultHost]);
}
