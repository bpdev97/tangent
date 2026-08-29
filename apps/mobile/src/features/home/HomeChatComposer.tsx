import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ComposerSurface } from "../threads/ThreadComposer";

export const HOME_CHAT_COMPOSER_CLEARANCE = 104;

export function HomeChatComposer(props: {
  readonly disabled: boolean;
  readonly hostLabel: string;
  readonly onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== "ios") return null;

  return (
    <View pointerEvents="box-none" className="absolute right-0 bottom-0 left-0 bg-screen">
      <View
        pointerEvents="none"
        className="absolute right-0 left-0 bg-linear-to-b from-screen/0 via-screen/60 to-screen"
        style={{
          top: -48,
          height: 48,
        }}
      />
      <View
        pointerEvents="box-none"
        className="w-full px-3 pt-2"
        style={{ paddingBottom: Math.max(insets.bottom, 10) }}
      >
        <View className="mb-1.5 flex-row items-center px-3">
          <Text className="min-w-0 flex-1 text-xs font-t3-medium text-foreground-muted">
            New chat on {props.hostLabel}
          </Text>
          {props.disabled ? (
            <Text className="text-xs font-t3-medium text-danger">Host unavailable</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityHint="Opens the new chat composer"
          accessibilityLabel="Ask anything"
          accessibilityRole="button"
          disabled={props.disabled}
          onPress={props.onPress}
          className="w-full max-w-[720px] self-center active:opacity-80"
        >
          <ComposerSurface
            style={{
              borderRadius: 999,
              overflow: "hidden",
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 18,
              paddingRight: 5,
              paddingVertical: 5,
            }}
          >
            <Text className="min-w-0 flex-1 text-base text-foreground-muted" numberOfLines={1}>
              Ask anything…
            </Text>
            <View
              className={
                props.disabled
                  ? "h-11 w-11 items-center justify-center rounded-full bg-subtle-strong"
                  : "h-11 w-11 items-center justify-center rounded-full bg-primary"
              }
            >
              <SymbolView
                name="arrow.up"
                size={16}
                tintColorClassName={
                  props.disabled ? "accent-icon-subtle" : "accent-primary-foreground"
                }
                type="monochrome"
              />
            </View>
          </ComposerSurface>
        </Pressable>
      </View>
    </View>
  );
}
