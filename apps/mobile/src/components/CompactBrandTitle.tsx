import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Platform, View } from "react-native";

import { AppText as Text } from "./AppText";
import { T3Wordmark } from "./T3Wordmark";
import { IPAD_HOME_TITLE_OFFSET } from "../lib/layoutMetrics";

/**
 * Horizontal correction applied to content rendered in the brand title slot,
 * shared with the connection-status swap so both align identically.
 */
export function brandTitleOffset(): number {
  if (Platform.OS !== "ios") return 0;
  return Platform.isPad ? IPAD_HOME_TITLE_OFFSET : 0;
}

/**
 * Compact brand lockup sized for native navigation bars.
 */
export function CompactBrandTitle(
  props: {
    readonly allowFontScaling?: boolean;
  } = {},
) {
  const titleOffset = brandTitleOffset();

  return (
    <View
      aria-level={1}
      accessibilityLabel="T3 Code, Threads"
      accessible
      role="heading"
      className="flex-row items-center gap-1.5"
      style={{ marginLeft: titleOffset }}
    >
      <T3Wordmark colorClassName="accent-icon" height={15} />
      <Text
        allowFontScaling={props.allowFontScaling}
        className="font-t3-medium text-[21px] tracking-[-0.5px] text-foreground-muted"
      >
        Code
      </Text>
      {/* Tangent(FORK-DIST-001): no release-stage badge; upstream's stage does not describe Tangent builds. */}
    </View>
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: "Threads",
    unstable_headerLeftItems: undefined,
  };
}
