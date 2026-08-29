import { SymbolView } from "../../components/AppSymbol";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";

export function WorkspaceEmptyDetail(props: {
  readonly onStartNewChat?: () => void;
  readonly onStartNewTask?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center bg-screen px-10">
      <View className="max-w-[360px] items-center gap-3">
        <SymbolView
          name="sidebar.left"
          size={34}
          tintColorClassName={"accent-icon-subtle"}
          type="hierarchical"
        />
        <Text className="text-center text-xl font-t3-bold">Select a thread</Text>
        <Text className="text-center text-base text-foreground-muted">
          Choose a thread from the sidebar or start a new chat or task.
        </Text>
        {props.onStartNewChat || props.onStartNewTask ? (
          <View className="mt-2 flex-row items-center gap-2">
            {props.onStartNewChat ? (
              <Pressable
                accessibilityRole="button"
                className="flex-row items-center gap-2 rounded-full bg-primary px-5 py-3 active:opacity-70"
                onPress={props.onStartNewChat}
              >
                <Text className="text-base font-t3-bold text-primary-foreground">New Chat</Text>
              </Pressable>
            ) : null}
            {props.onStartNewTask ? (
              <Pressable
                accessibilityRole="button"
                className="flex-row items-center gap-2 rounded-full bg-subtle px-5 py-3 active:opacity-70"
                onPress={props.onStartNewTask}
              >
                <Text className="text-base font-t3-bold text-foreground">New Task</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
