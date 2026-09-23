/**
 * Tangent(FORK-CHAT-001): project-only thread routes refuse chats.
 *
 * Headers already hide files, Git, and review for chats; this guard covers the
 * other ways in, such as deep links and hardware keyboard commands. The
 * terminal is not guarded, because chats keep it.
 */
import { isGenericChatThread } from "@t3tools/shared/genericChat";
import type { ComponentType } from "react";
import { View } from "react-native";

import { EmptyState } from "../../components/EmptyState";
import { useThreadSelection } from "../../state/use-thread-selection";

export function withProjectThreadRouteGuard<TProps extends object>(
  Screen: ComponentType<TProps>,
  resourceName: string,
): ComponentType<TProps> {
  return function ProjectThreadRouteGuard(props: TProps) {
    const { selectedThread } = useThreadSelection();

    if (isGenericChatThread(selectedThread)) {
      return (
        <View className="flex-1 items-center justify-center bg-screen px-6">
          <EmptyState
            variant="plain"
            title={`${resourceName} unavailable`}
            detail="Chats are not attached to a project, so they have no files or Git."
          />
        </View>
      );
    }

    return <Screen {...props} />;
  };
}
