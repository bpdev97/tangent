/**
 * Tangent(FORK-CHAT-001): the iOS home header's Chats menu.
 *
 * Chats are threads in the managed Chats project, so "Show chats" is the home
 * list's project filter set to that project, and "New chat" opens the shared
 * new-task composer already scoped to it. Nothing renders until a server
 * reports the managed project.
 */
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  findGenericChatProject,
  GENERIC_CHAT_LOGICAL_PROJECT_KEY,
  GENERIC_CHAT_PROJECT_TITLE,
} from "@t3tools/shared/genericChat";
import { useMemo } from "react";

import { useProjects } from "../../state/entities";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";

export function useGenericChatHeaderItem(props: {
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onProjectChange: (projectKey: string | null) => void;
}) {
  const navigation = useNavigation();
  const projects = useProjects();
  const chatProject = findGenericChatProject(projects, props.selectedEnvironmentId);
  const showingChats = props.selectedProjectKey === GENERIC_CHAT_LOGICAL_PROJECT_KEY;
  const { onProjectChange } = props;

  return useMemo(() => {
    if (chatProject === null) return null;
    return withNativeGlassHeaderItem({
      accessibilityLabel: "Chats",
      icon: { name: "bubble.left.and.bubble.right", type: "sfSymbol" as const },
      identifier: "home-chats",
      label: "",
      menu: {
        title: GENERIC_CHAT_PROJECT_TITLE,
        items: [
          {
            icon: { name: "square.and.pencil", type: "sfSymbol" as const },
            label: "New chat",
            onPress: () =>
              navigation.navigate("NewTaskSheet", {
                screen: "NewTaskDraft",
                params: {
                  environmentId: String(chatProject.environmentId),
                  projectId: String(chatProject.id),
                  title: GENERIC_CHAT_PROJECT_TITLE,
                },
              }),
            type: "action" as const,
          },
          {
            icon: {
              name: showingChats ? "list.bullet" : "bubble.left.and.bubble.right",
              type: "sfSymbol" as const,
            },
            label: showingChats ? "Show all threads" : "Show chats",
            onPress: () => onProjectChange(showingChats ? null : GENERIC_CHAT_LOGICAL_PROJECT_KEY),
            type: "action" as const,
          },
        ],
      },
      type: "menu" as const,
    });
  }, [chatProject, navigation, onProjectChange, showingChats]);
}
